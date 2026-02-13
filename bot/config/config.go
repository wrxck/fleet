package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
)

const DefaultConfigPath = "/etc/fleet/telegram.json"

type Config struct {
	BotToken  string `json:"botToken"`
	ChatID    int64  `json:"-"`
	OpenAIKey string `json:"openaiKey"`
}

type rawConfig struct {
	BotToken  string `json:"botToken"`
	ChatID    string `json:"chatId"`
	OpenAIKey string `json:"openaiKey"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var raw rawConfig
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if raw.BotToken == "" {
		return nil, fmt.Errorf("botToken is required")
	}

	chatID, err := strconv.ParseInt(raw.ChatID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("parse chatId: %w", err)
	}

	return &Config{
		BotToken:  raw.BotToken,
		ChatID:    chatID,
		OpenAIKey: raw.OpenAIKey,
	}, nil
}
