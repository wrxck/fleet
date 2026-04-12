package command

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

const claudeProjectsDir = "/home/matt/.claude/projects"

// claudeSession holds minimal session info for listing.
type claudeSession struct {
	ID        string
	Dir       string
	UpdatedAt time.Time
}

// ClaudeCmd implements /claude (alias: cc).
type ClaudeCmd struct{}

func (c *ClaudeCmd) Name() string      { return "claude" }
func (c *ClaudeCmd) Aliases() []string { return []string{"cc"} }
func (c *ClaudeCmd) Help() string      { return "Run Claude Code or manage sessions" }

func (c *ClaudeCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return claudeStatus()
	}

	subcommand := strings.ToLower(args[0])
	rest := args[1:]

	switch subcommand {
	case "sessions", "list":
		return claudeSessions()
	case "run":
		if len(rest) == 0 {
			return adapter.TextResponse("Usage: /claude run <prompt>"), nil
		}
		prompt := strings.Join(rest, " ")
		return claudeRun(prompt, "")
	case "stop":
		return claudeStop()
	case "status":
		return claudeStatus()
	case "model":
		if len(rest) == 0 {
			return adapter.TextResponse("Usage: /claude model <sonnet|opus|haiku>"), nil
		}
		return adapter.TextResponse(fmt.Sprintf("Model preference noted: %s\n(Full model switching requires active session integration.)", rest[0])), nil
	default:
		// Treat args as a prompt
		prompt := strings.Join(args, " ")
		return claudeRun(prompt, "")
	}
}

func claudeStatus() (adapter.OutboundMessage, error) {
	var sb strings.Builder
	sb.WriteString("Claude Code\n\n")

	// Check if claude CLI is available
	res, err := exec.Run(5*time.Second, "which", "claude")
	if err != nil || (res != nil && strings.TrimSpace(res.Stdout) == "") {
		sb.WriteString("Status: claude CLI not found\n\n")
	} else {
		sb.WriteString("Status: idle\n")
		sb.WriteString(fmt.Sprintf("CLI: %s\n\n", strings.TrimSpace(res.Stdout)))
	}

	sessions := findClaudeSessions(3)
	if len(sessions) > 0 {
		sb.WriteString("Recent sessions:\n")
		for i, s := range sessions {
			ago := time.Since(s.UpdatedAt).Round(time.Minute)
			dir := s.Dir
			if len(dir) > 40 {
				dir = "..." + dir[len(dir)-37:]
			}
			sb.WriteString(fmt.Sprintf("  %d. %s  %s ago  %s\n", i+1, s.ID[:8], ago, dir))
		}
	}

	sb.WriteString("\nSubcommands: run <prompt>, sessions, stop, status, model <name>")
	return adapter.TextResponse(sb.String()), nil
}

func claudeRun(prompt, workDir string) (adapter.OutboundMessage, error) {
	if workDir == "" {
		workDir = "/home/matt/fleet"
	}

	cmdArgs := []string{"--print", "--output-format", "text", prompt}

	res, err := exec.Run(5*time.Minute, "claude", cmdArgs...)
	if err != nil {
		detail := ""
		if res != nil {
			if res.Stderr != "" {
				detail = "\n" + res.Stderr
			} else if res.Stdout != "" {
				detail = "\n" + res.Stdout
			}
		}
		return adapter.TextResponse(fmt.Sprintf("Claude error: %s%s", err, detail)), nil
	}

	output := ""
	if res != nil {
		output = strings.TrimSpace(res.Stdout)
	}
	if output == "" {
		output = "(no output)"
	}
	if len(output) > 3800 {
		output = output[len(output)-3800:]
	}

	return adapter.TextResponse(output), nil
}

func claudeStop() (adapter.OutboundMessage, error) {
	res, err := exec.Run(5*time.Second, "pkill", "-f", "claude")
	if err != nil {
		if res != nil && res.ExitCode == 1 {
			return adapter.TextResponse("No Claude process running."), nil
		}
		return adapter.TextResponse(fmt.Sprintf("Error: %s", err)), nil
	}
	return adapter.TextResponse("Stopped Claude process."), nil
}

func claudeSessions() (adapter.OutboundMessage, error) {
	sessions := findClaudeSessions(10)
	if len(sessions) == 0 {
		return adapter.TextResponse("No recent Claude sessions found."), nil
	}

	var sb strings.Builder
	sb.WriteString("Recent Claude Sessions\n\n")

	options := make([]string, 0, len(sessions))
	for i, s := range sessions {
		ago := time.Since(s.UpdatedAt).Round(time.Minute)
		dir := s.Dir
		if len(dir) > 30 {
			dir = "..." + dir[len(dir)-27:]
		}
		sb.WriteString(fmt.Sprintf("%d. %s  %s ago\n   %s\n", i+1, s.ID[:8], ago, dir))
		options = append(options, fmt.Sprintf("%s (%s)", s.ID[:8], dir))
	}

	return adapter.OptionsResponse(sb.String(), options), nil
}

func findClaudeSessions(limit int) []claudeSession {
	var sessions []claudeSession

	projectDirs, err := os.ReadDir(claudeProjectsDir)
	if err != nil {
		return nil
	}

	for _, pd := range projectDirs {
		if !pd.IsDir() {
			continue
		}

		dir := "/" + strings.ReplaceAll(pd.Name(), "-", "/")
		sessDir := filepath.Join(claudeProjectsDir, pd.Name())

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
			sessions = append(sessions, claudeSession{
				ID:        sessID,
				Dir:       dir,
				UpdatedAt: info.ModTime(),
			})
		}
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt.After(sessions[j].UpdatedAt)
	})

	if len(sessions) > limit {
		sessions = sessions[:limit]
	}
	return sessions
}
