package handler

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"fleet-bot/bot"
	"fleet-bot/claude"
)

// handleClaudeMessage routes non-command text to Claude Code.
func handleClaudeMessage(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, text string) {
	if s.IsRunning() {
		b.SendMessageWithReply(chatID, "Claude is busy. /cc_stop to cancel.", claudeResultKeyboard())
		return
	}

	b.SendChatAction(chatID, "typing")

	model := s.Model()
	workDir := s.WorkDir()

	// Send initial status message
	statusText := fmt.Sprintf("Model: %s | Dir: %s\n\nThinking...", bot.Code(model), bot.Code(workDir))
	msg, err := b.SendMessage(chatID, statusText)
	if err != nil {
		return
	}

	msgID := msg.MessageID

	// Track status for debounced updates
	var mu sync.Mutex
	lastEdit := time.Now()
	var lastStatus string

	go func() {
		// Keep typing indicator alive while running
		typingDone := make(chan struct{})
		go func() {
			ticker := time.NewTicker(4 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-typingDone:
					return
				case <-ticker.C:
					b.SendChatAction(chatID, "typing")
				}
			}
		}()

		result, runErr := s.Run(text, func(su claude.StatusUpdate) {
			mu.Lock()
			detail := su.Detail
			if detail != "" {
				lastStatus = fmt.Sprintf("[%d] %s: %s", su.ToolCount, su.ToolName, detail)
			} else {
				lastStatus = fmt.Sprintf("[%d] %s", su.ToolCount, su.ToolName)
			}
			status := lastStatus
			elapsed := time.Since(lastEdit)
			mu.Unlock()

			// Debounce edits to every 3s
			if elapsed < claude.UpdateInterval {
				return
			}

			mu.Lock()
			lastEdit = time.Now()
			mu.Unlock()

			updateText := fmt.Sprintf("Model: %s | Dir: %s\n\n%s",
				bot.Code(model), bot.Code(workDir), status)
			b.EditMessage(chatID, msgID, updateText, nil)
		})

		close(typingDone)

		if runErr != nil && (result == nil || result.Text == "") {
			b.EditMessage(chatID, msgID, fmt.Sprintf("Error: %s", runErr), claudeResultKeyboard())
			return
		}

		// Build completion summary line
		var summary strings.Builder
		if result != nil {
			if result.CostUSD > 0 {
				summary.WriteString(fmt.Sprintf("$%.4f", result.CostUSD))
			}
			if result.DurationMS > 0 {
				if summary.Len() > 0 {
					summary.WriteString(" | ")
				}
				dur := time.Duration(result.DurationMS) * time.Millisecond
				summary.WriteString(dur.Round(time.Second).String())
			}
			if result.ToolCalls > 0 {
				if summary.Len() > 0 {
					summary.WriteString(" | ")
				}
				summary.WriteString(fmt.Sprintf("%d tool calls", result.ToolCalls))
			}
			if result.NumTurns > 0 {
				if summary.Len() > 0 {
					summary.WriteString(" | ")
				}
				summary.WriteString(fmt.Sprintf("%d turns", result.NumTurns))
			}
		}

		// Edit status message to show summary with action buttons
		doneText := "Done."
		if summary.Len() > 0 {
			doneText = summary.String()
		}
		b.EditMessage(chatID, msgID, doneText, claudeResultKeyboard())

		// Send the actual result as plain text (safe from HTML issues)
		if result != nil && result.Text != "" {
			b.SendPlainChunked(chatID, result.Text)
			// Check for fleet command suggestions in response
			if cmdButtons := extractFleetCommands(result.Text); len(cmdButtons) > 0 {
				kb := &bot.InlineKeyboardMarkup{
					InlineKeyboard: [][]bot.InlineKeyboardButton{cmdButtons},
				}
				b.SendMessageWithReply(chatID, "Suggested actions:", kb)
			}
		} else if runErr != nil {
			b.SendPlainText(chatID, fmt.Sprintf("Finished with error: %s", runErr))
		}
	}()
}

// claudeResultKeyboard shows action buttons after Claude finishes.
func claudeResultKeyboard() *bot.InlineKeyboardMarkup {
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: "Retry", CallbackData: "c:retry"},
				{Text: "Continue", CallbackData: "c:continue"},
			},
		},
	}
}

func handleCCResume(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, args string) {
	prompt := "continue"
	if args != "" {
		prompt = args
	}
	handleClaudeMessage(ctx, b, s, chatID, prompt)
}

func handleCCHistory(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, args string) {
	history := s.History()
	if len(history) == 0 {
		b.SendMessageWithReply(chatID, "No history yet.", claudeResultKeyboard())
		return
	}

	text := bot.Bold("Recent Prompts") + "\n\n"
	// Show last 10
	start := 0
	if len(history) > 10 {
		start = len(history) - 10
	}
	for i := start; i < len(history); i++ {
		prompt := history[i]
		if len(prompt) > 80 {
			prompt = prompt[:80] + "..."
		}
		text += fmt.Sprintf("%d. %s\n", i+1, prompt)
	}

	// Build keyboard with last 3 as quick-retry buttons
	retryStart := len(history) - 3
	if retryStart < 0 {
		retryStart = 0
	}
	var buttons []bot.InlineKeyboardButton
	for i := retryStart; i < len(history); i++ {
		label := history[i]
		if len(label) > 20 {
			label = label[:20] + "..."
		}
		buttons = append(buttons, bot.InlineKeyboardButton{
			Text: label, CallbackData: fmt.Sprintf("c:hist:%d", i),
		})
	}

	kb := &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{buttons},
	}
	b.SendMessageWithReply(chatID, text, kb)
}

func handleCCStop(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, args string) {
	if s.Stop() {
		b.SendMessageWithReply(chatID, "Stopped.", claudeResultKeyboard())
	} else {
		b.SendMessageWithReply(chatID, "Nothing running.", claudeResultKeyboard())
	}
}

func handleCCReset(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, args string) {
	s.Stop()
	s.Reset()
	b.SendMessageWithReply(chatID, "Session reset. Next message starts a fresh conversation.", claudeResultKeyboard())
}

func handleCCCD(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, args string) {
	if args == "" {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Working directory: %s\nUsage: /cc_cd <path>", bot.Code(s.WorkDir())), claudeResultKeyboard())
		return
	}
	dir := strings.Fields(args)[0]
	s.SetWorkDir(dir)
	b.SendMessageWithReply(chatID, fmt.Sprintf("Working directory: %s", bot.Code(dir)), claudeResultKeyboard())
}

func handleCCModel(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, args string) {
	if args == "" {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Model: %s\nUsage: /cc_model <model>\nExamples: sonnet, opus, haiku", bot.Code(s.Model())), claudeResultKeyboard())
		return
	}
	model := strings.Fields(args)[0]
	s.SetModel(model)
	b.SendMessageWithReply(chatID, fmt.Sprintf("Model: %s", bot.Code(model)), claudeResultKeyboard())
}

func handleCCStatus(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, args string) {
	text := claudeStatusText(s)
	b.SendMessageWithReply(chatID, text, claudeKeyboard(s))
}

func claudeStatusText(s *claude.Session) string {
	running := "idle"
	if s.IsRunning() {
		running = "running"
	}
	sid := s.SessionID()
	if sid == "" {
		sid = "(none)"
	}

	text := bot.Bold("Claude Code Session") + "\n\n"
	text += fmt.Sprintf("Status:  %s\n", running)
	text += fmt.Sprintf("Model:   %s\n", bot.Code(s.Model()))
	text += fmt.Sprintf("Dir:     %s\n", bot.Code(s.WorkDir()))
	text += fmt.Sprintf("Session: %s", bot.Code(sid))
	return text
}

// --- Inline keyboard callbacks for Claude actions (prefix "c:") ---

func cbClaude(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, messageID int64, data string) {
	// data format: "c:status", "c:stop", "c:reset", "c:model:sonnet", etc.
	parts := strings.SplitN(data, ":", 3)
	if len(parts) < 2 {
		return
	}
	action := parts[1]

	switch action {
	case "status":
		b.EditMessage(chatID, messageID, claudeStatusText(s), claudeKeyboard(s))

	case "stop":
		if s.Stop() {
			b.EditMessage(chatID, messageID, "Stopped.\n\n"+claudeStatusText(s), claudeKeyboard(s))
		} else {
			b.EditMessage(chatID, messageID, "Nothing running.\n\n"+claudeStatusText(s), claudeKeyboard(s))
		}

	case "reset":
		s.Stop()
		s.Reset()
		b.EditMessage(chatID, messageID, "Session reset.\n\n"+claudeStatusText(s), claudeKeyboard(s))

	case "model":
		if len(parts) < 3 {
			return
		}
		model := parts[2]
		s.SetModel(model)
		b.EditMessage(chatID, messageID, fmt.Sprintf("Model set to %s.\n\n", bot.Code(model))+claudeStatusText(s), claudeKeyboard(s))

	case "retry":
		last := s.LastPrompt()
		if last == "" {
			b.EditMessage(chatID, messageID, "No previous prompt to retry.", claudeResultKeyboard())
			return
		}
		b.EditMessage(chatID, messageID, "Retrying...", claudeResultKeyboard())
		handleClaudeMessage(ctx, b, s, chatID, last)

	case "continue":
		b.EditMessage(chatID, messageID, "Continuing...", claudeResultKeyboard())
		handleClaudeMessage(ctx, b, s, chatID, "continue")

	case "hist":
		if len(parts) < 3 {
			return
		}
		idx := 0
		fmt.Sscanf(parts[2], "%d", &idx)
		history := s.History()
		if idx < 0 || idx >= len(history) {
			return
		}
		prompt := history[idx]
		b.EditMessage(chatID, messageID, fmt.Sprintf("Re-running: %s", bot.Code(truncateLog(prompt, 60))), claudeResultKeyboard())
		handleClaudeMessage(ctx, b, s, chatID, prompt)

	case "sess":
		if len(parts) < 3 {
			return
		}
		handleSessionResume(b, s, chatID, messageID, parts[2])
	}
}

func claudeKeyboard(s *claude.Session) *bot.InlineKeyboardMarkup {
	currentModel := s.Model()
	models := []struct{ name, label string }{
		{"sonnet", "Sonnet"},
		{"opus", "Opus"},
		{"haiku", "Haiku"},
	}

	var modelButtons []bot.InlineKeyboardButton
	for _, m := range models {
		label := m.label
		if m.name == currentModel {
			label = "~ " + label + " ~"
		}
		modelButtons = append(modelButtons, bot.InlineKeyboardButton{
			Text: label, CallbackData: "c:model:" + m.name,
		})
	}

	rows := [][]bot.InlineKeyboardButton{
		modelButtons,
		{
			{Text: "Refresh", CallbackData: "c:status"},
			{Text: "Stop", CallbackData: "c:stop"},
			{Text: "Reset", CallbackData: "c:reset"},
		},
	}
	return &bot.InlineKeyboardMarkup{InlineKeyboard: rows}
}
