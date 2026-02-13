package handler

import (
	"context"

	"fleet-bot/bot"
)

// handlePalette sends a compact inline keyboard of all major actions.
func handlePalette(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	text := "Quick actions:"
	b.SendMessageWithReply(chatID, text, paletteKeyboard())
}

func paletteKeyboard() *bot.InlineKeyboardMarkup {
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: "Status", CallbackData: "qp:status"},
				{Text: "Docker", CallbackData: "qp:docker"},
				{Text: "System", CallbackData: "qp:sys"},
			},
			{
				{Text: "Health", CallbackData: "qp:health"},
				{Text: "Pings", CallbackData: "qp:ping"},
				{Text: "Uptime", CallbackData: "qp:uptime"},
			},
			{
				{Text: "SSL", CallbackData: "qp:ssl"},
				{Text: "Alerts", CallbackData: "qp:alerts"},
				{Text: "Cleanup", CallbackData: "qp:cleanup"},
			},
			{
				{Text: "Claude", CallbackData: "qp:claude"},
				{Text: "Digest", CallbackData: "qp:digest"},
				{Text: "Help", CallbackData: "qp:help"},
			},
		},
	}
}
