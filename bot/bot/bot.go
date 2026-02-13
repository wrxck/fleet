package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	apiBase     = "https://api.telegram.org/bot"
	pollTimeout = 30 // long-poll timeout in seconds
	maxMsgLen   = 4096
)

// Handler processes a single Telegram update.
type Handler interface {
	Handle(ctx context.Context, b *Bot, u Update)
}

// Bot is the Telegram bot client.
type Bot struct {
	token  string
	chatID int64
	client *http.Client
}

func New(token string, chatID int64) *Bot {
	return &Bot{
		token:  token,
		chatID: chatID,
		client: &http.Client{Timeout: 60 * time.Second},
	}
}

func (b *Bot) ChatID() int64 {
	return b.chatID
}

// Poll does long-polling for updates and dispatches to handler.
func (b *Bot) Poll(ctx context.Context, h Handler) {
	offset := int64(0)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		updates, err := b.getUpdates(ctx, offset)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("poll error: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}

		for _, u := range updates {
			offset = u.UpdateID + 1
			h.Handle(ctx, b, u)
		}
	}
}

func (b *Bot) getUpdates(ctx context.Context, offset int64) ([]Update, error) {
	params := map[string]interface{}{
		"offset":  offset,
		"timeout": pollTimeout,
	}

	body, err := b.apiCall(ctx, "getUpdates", params)
	if err != nil {
		return nil, err
	}

	var resp struct {
		OK     bool     `json:"ok"`
		Result []Update `json:"result"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("decode updates: %w", err)
	}
	if !resp.OK {
		return nil, fmt.Errorf("getUpdates not ok: %s", string(body))
	}
	return resp.Result, nil
}

// SendMessage sends an HTML message and returns the sent message.
func (b *Bot) SendMessage(chatID int64, text string) (*Message, error) {
	return b.sendMessage(chatID, text, nil, 0)
}

// SendMessageWithReply sends an HTML message with inline keyboard.
func (b *Bot) SendMessageWithReply(chatID int64, text string, markup *InlineKeyboardMarkup) (*Message, error) {
	return b.sendMessage(chatID, text, markup, 0)
}

// ReplyTo sends an HTML message as a reply to a specific message.
func (b *Bot) ReplyTo(chatID int64, replyTo int64, text string) (*Message, error) {
	return b.sendMessage(chatID, text, nil, replyTo)
}

func (b *Bot) sendMessage(chatID int64, text string, markup *InlineKeyboardMarkup, replyTo int64) (*Message, error) {
	if len(text) > maxMsgLen {
		text = text[:maxMsgLen-20] + "\n...(truncated)"
	}

	params := map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}
	if markup != nil {
		params["reply_markup"] = markup
	}
	if replyTo > 0 {
		params["reply_to_message_id"] = replyTo
	}

	body, err := b.apiCall(context.Background(), "sendMessage", params)
	if err != nil {
		return nil, err
	}

	var resp SendMessageResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	return &resp.Result, nil
}

// EditMessage edits a previously sent message.
func (b *Bot) EditMessage(chatID int64, messageID int64, text string, markup *InlineKeyboardMarkup) error {
	if len(text) > maxMsgLen {
		text = text[:maxMsgLen-20] + "\n...(truncated)"
	}

	params := map[string]interface{}{
		"chat_id":    chatID,
		"message_id": messageID,
		"text":       text,
		"parse_mode": "HTML",
	}
	if markup != nil {
		params["reply_markup"] = markup
	}

	_, err := b.apiCall(context.Background(), "editMessageText", params)
	return err
}

// SendPlainText sends a message without parse_mode (safe for arbitrary text).
func (b *Bot) SendPlainText(chatID int64, text string) (*Message, error) {
	if len(text) > maxMsgLen {
		text = text[:maxMsgLen-20] + "\n...(truncated)"
	}
	params := map[string]interface{}{
		"chat_id": chatID,
		"text":    text,
	}
	body, err := b.apiCall(context.Background(), "sendMessage", params)
	if err != nil {
		return nil, err
	}
	var resp SendMessageResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	return &resp.Result, nil
}

// SendPlainChunked sends text split across multiple messages at ~4000-char boundaries.
func (b *Bot) SendPlainChunked(chatID int64, text string) error {
	const chunkMax = 4000
	for len(text) > 0 {
		end := chunkMax
		if end > len(text) {
			end = len(text)
		}
		// Try to break at a newline
		if end < len(text) {
			if nl := strings.LastIndex(text[:end], "\n"); nl > end/2 {
				end = nl + 1
			}
		}
		chunk := text[:end]
		text = text[end:]
		if _, err := b.SendPlainText(chatID, chunk); err != nil {
			return err
		}
	}
	return nil
}

// EditPlainText edits a message without parse_mode.
func (b *Bot) EditPlainText(chatID int64, messageID int64, text string) error {
	if len(text) > maxMsgLen {
		text = text[:maxMsgLen-20] + "\n...(truncated)"
	}
	params := map[string]interface{}{
		"chat_id":    chatID,
		"message_id": messageID,
		"text":       text,
	}
	_, err := b.apiCall(context.Background(), "editMessageText", params)
	return err
}

// PinMessage pins a message in the chat.
func (b *Bot) PinMessage(chatID int64, messageID int64) error {
	params := map[string]interface{}{
		"chat_id":              chatID,
		"message_id":           messageID,
		"disable_notification": true,
	}
	_, err := b.apiCall(context.Background(), "pinChatMessage", params)
	return err
}

// SendChatAction sends a chat action (e.g. "typing") indicator.
func (b *Bot) SendChatAction(chatID int64, action string) {
	params := map[string]interface{}{
		"chat_id": chatID,
		"action":  action,
	}
	b.apiCall(context.Background(), "sendChatAction", params)
}

// AnswerCallback acknowledges a callback query.
func (b *Bot) AnswerCallback(callbackID string) error {
	params := map[string]interface{}{
		"callback_query_id": callbackID,
	}
	_, err := b.apiCall(context.Background(), "answerCallbackQuery", params)
	return err
}

// GetFileURL calls getFile and returns the full download URL for a file_id.
func (b *Bot) GetFileURL(fileID string) (string, error) {
	params := map[string]interface{}{"file_id": fileID}
	body, err := b.apiCall(context.Background(), "getFile", params)
	if err != nil {
		return "", err
	}
	var resp struct {
		OK     bool `json:"ok"`
		Result struct {
			FilePath string `json:"file_path"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("decode getFile: %w", err)
	}
	if !resp.OK || resp.Result.FilePath == "" {
		return "", fmt.Errorf("getFile failed: %s", string(body))
	}
	return "https://api.telegram.org/file/bot" + b.token + "/" + resp.Result.FilePath, nil
}

// DownloadFile downloads a URL to a local file path.
func (b *Bot) DownloadFile(url, destPath string) error {
	resp, err := b.client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download %s: status %d", url, resp.StatusCode)
	}
	f, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

func (b *Bot) apiCall(ctx context.Context, method string, params map[string]interface{}) ([]byte, error) {
	url := apiBase + b.token + "/" + method
	payload, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("telegram API %s: %d %s", method, resp.StatusCode, string(body))
	}
	return body, nil
}
