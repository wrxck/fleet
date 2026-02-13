package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

func handleSecrets(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	res, err := exec.FleetRead("secrets", "status", "--json")
	if err != nil {
		msg := "Error fetching secrets status"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		b.SendMessageWithReply(chatID, msg, configKeyboard())
		return
	}

	// Parse as generic JSON since structure may vary
	var data interface{}
	if err := json.Unmarshal([]byte(res.Stdout), &data); err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("%s\n%s", bot.Bold("Secrets Status"), bot.Pre(res.Stdout)), configKeyboard())
		return
	}

	text := bot.Bold("Secrets Vault") + "\n"
	formatted, _ := json.MarshalIndent(data, "", "  ")
	output := string(formatted)
	if len(output) > 3500 {
		output = output[:3500] + "..."
	}
	text += bot.Pre(output)
	b.SendMessageWithReply(chatID, text, configKeyboard())
}

func handleSecretsList(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	cmdArgs := []string{"secrets", "list"}
	if args != "" {
		cmdArgs = append(cmdArgs, strings.Fields(args)[0])
	}
	cmdArgs = append(cmdArgs, "--json")

	res, err := exec.FleetRead(cmdArgs...)
	if err != nil {
		msg := "Error listing secrets"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		b.SendMessageWithReply(chatID, msg, configKeyboard())
		return
	}

	output := res.Stdout
	if output == "" {
		output = "(no secrets)"
	}
	if len(output) > 3500 {
		output = output[:3500] + "..."
	}
	b.SendMessageWithReply(chatID, fmt.Sprintf("%s\n%s", bot.Bold("Secrets"), bot.Pre(output)), configKeyboard())
}

func handleSecretsValidate(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	cmdArgs := []string{"secrets", "validate"}
	if args != "" {
		cmdArgs = append(cmdArgs, strings.Fields(args)[0])
	}
	cmdArgs = append(cmdArgs, "--json")

	res, err := exec.FleetRead(cmdArgs...)
	if err != nil {
		msg := "Error validating secrets"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		b.SendMessageWithReply(chatID, msg, configKeyboard())
		return
	}

	output := res.Stdout
	if output == "" {
		output = "(no output)"
	}
	if len(output) > 3500 {
		output = output[:3500] + "..."
	}
	b.SendMessageWithReply(chatID, fmt.Sprintf("%s\n%s", bot.Bold("Secrets Validation"), bot.Pre(output)), configKeyboard())
}
