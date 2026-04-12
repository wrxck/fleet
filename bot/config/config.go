package config

import (
	"encoding/json"
	"fmt"
	"os"
)

const DefaultConfigPath = "/etc/fleet/bot.json"

type BlueBubblesConfig struct {
	Enabled              bool     `json:"enabled"`
	ServerURL            string   `json:"serverUrl"`
	Port                 int      `json:"port"`
	Password             string   `json:"password"`
	CfAccessClientID     string   `json:"cfAccessClientId"`
	CfAccessClientSecret string   `json:"cfAccessClientSecret"`
	WebhookPort          int      `json:"webhookPort"`
	AllowedNumbers       []string `json:"allowedNumbers"`
	AlertChatGuids       []string `json:"alertChatGuids"`
}

type TelegramConfig struct {
	Enabled        bool    `json:"enabled"`
	BotToken       string  `json:"botToken"`
	AllowedChatIDs []int64 `json:"allowedChatIds"`
	AlertChatIDs   []int64 `json:"alertChatIds"`
}

type AlertsConfig struct {
	Providers              []string `json:"providers"`
	MaxConsecutiveFailures int      `json:"maxConsecutiveFailures"`
	PollInterval           string   `json:"pollInterval"`
}

type AdaptersConfig struct {
	IMessage *BlueBubblesConfig `json:"imessage,omitempty"`
	Telegram *TelegramConfig    `json:"telegram,omitempty"`
}

type Config struct {
	Adapters  AdaptersConfig `json:"adapters"`
	Alerts    AlertsConfig   `json:"alerts"`
	OpenAIKey string         `json:"openaiKey"`
}

// legacyConfig represents the old /etc/fleet/telegram.json format.
type legacyConfig struct {
	BotToken  string `json:"botToken"`
	ChatID    string `json:"chatId"`
	OpenAIKey string `json:"openaiKey"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	// Try new format first.
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	// If adapters section is empty, fall back to legacy format.
	if cfg.Adapters.Telegram == nil && cfg.Adapters.IMessage == nil {
		var legacy legacyConfig
		if err := json.Unmarshal(data, &legacy); err != nil {
			return nil, fmt.Errorf("parse legacy config: %w", err)
		}

		if legacy.BotToken == "" {
			return nil, fmt.Errorf("botToken is required")
		}

		var chatIDs []int64
		if legacy.ChatID != "" {
			var id int64
			if _, err := fmt.Sscanf(legacy.ChatID, "%d", &id); err != nil {
				return nil, fmt.Errorf("parse chatId: %w", err)
			}
			chatIDs = []int64{id}
		}

		cfg = Config{
			Adapters: AdaptersConfig{
				Telegram: &TelegramConfig{
					Enabled:        true,
					BotToken:       legacy.BotToken,
					AllowedChatIDs: chatIDs,
					AlertChatIDs:   chatIDs,
				},
			},
			OpenAIKey: legacy.OpenAIKey,
		}
	}

	// Apply defaults.
	if cfg.Alerts.MaxConsecutiveFailures == 0 {
		cfg.Alerts.MaxConsecutiveFailures = 5
	}
	if cfg.Alerts.PollInterval == "" {
		cfg.Alerts.PollInterval = "2m"
	}

	return &cfg, nil
}
