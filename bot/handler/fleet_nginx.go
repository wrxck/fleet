package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

func handleNginx(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	res, err := exec.FleetRead("nginx", "list", "--json")
	if err != nil {
		msg := "Error fetching nginx config"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		b.SendMessageWithReply(chatID, msg, configKeyboard())
		return
	}

	var data interface{}
	if err := json.Unmarshal([]byte(res.Stdout), &data); err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("%s\n%s", bot.Bold("Nginx Configs"), bot.Pre(res.Stdout)), configKeyboard())
		return
	}

	formatted, _ := json.MarshalIndent(data, "", "  ")
	output := string(formatted)
	if len(output) > 3500 {
		output = output[:3500] + "..."
	}
	b.SendMessageWithReply(chatID, fmt.Sprintf("%s\n%s", bot.Bold("Nginx Configs"), bot.Pre(output)), configKeyboard())
}
