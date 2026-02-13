package handler

import "fleet-bot/bot"

// configKeyboard for secrets/nginx/git views.
func configKeyboard() *bot.InlineKeyboardMarkup {
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: "Secrets", CallbackData: "h:config"},
				{Text: "Nginx", CallbackData: "h:config"},
				{Text: "Git", CallbackData: "h:config"},
			},
		},
	}
}

// monitorKeyboard for ssl/uptime/ping/alerts/digest views.
func monitorKeyboard() *bot.InlineKeyboardMarkup {
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: "Alerts", CallbackData: "qp:alerts"},
				{Text: "Pings", CallbackData: "qp:ping"},
				{Text: "Uptime", CallbackData: "qp:uptime"},
			},
			{
				{Text: "SSL", CallbackData: "qp:ssl"},
				{Text: "Digest", CallbackData: "qp:digest"},
			},
		},
	}
}
