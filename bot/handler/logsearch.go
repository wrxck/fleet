package handler

import (
	"context"
	"fmt"
	"strings"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

// handleLogSearch searches recent logs for a pattern.
func handleLogSearch(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	fields := strings.Fields(args)
	if len(fields) < 2 {
		b.SendMessageWithReply(chatID, "Usage: /logsearch &lt;app&gt; &lt;pattern&gt;", helpMainKeyboard())
		return
	}

	app := fields[0]
	pattern := strings.Join(fields[1:], " ")

	b.SendChatAction(chatID, "typing")

	// Get last 500 lines then grep
	res, err := exec.FleetRead("logs", app, "-n", "500")
	if err != nil {
		msg := fmt.Sprintf("Error fetching logs for %s", app)
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		b.SendMessageWithReply(chatID, msg, helpMainKeyboard())
		return
	}

	lines := strings.Split(res.Stdout, "\n")
	var matches []string
	for _, line := range lines {
		if strings.Contains(strings.ToLower(line), strings.ToLower(pattern)) {
			matches = append(matches, line)
		}
	}

	if len(matches) == 0 {
		b.SendMessageWithReply(chatID, fmt.Sprintf("No matches for %s in %s logs.", bot.Code(pattern), bot.Bold(app)), appActionKeyboard(app))
		return
	}

	output := strings.Join(matches, "\n")
	if len(output) > 3500 {
		output = output[len(output)-3500:]
	}

	b.SendMessageWithReply(chatID, fmt.Sprintf("%s logs matching %s (%d hits):\n%s",
		bot.Bold(app), bot.Code(pattern), len(matches), bot.Pre(output)), appActionKeyboard(app))
}
