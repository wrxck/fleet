package handler

import (
	"context"
	"fmt"
	"strings"

	"fleet-bot/bot"
)

func handleStart(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	text := bot.Bold("Fleet Bot") + "\n\nManage your server and code from Telegram.\n\nJust type naturally to talk to Claude Code.\nSend ? for quick actions. Type /help to see all commands."
	b.SendMessageWithReply(chatID, text, helpMainKeyboard())
}

func handleID(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	b.SendMessageWithReply(chatID, fmt.Sprintf("Chat ID: %s", bot.Code(fmt.Sprintf("%d", chatID))), helpMainKeyboard())
}

func handleHelp(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	b.SendMessageWithReply(chatID, helpMainText(), helpMainKeyboard())
}

// cbHelp handles help inline keyboard callbacks: h:fleet, h:main, etc.
func cbHelp(ctx context.Context, b *bot.Bot, chatID int64, messageID int64, data string) {
	section := "main"
	if idx := strings.Index(data, ":"); idx >= 0 {
		section = data[idx+1:]
	}

	var text string
	var kb *bot.InlineKeyboardMarkup

	switch section {
	case "fleet":
		text = bot.Bold("Fleet Commands") + "\n\n"
		text += "/status - Dashboard overview\n"
		text += "/list - All registered apps\n"
		text += "/health [app] - Health check\n"
		text += "/start_app &lt;app&gt; - Start an app\n"
		text += "/stop &lt;app&gt; - Stop an app\n"
		text += "/restart &lt;app&gt; - Restart an app\n"
		text += "/deploy &lt;app&gt; - Deploy an app\n"
		text += "/deploy_at &lt;app&gt; &lt;HH:MM&gt; - Scheduled deploy\n"
		text += "/logs &lt;app&gt; [n] - View logs\n"
		text += "/logsearch &lt;app&gt; &lt;pattern&gt; - Search logs\n"
		text += "/watchdog - Watchdog status"
		kb = backToHelpKB()
	case "config":
		text = bot.Bold("Config Commands") + "\n\n"
		text += "/secrets - Vault status\n"
		text += "/secrets_list [app] - List secrets\n"
		text += "/secrets_validate [app] - Validate secrets\n"
		text += "/nginx - Nginx proxy configs\n"
		text += "/git [app] - Git status"
		kb = backToHelpKB()
	case "system":
		text = bot.Bold("System Commands") + "\n\n"
		text += "/sys - CPU, memory, disk, load\n"
		text += "/docker - Container stats\n"
		text += "/services - Critical services\n"
		text += "/sh &lt;cmd&gt; - Run shell command\n"
		text += "/cleanup - Docker disk cleanup\n"
		text += "/pin - Pin a replied-to message"
		kb = backToHelpKB()
	case "waf":
		text = bot.Bold("TrueWAF Commands") + "\n\n"
		text += "/waf - WAF status\n"
		text += "/waf_whitelist - Show whitelist\n"
		text += "/waf_whitelist_add &lt;ip&gt; - Add IP\n"
		text += "/waf_whitelist_rm &lt;ip&gt; - Remove IP\n"
		text += "/waf_rate &lt;rps&gt; &lt;burst&gt; - Set rate limit\n"
		text += "/waf_logs [n] - Tail WAF log"
		kb = backToHelpKB()
	case "claude":
		text = bot.Bold("Claude Code") + "\n\n"
		text += "Send text, voice, photo, or file — it all goes to Claude.\n"
		text += "Server context (down apps) is auto-injected.\n\n"
		text += "/cc_stop - Cancel running operation\n"
		text += "/cc_reset - Start fresh session\n"
		text += "/cc_resume [text] - Continue conversation\n"
		text += "/cc_history - Recent prompts (tap to re-run)\n"
		text += "/cc_sessions - Browse/resume past sessions\n"
		text += "/cc_cd &lt;path&gt; - Change working dir\n"
		text += "/cc_model &lt;model&gt; - Switch model\n"
		text += "/cc_status - Session info"
		kb = backToHelpKB()
	case "monitor":
		text = bot.Bold("Monitoring") + "\n\n"
		text += "/alerts - Health alert settings\n"
		text += "/alerts mute on|off - Mute non-critical\n"
		text += "/ping - HTTP ping all domains\n"
		text += "/uptime - Per-app uptime percentages\n"
		text += "/ssl - SSL certificate expiry check\n"
		text += "/digest - Trigger daily digest now"
		kb = backToHelpKB()
	case "meta":
		text = bot.Bold("Meta") + "\n\n"
		text += "/id - Show chat ID\n"
		text += "/help - This menu\n"
		text += "? - Quick action palette"
		kb = backToHelpKB()
	default:
		text = helpMainText()
		kb = helpMainKeyboard()
	}

	b.EditMessage(chatID, messageID, text, kb)
}

func helpMainText() string {
	return bot.Bold("Fleet Bot") + "\n\nChoose a category:"
}

func helpMainKeyboard() *bot.InlineKeyboardMarkup {
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: "Fleet", CallbackData: "h:fleet"},
				{Text: "Config", CallbackData: "h:config"},
				{Text: "System", CallbackData: "h:system"},
			},
			{
				{Text: "WAF", CallbackData: "h:waf"},
				{Text: "Claude", CallbackData: "h:claude"},
				{Text: "Monitor", CallbackData: "h:monitor"},
			},
			{
				{Text: "Meta", CallbackData: "h:meta"},
			},
		},
	}
}

func backToHelpKB() *bot.InlineKeyboardMarkup {
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{{Text: "< Back", CallbackData: "h:main"}},
		},
	}
}
