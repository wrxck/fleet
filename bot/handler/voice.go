package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"strings"

	"fleet-bot/bot"
	"fleet-bot/claude"
)

const whisperEndpoint = "https://api.openai.com/v1/audio/transcriptions"

// handleVoiceMessage downloads a voice note, transcribes via OpenAI Whisper, and forwards to Claude.
func handleVoiceMessage(ctx context.Context, b *bot.Bot, s *claude.Session, openaiKey string, chatID int64, voice *bot.Voice, messageID int64) {
	if openaiKey == "" {
		b.SendMessageWithReply(chatID, "Voice notes not configured (missing OpenAI key).", claudeResultKeyboard())
		return
	}

	msg, err := b.SendMessage(chatID, "Transcribing voice note...")
	if err != nil {
		return
	}
	statusMsgID := msg.MessageID

	// Download the voice file from Telegram
	fileURL, err := b.GetFileURL(voice.FileID)
	if err != nil {
		b.EditPlainText(chatID, statusMsgID, fmt.Sprintf("Failed to get file: %v", err))
		return
	}

	tmpFile := fmt.Sprintf("/tmp/voice-%d.ogg", messageID)
	defer os.Remove(tmpFile)

	if err := b.DownloadFile(fileURL, tmpFile); err != nil {
		b.EditPlainText(chatID, statusMsgID, fmt.Sprintf("Failed to download: %v", err))
		return
	}

	// Transcribe via OpenAI Whisper API
	text, err := transcribeWhisper(openaiKey, tmpFile)
	if err != nil {
		b.EditPlainText(chatID, statusMsgID, fmt.Sprintf("Transcription failed: %v", err))
		return
	}

	text = strings.TrimSpace(text)
	if text == "" {
		b.EditPlainText(chatID, statusMsgID, "No speech detected.")
		return
	}

	log.Printf("voice transcription (%ds): %q", voice.Duration, truncateLog(text, 80))
	b.EditMessage(chatID, statusMsgID, fmt.Sprintf("Transcribed:\n%s", bot.Code(text)), claudeResultKeyboard())

	// Forward to Claude Code
	handleClaudeMessage(ctx, b, s, chatID, text)
}

// transcribeWhisper sends an audio file to the OpenAI Whisper API and returns the text.
func transcribeWhisper(apiKey, filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("file", "audio.ogg")
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(fw, f); err != nil {
		return "", err
	}
	w.WriteField("model", "whisper-1")
	w.WriteField("response_format", "text")
	w.Close()

	req, err := http.NewRequest("POST", whisperEndpoint, &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != 200 {
		// Try to extract error message
		var apiErr struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(respBody, &apiErr) == nil && apiErr.Error.Message != "" {
			return "", fmt.Errorf("whisper API: %s", apiErr.Error.Message)
		}
		return "", fmt.Errorf("whisper API: %d %s", resp.StatusCode, string(respBody))
	}

	// response_format=text returns plain text directly
	return string(respBody), nil
}
