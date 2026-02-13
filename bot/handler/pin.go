package handler

import (
	"context"

	"fleet-bot/bot"
)

// handlePin pins a specific message.
func handlePin(ctx context.Context, b *bot.Bot, chatID int64, msgID int64) {
	if err := b.PinMessage(chatID, msgID); err != nil {
		b.SendMessageWithReply(chatID, "Failed to pin message.", helpMainKeyboard())
		return
	}
	b.SendMessageWithReply(chatID, "Pinned.", helpMainKeyboard())
}

// handlePinCmd tells the user to reply to a message with /pin.
func handlePinCmd(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	b.SendMessageWithReply(chatID, "Reply to a message with /pin to pin it.", helpMainKeyboard())
}
