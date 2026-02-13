package handler

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"fleet-bot/bot"
	"fleet-bot/claude"
)

// handlePhotoMessage downloads the largest photo and forwards it to Claude with vision.
func handlePhotoMessage(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, photos []bot.PhotoSize, caption string, messageID int64) {
	// Pick the largest photo (last in array)
	photo := photos[len(photos)-1]

	b.SendChatAction(chatID, "typing")

	fileURL, err := b.GetFileURL(photo.FileID)
	if err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Failed to get photo: %v", err), claudeResultKeyboard())
		return
	}

	// Determine extension from URL
	ext := filepath.Ext(fileURL)
	if ext == "" {
		ext = ".jpg"
	}
	tmpFile := fmt.Sprintf("/tmp/photo-%d%s", messageID, ext)

	if err := b.DownloadFile(fileURL, tmpFile); err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Failed to download photo: %v", err), claudeResultKeyboard())
		return
	}

	// Build prompt — Claude Code can read images via its Read tool
	prompt := fmt.Sprintf("I'm sending you an image saved at %s — read and analyze it.", tmpFile)
	if caption != "" {
		prompt = fmt.Sprintf("I'm sending you an image saved at %s — read it. %s", tmpFile, caption)
	}

	log.Printf("photo: %dx%d caption=%q (chat: %d)", photo.Width, photo.Height, caption, chatID)

	// Schedule cleanup after Claude finishes
	go func() {
		defer os.Remove(tmpFile)
		handleClaudeMessage(ctx, b, s, chatID, prompt)
	}()
}
