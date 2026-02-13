package handler

import (
	"context"
	"fmt"
	"log"
	"os"

	"fleet-bot/bot"
	"fleet-bot/claude"
)

// Text-safe MIME types and extensions we'll read inline. Everything else gets passed as a file path.
var textExtensions = map[string]bool{
	".go": true, ".py": true, ".js": true, ".ts": true, ".jsx": true, ".tsx": true,
	".rs": true, ".c": true, ".cpp": true, ".h": true, ".java": true, ".kt": true,
	".rb": true, ".php": true, ".sh": true, ".bash": true, ".zsh": true,
	".html": true, ".css": true, ".scss": true, ".sql": true, ".graphql": true,
	".json": true, ".yaml": true, ".yml": true, ".toml": true, ".xml": true, ".csv": true,
	".md": true, ".txt": true, ".log": true, ".env": true, ".ini": true, ".cfg": true,
	".dockerfile": true, ".gitignore": true, ".editorconfig": true,
	".tf": true, ".hcl": true, ".nix": true, ".lua": true, ".vim": true,
}

// handleDocumentMessage downloads a document and forwards it to Claude.
func handleDocumentMessage(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, doc *bot.Document, caption string, messageID int64) {
	b.SendChatAction(chatID, "typing")

	fileURL, err := b.GetFileURL(doc.FileID)
	if err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Failed to get file: %v", err), claudeResultKeyboard())
		return
	}

	tmpFile := fmt.Sprintf("/tmp/doc-%d-%s", messageID, doc.FileName)
	if err := b.DownloadFile(fileURL, tmpFile); err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Failed to download: %v", err), claudeResultKeyboard())
		return
	}

	log.Printf("document: %s (%s, %d bytes) (chat: %d)", doc.FileName, doc.MimeType, doc.FileSize, chatID)

	// Build prompt — tell Claude to read the file
	prompt := fmt.Sprintf("I'm sending you a file: %s (saved at %s). Read it and analyze its contents.", doc.FileName, tmpFile)
	if caption != "" {
		prompt = fmt.Sprintf("I'm sending you a file: %s (saved at %s). Read it. %s", doc.FileName, tmpFile, caption)
	}

	go func() {
		defer os.Remove(tmpFile)
		handleClaudeMessage(ctx, b, s, chatID, prompt)
	}()
}
