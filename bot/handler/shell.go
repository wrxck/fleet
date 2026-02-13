package handler

import (
	"context"
	"fmt"
	"log"
	"time"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

const shellTimeout = 30 * time.Second

// handleShell runs an arbitrary shell command with confirmation.
func handleShell(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, args string) {
	if args == "" {
		b.SendMessageWithReply(chatID, "Usage: /sh &lt;command&gt;\nRuns a shell command on the host.", systemKeyboard("sys"))
		return
	}

	cm.Request(b, chatID,
		fmt.Sprintf("Run command?\n%s", bot.Pre(args)),
		"Run it",
		func() (string, error) {
			log.Printf("shell: %q (chat: %d)", args, chatID)
			res, err := exec.Run(shellTimeout, "bash", "-c", args)

			output := ""
			if res != nil {
				output = res.Stdout
				if res.Stderr != "" {
					if output != "" {
						output += "\n"
					}
					output += res.Stderr
				}
			}

			if output == "" {
				output = "(no output)"
			}
			if len(output) > 3500 {
				output = output[len(output)-3500:]
			}

			if err != nil {
				exitCode := -1
				if res != nil {
					exitCode = res.ExitCode
				}
				return fmt.Sprintf("Exit %d:\n%s", exitCode, bot.Pre(output)), nil
			}

			return bot.Pre(output), nil
		},
	)
}
