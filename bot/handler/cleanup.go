package handler

import (
	"context"
	"fmt"
	"time"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

// handleCleanup shows Docker disk usage and offers to prune.
func handleCleanup(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, args string) {
	b.SendChatAction(chatID, "typing")

	// Show disk usage first
	res, err := exec.Run(15*time.Second, "docker", "system", "df")
	if err != nil {
		b.SendMessageWithReply(chatID, "Error running docker system df", systemKeyboard("sys"))
		return
	}

	text := bot.Bold("Docker Disk Usage") + "\n" + bot.Pre(res.Stdout)

	cm.Request(b, chatID,
		text+"\nPrune unused images, containers, networks, and build cache?",
		"Yes, prune",
		func() (string, error) {
			pruneRes, err := exec.Run(2*time.Minute, "docker", "system", "prune", "-f")
			if err != nil {
				detail := ""
				if pruneRes != nil {
					detail = pruneRes.Stderr
				}
				return "", fmt.Errorf("prune failed: %s", detail)
			}

			output := pruneRes.Stdout
			if len(output) > 3500 {
				output = output[len(output)-3500:]
			}
			return fmt.Sprintf("Pruned.\n%s", bot.Pre(output)), nil
		},
	)
}
