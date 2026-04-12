package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"fleet-bot/bot"
	"fleet-bot/claude"
)

func claudeProjectsDir() string {
	if h := os.Getenv("HOME"); h != "" {
		return h + "/.claude/projects"
	}
	return "/root/.claude/projects"
}

type sessionInfo struct {
	ID        string
	Dir       string
	UpdatedAt time.Time
}

// handleCCSessions lists recent Claude sessions for resuming.
func handleCCSessions(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, args string) {
	sessions := findRecentSessions(10)
	if len(sessions) == 0 {
		b.SendMessageWithReply(chatID, "No recent sessions found.", claudeResultKeyboard())
		return
	}

	text := bot.Bold("Recent Claude Sessions") + "\n\n"

	var buttons [][]bot.InlineKeyboardButton
	for i, sess := range sessions {
		ago := time.Since(sess.UpdatedAt).Round(time.Minute)
		dir := sess.Dir
		if len(dir) > 30 {
			dir = "..." + dir[len(dir)-27:]
		}
		text += fmt.Sprintf("%d. %s  %s ago\n   %s\n", i+1, bot.Code(sess.ID[:8]), ago, dir)

		if i < 5 { // Only show buttons for first 5
			buttons = append(buttons, []bot.InlineKeyboardButton{
				{Text: fmt.Sprintf("%s (%s)", sess.ID[:8], dir), CallbackData: fmt.Sprintf("c:sess:%s", sess.ID)},
			})
		}
	}

	kb := &bot.InlineKeyboardMarkup{InlineKeyboard: buttons}
	b.SendMessageWithReply(chatID, text, kb)
}

func findRecentSessions(limit int) []sessionInfo {
	var sessions []sessionInfo

	projectsDir := claudeProjectsDir()
	projectDirs, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil
	}

	for _, pd := range projectDirs {
		if !pd.IsDir() {
			continue
		}

		dir := projectDirToPath(pd.Name())
		sessDir := filepath.Join(projectsDir, pd.Name())

		entries, err := os.ReadDir(sessDir)
		if err != nil {
			continue
		}

		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".jsonl") {
				continue
			}

			sessID := strings.TrimSuffix(e.Name(), ".jsonl")
			info, err := e.Info()
			if err != nil {
				continue
			}

			sessions = append(sessions, sessionInfo{
				ID:        sessID,
				Dir:       dir,
				UpdatedAt: info.ModTime(),
			})
		}
	}

	// Sort by most recent
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt.After(sessions[j].UpdatedAt)
	})

	if len(sessions) > limit {
		sessions = sessions[:limit]
	}
	return sessions
}

// projectDirToPath converts "-home-matt-foo" back to "/home/matt/foo"
func projectDirToPath(name string) string {
	return "/" + strings.ReplaceAll(name, "-", "/")
}

// handleSessionResume is called from cbClaude when "c:sess:<id>" is received.
// It sets the session ID and working directory, then confirms.
func handleSessionResume(b *bot.Bot, s *claude.Session, chatID int64, messageID int64, sessID string) {
	// Find the session to get its directory
	sessions := findRecentSessions(50)
	for _, sess := range sessions {
		if sess.ID == sessID {
			s.SetWorkDir(sess.Dir)
			break
		}
	}

	// Set session ID via a small helper — we'll need to add this to Session
	setSessionID(s, sessID)

	b.EditMessage(chatID, messageID,
		fmt.Sprintf("Resumed session %s\nDir: %s",
			bot.Code(sessID[:8]), bot.Code(s.WorkDir())),
		claudeResultKeyboard())
}

// setSessionID is a helper that uses Reset then sets the ID.
// We'll read the session and use reflection... actually, let's just add a setter.
func setSessionID(s *claude.Session, id string) {
	// This calls the SetSessionID method we'll add
	s.SetSessionID(id)
}

// contextForClaude builds a context prefix from recent alerts.
func contextForClaude(alerts *AlertMonitor) string {
	if alerts == nil {
		return ""
	}

	alerts.mu.Lock()
	state := make(map[string]string)
	for k, v := range alerts.lastState {
		state[k] = v
	}
	alerts.mu.Unlock()

	var downApps []string
	for app, health := range state {
		if health == "down" {
			downApps = append(downApps, app)
		}
	}

	if len(downApps) == 0 {
		return ""
	}

	return fmt.Sprintf("[Server context: these apps are currently DOWN: %s] ", strings.Join(downApps, ", "))
}

// extractFleetCommands scans Claude's response for fleet command patterns and returns button suggestions.
func extractFleetCommands(text string) []bot.InlineKeyboardButton {
	commands := map[string]string{
		"/deploy ":    "Deploy",
		"/restart ":   "Restart",
		"/stop ":      "Stop",
		"/start_app ": "Start",
		"/logs ":      "Logs",
	}

	var buttons []bot.InlineKeyboardButton
	seen := make(map[string]bool)

	lines := strings.Split(text, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		for prefix, label := range commands {
			idx := strings.Index(line, prefix)
			if idx < 0 {
				continue
			}
			rest := line[idx+len(prefix):]
			fields := strings.Fields(rest)
			if len(fields) == 0 {
				continue
			}
			app := fields[0]
			// Remove backticks or quotes
			app = strings.Trim(app, "`\"'")
			key := prefix + app
			if seen[key] {
				continue
			}
			seen[key] = true
			cmd := strings.TrimSpace(prefix) + " " + app
			buttons = append(buttons, bot.InlineKeyboardButton{
				Text:         fmt.Sprintf("%s %s", label, app),
				CallbackData: fmt.Sprintf("qp:run:%s", strings.TrimPrefix(cmd, "/")),
			})
		}
	}

	if len(buttons) > 4 {
		buttons = buttons[:4]
	}
	return buttons
}

// We need to parse the session file to get summaries - but a simpler approach
// is just reading the first line which has the system message with the session ID.
func readSessionSummary(sessID string) string {
	sessions := findRecentSessions(50)
	for _, s := range sessions {
		if s.ID == sessID {
			// Try to read the first user message from the JSONL
			path := filepath.Join(claudeProjectsDir(),
				strings.ReplaceAll(strings.TrimPrefix(s.Dir, "/"), "/", "-"),
				sessID+".jsonl")
			data, err := os.ReadFile(path)
			if err != nil {
				return ""
			}
			// Find first user message
			for _, line := range strings.Split(string(data), "\n") {
				if line == "" {
					continue
				}
				var msg struct {
					Type    string `json:"type"`
					Message struct {
						Role    string `json:"role"`
						Content string `json:"content"`
					} `json:"message"`
				}
				if json.Unmarshal([]byte(line), &msg) == nil {
					if msg.Type == "user" || msg.Message.Role == "user" {
						content := msg.Message.Content
						if len(content) > 60 {
							content = content[:60] + "..."
						}
						return content
					}
				}
			}
		}
	}
	return ""
}
