package handler

import (
	"context"
	"fmt"
	"strings"

	"fleet-bot/bot"
)

// AlertFunc handles a command that needs the AlertMonitor.
type AlertFunc func(ctx context.Context, b *bot.Bot, m *AlertMonitor, chatID int64, args string)

func handleAlerts(ctx context.Context, b *bot.Bot, m *AlertMonitor, chatID int64, args string) {
	if args == "" {
		text := alertStatusText(m)
		text += "\n\nUsage:\n"
		text += "/alerts on|off — toggle monitoring\n"
		text += "/alerts restart on|off — toggle auto-restart\n"
		text += "/alerts mute on|off — only alert on down/recovery"

		kb := alertsKeyboard(m)
		b.SendMessageWithReply(chatID, text, kb)
		return
	}

	fields := strings.Fields(args)
	switch fields[0] {
	case "on":
		m.SetEnabled(true)
		b.SendMessageWithReply(chatID, "Health alerts enabled.", alertsKeyboard(m))
	case "off":
		m.SetEnabled(false)
		b.SendMessageWithReply(chatID, "Health alerts disabled.", alertsKeyboard(m))
	case "restart":
		if len(fields) < 2 {
			b.SendMessageWithReply(chatID, fmt.Sprintf("Auto-restart: %v\nUsage: /alerts restart on|off", m.AutoRestart()), alertsKeyboard(m))
			return
		}
		switch fields[1] {
		case "on":
			m.SetAutoRestart(true)
			b.SendMessageWithReply(chatID, "Auto-restart enabled.", alertsKeyboard(m))
		case "off":
			m.SetAutoRestart(false)
			b.SendMessageWithReply(chatID, "Auto-restart disabled.", alertsKeyboard(m))
		}
	case "mute":
		if len(fields) < 2 {
			b.SendMessageWithReply(chatID, fmt.Sprintf("Mute non-critical: %v\nUsage: /alerts mute on|off", m.MuteNonCrit()), alertsKeyboard(m))
			return
		}
		switch fields[1] {
		case "on":
			m.SetMuteNonCrit(true)
			b.SendMessageWithReply(chatID, "Non-critical alerts muted. Only down/recovery alerts will fire.", alertsKeyboard(m))
		case "off":
			m.SetMuteNonCrit(false)
			b.SendMessageWithReply(chatID, "All alerts enabled.", alertsKeyboard(m))
		}
	}
}

func alertStatusText(m *AlertMonitor) string {
	text := bot.Bold("Health Alerts") + "\n\n"
	text += fmt.Sprintf("Monitoring:   %s\n", onOff(m.IsEnabled()))
	text += fmt.Sprintf("Auto-restart: %s\n", onOff(m.AutoRestart()))
	text += fmt.Sprintf("Mute minor:   %s", onOff(m.MuteNonCrit()))
	return text
}

func onOff(v bool) string {
	if v {
		return "ON"
	}
	return "OFF"
}

func alertsKeyboard(m *AlertMonitor) *bot.InlineKeyboardMarkup {
	monLabel := "Alerts: ON"
	monData := "al:off"
	if !m.IsEnabled() {
		monLabel = "Alerts: OFF"
		monData = "al:on"
	}
	restartLabel := "Restart: ON"
	restartData := "al:restart:off"
	if !m.AutoRestart() {
		restartLabel = "Restart: OFF"
		restartData = "al:restart:on"
	}
	muteLabel := "Mute: ON"
	muteData := "al:mute:off"
	if !m.MuteNonCrit() {
		muteLabel = "Mute: OFF"
		muteData = "al:mute:on"
	}
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: monLabel, CallbackData: monData},
				{Text: restartLabel, CallbackData: restartData},
				{Text: muteLabel, CallbackData: muteData},
			},
		},
	}
}

// CbAlertFunc handles alert inline callbacks.
type CbAlertFunc func(ctx context.Context, b *bot.Bot, m *AlertMonitor, chatID int64, messageID int64, data string)

func cbAlerts(ctx context.Context, b *bot.Bot, m *AlertMonitor, chatID int64, messageID int64, data string) {
	parts := strings.SplitN(data, ":", 3)
	if len(parts) < 2 {
		return
	}

	switch parts[1] {
	case "on":
		m.SetEnabled(true)
	case "off":
		m.SetEnabled(false)
	case "restart":
		if len(parts) < 3 {
			return
		}
		switch parts[2] {
		case "on":
			m.SetAutoRestart(true)
		case "off":
			m.SetAutoRestart(false)
		}
	case "mute":
		if len(parts) < 3 {
			return
		}
		switch parts[2] {
		case "on":
			m.SetMuteNonCrit(true)
		case "off":
			m.SetMuteNonCrit(false)
		}
	}

	b.EditMessage(chatID, messageID, alertStatusText(m), alertsKeyboard(m))
}
