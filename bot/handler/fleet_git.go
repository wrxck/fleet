package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

func handleGit(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	cmdArgs := []string{"git", "status"}
	if args != "" {
		cmdArgs = append(cmdArgs, strings.Fields(args)[0])
	}
	cmdArgs = append(cmdArgs, "--json")

	res, err := exec.FleetRead(cmdArgs...)
	if err != nil {
		msg := "Error fetching git status"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		b.SendMessageWithReply(chatID, msg, configKeyboard())
		return
	}

	var data interface{}
	if err := json.Unmarshal([]byte(res.Stdout), &data); err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("%s\n%s", bot.Bold("Git Status"), bot.Pre(res.Stdout)), configKeyboard())
		return
	}

	formatted, _ := json.MarshalIndent(data, "", "  ")
	output := string(formatted)
	if len(output) > 3500 {
		output = output[:3500] + "..."
	}
	b.SendMessageWithReply(chatID, fmt.Sprintf("%s\n%s", bot.Bold("Git Status"), bot.Pre(output)), configKeyboard())
}
