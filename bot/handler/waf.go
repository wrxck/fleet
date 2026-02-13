package handler

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"fleet-bot/bot"
	"fleet-bot/waf"
)

func handleWAF(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	cfg, err := waf.Read()
	if err != nil {
		b.SendMessage(chatID, fmt.Sprintf("Error reading WAF config: %s", err))
		return
	}

	active := strings.TrimSpace(waf.IsActive())

	text := bot.Bold("TrueWAF") + "\n\n"
	text += fmt.Sprintf("%s Service: %s\n", bot.StatusIcon(active), active)
	text += fmt.Sprintf("Mode: %s\n", bot.Code(cfg.Mode))
	text += fmt.Sprintf("Log level: %s\n", cfg.LogLevel)
	text += fmt.Sprintf("Proxy: %s:%d -> %s:%d\n",
		cfg.Proxy.ListenAddress, cfg.Proxy.ListenPort,
		cfg.Proxy.BackendAddress, cfg.Proxy.BackendPort)
	text += fmt.Sprintf("Workers: %d, Max conns: %d\n",
		cfg.Proxy.WorkerThreads, cfg.Proxy.MaxConnections)
	text += fmt.Sprintf("\nRate limit: %s\n", boolToEnabled(cfg.RateLimit.Enabled))
	if cfg.RateLimit.Enabled {
		text += fmt.Sprintf("  %d req/s, burst: %d, block: %ds\n",
			cfg.RateLimit.RequestsPerSecond,
			cfg.RateLimit.BurstSize,
			cfg.RateLimit.BlockDurationSeconds)
	}
	text += fmt.Sprintf("\nWhitelist: %d IPs, %d paths",
		len(cfg.Whitelist.IPs), len(cfg.Whitelist.Paths))

	b.SendMessageWithReply(chatID, text, wafMainKeyboard())
}

func handleWAFWhitelist(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	cfg, err := waf.Read()
	if err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Error: %s", err), wafMainKeyboard())
		return
	}

	text := bot.Bold("WAF Whitelist") + "\n\n"

	text += bot.Bold("Paths:") + "\n"
	if len(cfg.Whitelist.Paths) == 0 {
		text += "  (none)\n"
	}
	for _, p := range cfg.Whitelist.Paths {
		text += fmt.Sprintf("  %s\n", bot.Code(p))
	}

	text += "\n" + bot.Bold("IPs:") + "\n"
	if len(cfg.Whitelist.IPs) == 0 {
		text += "  (none)\n"
	}
	for _, ip := range cfg.Whitelist.IPs {
		text += fmt.Sprintf("  %s\n", bot.Code(ip))
	}

	b.SendMessageWithReply(chatID, text, wafMainKeyboard())
}

func handleWAFWhitelistAddConfirm(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, args string) {
	if args == "" {
		b.SendMessageWithReply(chatID, "Usage: /waf_whitelist_add <ip>", wafMainKeyboard())
		return
	}
	ip := strings.Fields(args)[0]

	cm.Request(b, chatID,
		fmt.Sprintf("Add %s to WAF whitelist?", bot.Code(ip)),
		"Yes, add it",
		func() (string, error) {
			if err := waf.AddWhitelistIP(ip); err != nil {
				return "", err
			}
			return fmt.Sprintf("Added %s to whitelist and reloaded WAF.", bot.Code(ip)), nil
		},
	)
}

func handleWAFWhitelistRmConfirm(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, args string) {
	if args == "" {
		b.SendMessageWithReply(chatID, "Usage: /waf_whitelist_rm <ip>", wafMainKeyboard())
		return
	}
	ip := strings.Fields(args)[0]

	cm.Request(b, chatID,
		fmt.Sprintf("Remove %s from WAF whitelist?", bot.Code(ip)),
		"Yes, remove it",
		func() (string, error) {
			if err := waf.RemoveWhitelistIP(ip); err != nil {
				return "", err
			}
			return fmt.Sprintf("Removed %s from whitelist and reloaded WAF.", bot.Code(ip)), nil
		},
	)
}

func handleWAFRateConfirm(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, args string) {
	fields := strings.Fields(args)
	if len(fields) < 2 {
		b.SendMessageWithReply(chatID, "Usage: /waf_rate <rps> <burst>", wafMainKeyboard())
		return
	}

	rps, err := strconv.Atoi(fields[0])
	if err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Invalid rps: %s", fields[0]), wafMainKeyboard())
		return
	}
	burst, err := strconv.Atoi(fields[1])
	if err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Invalid burst: %s", fields[1]), wafMainKeyboard())
		return
	}

	cm.Request(b, chatID,
		fmt.Sprintf("Set WAF rate limit to %d req/s with burst %d?", rps, burst),
		"Yes, update",
		func() (string, error) {
			if err := waf.SetRateLimit(rps, burst); err != nil {
				return "", err
			}
			return fmt.Sprintf("Rate limit updated to %d req/s, burst %d. WAF reloaded.", rps, burst), nil
		},
	)
}

func handleWAFLogs(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	n := 30
	if args != "" {
		if parsed, err := strconv.Atoi(strings.Fields(args)[0]); err == nil && parsed > 0 {
			n = parsed
		}
	}

	output, err := waf.TailLog(n)
	if err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Error: %s", err), wafMainKeyboard())
		return
	}

	if output == "" {
		output = "(empty)"
	}
	if len(output) > 3500 {
		output = output[len(output)-3500:]
	}

	b.SendMessageWithReply(chatID,
		fmt.Sprintf("%s (last %d lines):\n%s", bot.Bold("WAF Log"), n, bot.Pre(output)),
		wafMainKeyboard())
}

// --- Inline keyboard callbacks for WAF actions (prefix "w:") ---

func cbWAF(ctx context.Context, b *bot.Bot, chatID int64, messageID int64, data string) {
	// data format: "w:status", "w:whitelist", "w:logs"
	section := "status"
	if idx := strings.Index(data, ":"); idx >= 0 {
		section = data[idx+1:]
	}

	var text string
	switch section {
	case "status":
		cfg, err := waf.Read()
		if err != nil {
			b.EditMessage(chatID, messageID, fmt.Sprintf("Error: %s", err), wafMainKeyboard())
			return
		}
		active := strings.TrimSpace(waf.IsActive())
		text = bot.Bold("TrueWAF") + "\n\n"
		text += fmt.Sprintf("%s Service: %s\n", bot.StatusIcon(active), active)
		text += fmt.Sprintf("Mode: %s\n", bot.Code(cfg.Mode))
		text += fmt.Sprintf("Log level: %s\n", cfg.LogLevel)
		text += fmt.Sprintf("Proxy: %s:%d -> %s:%d\n",
			cfg.Proxy.ListenAddress, cfg.Proxy.ListenPort,
			cfg.Proxy.BackendAddress, cfg.Proxy.BackendPort)
		text += fmt.Sprintf("Workers: %d, Max conns: %d\n",
			cfg.Proxy.WorkerThreads, cfg.Proxy.MaxConnections)
		text += fmt.Sprintf("\nRate limit: %s\n", boolToEnabled(cfg.RateLimit.Enabled))
		if cfg.RateLimit.Enabled {
			text += fmt.Sprintf("  %d req/s, burst: %d, block: %ds\n",
				cfg.RateLimit.RequestsPerSecond,
				cfg.RateLimit.BurstSize,
				cfg.RateLimit.BlockDurationSeconds)
		}
		text += fmt.Sprintf("\nWhitelist: %d IPs, %d paths",
			len(cfg.Whitelist.IPs), len(cfg.Whitelist.Paths))

	case "whitelist":
		cfg, err := waf.Read()
		if err != nil {
			b.EditMessage(chatID, messageID, fmt.Sprintf("Error: %s", err), wafMainKeyboard())
			return
		}
		text = bot.Bold("WAF Whitelist") + "\n\n"
		text += bot.Bold("Paths:") + "\n"
		if len(cfg.Whitelist.Paths) == 0 {
			text += "  (none)\n"
		}
		for _, p := range cfg.Whitelist.Paths {
			text += fmt.Sprintf("  %s\n", bot.Code(p))
		}
		text += "\n" + bot.Bold("IPs:") + "\n"
		if len(cfg.Whitelist.IPs) == 0 {
			text += "  (none)\n"
		}
		for _, ip := range cfg.Whitelist.IPs {
			text += fmt.Sprintf("  %s\n", bot.Code(ip))
		}

	case "logs":
		output, err := waf.TailLog(20)
		if err != nil {
			b.EditMessage(chatID, messageID, fmt.Sprintf("Error: %s", err), wafMainKeyboard())
			return
		}
		if output == "" {
			output = "(empty)"
		}
		if len(output) > 3500 {
			output = output[len(output)-3500:]
		}
		text = fmt.Sprintf("%s (last 20 lines):\n%s", bot.Bold("WAF Log"), bot.Pre(output))

	default:
		return
	}

	b.EditMessage(chatID, messageID, text, wafMainKeyboard())
}

func wafMainKeyboard() *bot.InlineKeyboardMarkup {
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: "Status", CallbackData: "w:status"},
				{Text: "Whitelist", CallbackData: "w:whitelist"},
				{Text: "Logs", CallbackData: "w:logs"},
			},
		},
	}
}

func boolToEnabled(b bool) string {
	if b {
		return "enabled"
	}
	return "disabled"
}
