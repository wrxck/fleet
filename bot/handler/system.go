package handler

import (
	"context"
	"fmt"
	"strings"

	"time"

	"fleet-bot/bot"
	"fleet-bot/exec"
	"fleet-bot/monitor"
)

func handleSys(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	s := monitor.GetSystemStats()

	text := bot.Bold("System") + " — " + bot.Code(s.Hostname) + "\n\n"
	text += fmt.Sprintf("Uptime: %s\n", s.Uptime)
	text += fmt.Sprintf("Load:   %s\n", bot.Code(fmt.Sprintf("%.2f %.2f %.2f", s.LoadAvg1, s.LoadAvg5, s.LoadAvg15)))
	text += fmt.Sprintf("CPU:    %s\n", bot.FormatPercent(s.CPUPercent))
	text += fmt.Sprintf("Memory: %s / %s (%s)\n",
		bot.FormatBytes(s.MemUsed), bot.FormatBytes(s.MemTotal), bot.FormatPercent(s.MemPercent))
	if s.SwapTotal > 0 {
		text += fmt.Sprintf("Swap:   %s / %s\n",
			bot.FormatBytes(s.SwapUsed), bot.FormatBytes(s.SwapTotal))
	}
	text += fmt.Sprintf("Disk:   %s / %s (%s)\n",
		bot.FormatBytes(s.DiskUsed), bot.FormatBytes(s.DiskTotal), bot.FormatPercent(s.DiskPercent))

	b.SendMessageWithReply(chatID, text, systemKeyboard("sys"))
}

func handleDocker(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	containers, err := monitor.GetContainers()
	if err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Error: %s", err), systemKeyboard("docker"))
		return
	}

	if len(containers) == 0 {
		b.SendMessageWithReply(chatID, "No containers found.", systemKeyboard("docker"))
		return
	}

	text := bot.Bold("Docker Containers") + fmt.Sprintf(" (%d)\n\n", len(containers))

	running := 0
	for _, c := range containers {
		if c.State == "running" {
			running++
		}
	}
	text += fmt.Sprintf("%d running\n\n", running)

	for _, c := range containers {
		icon := bot.StatusIcon(c.State)
		line := fmt.Sprintf("%s %s  %s", icon, bot.Code(c.Name), c.State)
		if c.Health != "" {
			line += fmt.Sprintf(" (%s)", c.Health)
		}
		if c.State == "running" {
			line += fmt.Sprintf("\n  CPU: %s  Mem: %s/%s  PIDs: %d",
				bot.FormatPercent(c.CPUPerc),
				bot.FormatBytes(c.MemUsed),
				bot.FormatBytes(c.MemMax),
				c.PIDs,
			)
		}
		text += line + "\n"
	}

	// Truncate if too long — switch to compact format
	if len(text) > 4000 {
		text = bot.Bold("Docker Containers") + fmt.Sprintf(" (%d, %d running)\n\n", len(containers), running)
		for _, c := range containers {
			icon := bot.StatusIcon(c.State)
			line := fmt.Sprintf("%s %s %s", icon, bot.Code(c.Name), c.State)
			if c.State == "running" {
				line += fmt.Sprintf(" cpu:%s mem:%s",
					bot.FormatPercent(c.CPUPerc), bot.FormatBytes(c.MemUsed))
			}
			text += line + "\n"
		}
	}

	b.SendMessageWithReply(chatID, text, systemKeyboard("docker"))
}

func handleServices(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	services := []string{"docker", "nginx", "truewaf", "fleet-bot", "docker-dash"}

	text := bot.Bold("Services") + "\n\n"
	for _, svc := range services {
		res, err := exec.Run(5*time.Second, "systemctl", "is-active", svc)
		state := "unknown"
		if err == nil {
			state = strings.TrimSpace(res.Stdout)
		} else if res != nil {
			state = strings.TrimSpace(res.Stdout)
		}
		text += fmt.Sprintf("%s %s: %s\n", bot.StatusIcon(state), bot.Code(svc), state)
	}

	b.SendMessageWithReply(chatID, text, systemKeyboard("services"))
}

// --- Inline keyboard callbacks for system actions (prefix "s:") ---

func cbSystem(ctx context.Context, b *bot.Bot, chatID int64, messageID int64, data string) {
	// data format: "s:sys", "s:docker", "s:services"
	section := "sys"
	if idx := strings.Index(data, ":"); idx >= 0 {
		section = data[idx+1:]
	}

	var text string
	switch section {
	case "sys":
		s := monitor.GetSystemStats()
		text = bot.Bold("System") + " — " + bot.Code(s.Hostname) + "\n\n"
		text += fmt.Sprintf("Uptime: %s\n", s.Uptime)
		text += fmt.Sprintf("Load:   %s\n", bot.Code(fmt.Sprintf("%.2f %.2f %.2f", s.LoadAvg1, s.LoadAvg5, s.LoadAvg15)))
		text += fmt.Sprintf("CPU:    %s\n", bot.FormatPercent(s.CPUPercent))
		text += fmt.Sprintf("Memory: %s / %s (%s)\n",
			bot.FormatBytes(s.MemUsed), bot.FormatBytes(s.MemTotal), bot.FormatPercent(s.MemPercent))
		if s.SwapTotal > 0 {
			text += fmt.Sprintf("Swap:   %s / %s\n",
				bot.FormatBytes(s.SwapUsed), bot.FormatBytes(s.SwapTotal))
		}
		text += fmt.Sprintf("Disk:   %s / %s (%s)\n",
			bot.FormatBytes(s.DiskUsed), bot.FormatBytes(s.DiskTotal), bot.FormatPercent(s.DiskPercent))

	case "docker":
		containers, err := monitor.GetContainers()
		if err != nil {
			b.EditMessage(chatID, messageID, fmt.Sprintf("Error: %s", err), systemKeyboard("docker"))
			return
		}
		if len(containers) == 0 {
			text = "No containers found."
		} else {
			running := 0
			for _, c := range containers {
				if c.State == "running" {
					running++
				}
			}
			text = bot.Bold("Docker Containers") + fmt.Sprintf(" (%d, %d running)\n\n", len(containers), running)
			for _, c := range containers {
				icon := bot.StatusIcon(c.State)
				line := fmt.Sprintf("%s %s  %s", icon, bot.Code(c.Name), c.State)
				if c.State == "running" {
					line += fmt.Sprintf("  cpu:%s mem:%s",
						bot.FormatPercent(c.CPUPerc), bot.FormatBytes(c.MemUsed))
				}
				text += line + "\n"
			}
		}

	case "services":
		text = bot.Bold("Services") + "\n\n"
		for _, svc := range []string{"docker", "nginx", "truewaf", "fleet-bot", "docker-dash"} {
			res, err := exec.Run(5*time.Second, "systemctl", "is-active", svc)
			state := "unknown"
			if err == nil {
				state = strings.TrimSpace(res.Stdout)
			} else if res != nil {
				state = strings.TrimSpace(res.Stdout)
			}
			text += fmt.Sprintf("%s %s: %s\n", bot.StatusIcon(state), bot.Code(svc), state)
		}

	default:
		return
	}

	b.EditMessage(chatID, messageID, text, systemKeyboard(section))
}

func systemKeyboard(active string) *bot.InlineKeyboardMarkup {
	sysLabel, dockerLabel, svcLabel := "System", "Docker", "Services"
	switch active {
	case "sys":
		sysLabel = "~ System ~"
	case "docker":
		dockerLabel = "~ Docker ~"
	case "services":
		svcLabel = "~ Services ~"
	}
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: sysLabel, CallbackData: "s:sys"},
				{Text: dockerLabel, CallbackData: "s:docker"},
				{Text: svcLabel, CallbackData: "s:services"},
			},
		},
	}
}
