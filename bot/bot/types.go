package bot

import "encoding/json"

// Minimal Telegram Bot API types — only what we need.

type Update struct {
	UpdateID      int64          `json:"update_id"`
	Message       *Message       `json:"message,omitempty"`
	CallbackQuery *CallbackQuery `json:"callback_query,omitempty"`
}

type Voice struct {
	FileID   string `json:"file_id"`
	Duration int    `json:"duration"`
}

type PhotoSize struct {
	FileID   string `json:"file_id"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	FileSize int    `json:"file_size"`
}

type Document struct {
	FileID   string `json:"file_id"`
	FileName string `json:"file_name"`
	MimeType string `json:"mime_type"`
	FileSize int    `json:"file_size"`
}

type Message struct {
	MessageID      int64       `json:"message_id"`
	Chat           Chat        `json:"chat"`
	Text           string      `json:"text"`
	Caption        string      `json:"caption,omitempty"`
	From           *User       `json:"from,omitempty"`
	Voice          *Voice      `json:"voice,omitempty"`
	Photo          []PhotoSize `json:"photo,omitempty"`
	Document       *Document   `json:"document,omitempty"`
	ReplyToMessage *Message    `json:"reply_to_message,omitempty"`
}

type Chat struct {
	ID int64 `json:"id"`
}

type User struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
}

type CallbackQuery struct {
	ID      string   `json:"id"`
	From    User     `json:"from"`
	Message *Message `json:"message,omitempty"`
	Data    string   `json:"data"`
}

type InlineKeyboardMarkup struct {
	InlineKeyboard [][]InlineKeyboardButton `json:"inline_keyboard"`
}

type InlineKeyboardButton struct {
	Text         string `json:"text"`
	CallbackData string `json:"callback_data"`
}

// API response wrappers

type APIResponse struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result"`
}

type SendMessageResponse struct {
	OK     bool    `json:"ok"`
	Result Message `json:"result"`
}
