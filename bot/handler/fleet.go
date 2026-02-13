package handler

import (
	"context"
	"fmt"
	"strings"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

// StatusData matches fleet status --json output.
type StatusData struct {
	Name    string `json:"name"`
	Service string `json:"service"`
	State   string `json:"state"`
	Health  string `json:"health"`
}

type StatusResponse struct {
	Apps []StatusData `json:"apps"`
}

// ListData matches fleet list --json output.
type ListData struct {
	Name        string   `json:"name"`
	DisplayName string   `json:"displayName"`
	Type        string   `json:"type"`
	Port        *int     `json:"port"`
	Containers  []string `json:"containers"`
}

// HealthData matches fleet health --json output.
type HealthData struct {
	App    string `json:"app"`
	Systemd struct {
		OK    bool   `json:"ok"`
		State string `json:"state"`
	} `json:"systemd"`
	Containers []struct {
		Name    string `json:"name"`
		Running bool   `json:"running"`
		Health  string `json:"health"`
	} `json:"containers"`
	HTTP *struct {
		OK     bool    `json:"ok"`
		Status *int    `json:"status"`
		Error  *string `json:"error"`
	} `json:"http,omitempty"`
	Overall string `json:"overall"`
}

func handleStatus(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	resp, err := exec.FleetJSON[StatusResponse]("status")
	if err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Error: %s", err), helpMainKeyboard())
		return
	}
	apps := resp.Apps

	text := bot.Bold("Fleet Status") + "\n\n"
	healthy, degraded, down := 0, 0, 0
	for _, a := range apps {
		icon := bot.StatusIcon(a.Health)
		text += fmt.Sprintf("%s %s  %s\n", icon, bot.Code(a.Name), a.Health)
		switch a.Health {
		case "healthy":
			healthy++
		case "degraded":
			degraded++
		case "down":
			down++
		}
	}

	text += fmt.Sprintf("\n%d healthy", healthy)
	if degraded > 0 {
		text += fmt.Sprintf(", %d degraded", degraded)
	}
	if down > 0 {
		text += fmt.Sprintf(", %d down", down)
	}

	// Build app buttons grid (3 per row)
	kb := appGridKeyboard(apps)
	b.SendMessageWithReply(chatID, text, kb)
}

func handleList(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	apps, err := exec.FleetJSON[[]ListData]("list")
	if err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Error: %s", err), helpMainKeyboard())
		return
	}

	text := bot.Bold("Registered Apps") + fmt.Sprintf(" (%d)\n\n", len(apps))
	for _, a := range apps {
		port := "-"
		if a.Port != nil {
			port = fmt.Sprintf("%d", *a.Port)
		}
		text += fmt.Sprintf("%s  %s  port:%s  containers:%d\n",
			bot.Code(a.Name), a.Type, port, len(a.Containers))
	}

	// Reuse same grid
	var statusApps []StatusData
	for _, a := range apps {
		statusApps = append(statusApps, StatusData{Name: a.Name})
	}
	kb := appGridKeyboard(statusApps)
	b.SendMessageWithReply(chatID, text, kb)
}

func handleHealth(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	cmdArgs := []string{"health"}
	if args != "" {
		cmdArgs = append(cmdArgs, args)
	}

	if args != "" {
		data, err := exec.FleetJSON[HealthData](cmdArgs...)
		if err != nil {
			b.SendMessageWithReply(chatID, fmt.Sprintf("Error: %s", err), helpMainKeyboard())
			return
		}
		text := formatHealthDetail(&data)
		b.SendMessageWithReply(chatID, text, appActionKeyboard(data.App))
	} else {
		data, err := exec.FleetJSON[[]HealthData](cmdArgs...)
		if err != nil {
			b.SendMessageWithReply(chatID, fmt.Sprintf("Error: %s", err), helpMainKeyboard())
			return
		}
		text := bot.Bold("Health Check") + "\n\n"
		for _, d := range data {
			text += fmt.Sprintf("%s %s: %s\n", bot.StatusIcon(d.Overall), bot.Code(d.App), d.Overall)
		}
		b.SendMessageWithReply(chatID, text, monitorKeyboard())
	}
}

func handleStartApp(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	if args == "" {
		b.SendMessageWithReply(chatID, "Usage: /start_app <app>", helpMainKeyboard())
		return
	}

	app := strings.Fields(args)[0]
	b.SendMessageWithReply(chatID, fmt.Sprintf("Starting %s...", bot.Bold(app)), appActionKeyboard(app))

	res, err := exec.FleetMutate("start", app)
	if err != nil {
		msg := "Error starting " + app
		if res != nil && res.Stderr != "" {
			msg += "\n" + bot.Pre(res.Stderr)
		}
		b.SendMessageWithReply(chatID, msg, appActionKeyboard(app))
		return
	}

	output := res.Stdout
	if res.Stderr != "" {
		output += "\n" + res.Stderr
	}
	if output == "" {
		output = "Started successfully."
	}
	b.SendMessageWithReply(chatID,
		fmt.Sprintf("%s %s\n%s", bot.StatusIcon("healthy"), bot.Bold(app), output),
		appActionKeyboard(app))
}

func handleStopConfirm(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, args string) {
	if args == "" {
		b.SendMessageWithReply(chatID, "Usage: /stop <app>", helpMainKeyboard())
		return
	}
	app := strings.Fields(args)[0]

	cm.Request(b, chatID,
		fmt.Sprintf("Stop %s? This will take the app offline.", bot.Bold(app)),
		"Yes, stop it",
		func() (string, error) {
			res, err := exec.FleetMutate("stop", app)
			if err != nil {
				detail := ""
				if res != nil && res.Stderr != "" {
					detail = "\n" + res.Stderr
				}
				return "", fmt.Errorf("failed to stop %s%s", app, detail)
			}
			return fmt.Sprintf("%s %s stopped.", bot.StatusIcon("down"), bot.Bold(app)), nil
		},
	)
}

func handleRestartConfirm(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, args string) {
	if args == "" {
		b.SendMessageWithReply(chatID, "Usage: /restart <app>", helpMainKeyboard())
		return
	}
	app := strings.Fields(args)[0]

	cm.Request(b, chatID,
		fmt.Sprintf("Restart %s?", bot.Bold(app)),
		"Yes, restart",
		func() (string, error) {
			res, err := exec.FleetMutate("restart", app)
			if err != nil {
				detail := ""
				if res != nil && res.Stderr != "" {
					detail = "\n" + res.Stderr
				}
				return "", fmt.Errorf("failed to restart %s%s", app, detail)
			}
			return fmt.Sprintf("%s %s restarted.", bot.StatusIcon("healthy"), bot.Bold(app)), nil
		},
	)
}

func handleDeployConfirm(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, args string) {
	if args == "" {
		b.SendMessageWithReply(chatID, "Usage: /deploy <app>", helpMainKeyboard())
		return
	}
	app := strings.Fields(args)[0]

	cm.Request(b, chatID,
		fmt.Sprintf("Deploy %s? This will rebuild and restart the app.", bot.Bold(app)),
		"Yes, deploy",
		func() (string, error) {
			res, err := exec.FleetMutate("deploy", app, "-y")
			if err != nil {
				detail := ""
				if res != nil {
					detail = res.Stdout + "\n" + res.Stderr
				}
				return "", fmt.Errorf("deploy failed for %s\n%s", app, detail)
			}
			output := res.Stdout
			if len(output) > 3500 {
				output = output[len(output)-3500:]
			}
			return fmt.Sprintf("%s %s deployed.\n%s", bot.StatusIcon("healthy"), bot.Bold(app), bot.Pre(output)), nil
		},
	)
}

func handleLogs(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	if args == "" {
		b.SendMessageWithReply(chatID, "Usage: /logs <app> [lines]", helpMainKeyboard())
		return
	}

	fields := strings.Fields(args)
	app := fields[0]
	n := "30"
	if len(fields) > 1 {
		n = fields[1]
	}

	res, err := exec.FleetRead("logs", app, "-n", n)
	if err != nil {
		msg := fmt.Sprintf("Error fetching logs for %s", app)
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		b.SendMessageWithReply(chatID, msg, helpMainKeyboard())
		return
	}

	output := res.Stdout
	if output == "" {
		output = "(no logs)"
	}
	if len(output) > 3500 {
		output = output[len(output)-3500:]
	}

	b.SendMessageWithReply(chatID,
		fmt.Sprintf("%s logs (last %s lines):\n%s", bot.Bold(app), n, bot.Pre(output)),
		appActionKeyboard(app))
}

func handleWatchdog(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	res, err := exec.FleetRead("watchdog")
	if err != nil {
		msg := "Error running watchdog"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		b.SendMessageWithReply(chatID, msg, systemKeyboard("sys"))
		return
	}

	output := res.Stdout
	if output == "" {
		output = "(no output)"
	}
	b.SendMessageWithReply(chatID, fmt.Sprintf("%s\n%s", bot.Bold("Watchdog"), bot.Pre(output)), systemKeyboard("sys"))
}

// --- Inline keyboard callbacks for app actions (prefix "a:") ---

func cbApp(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, messageID int64, data string) {
	// data format: "a:appname" or "a:appname:action" or "a:appname:action!"
	parts := strings.SplitN(data, ":", 3)
	if len(parts) < 2 {
		return
	}
	app := parts[1]

	if app == "_back" {
		// Back to status grid
		resp, err := exec.FleetJSON[StatusResponse]("status")
		if err != nil {
			b.EditMessage(chatID, messageID, fmt.Sprintf("Error: %s", err), appGridKeyboard(nil))
			return
		}
		apps := resp.Apps
		text := bot.Bold("Fleet Status") + "\n\n"
		for _, a := range apps {
			icon := bot.StatusIcon(a.Health)
			text += fmt.Sprintf("%s %s  %s\n", icon, bot.Code(a.Name), a.Health)
		}
		b.EditMessage(chatID, messageID, text, appGridKeyboard(apps))
		return
	}

	if len(parts) == 2 {
		// Show app action menu
		text := fmt.Sprintf("%s\n\nSelect an action:", bot.Bold(app))
		b.EditMessage(chatID, messageID, text, appActionKeyboard(app))
		return
	}

	action := parts[2]
	switch action {
	case "health":
		data, err := exec.FleetJSON[HealthData]("health", app)
		if err != nil {
			b.EditMessage(chatID, messageID, fmt.Sprintf("Error: %s", err), appActionKeyboard(app))
			return
		}
		text := formatHealthDetail(&data)
		b.EditMessage(chatID, messageID, text, appActionKeyboard(app))

	case "logs":
		res, err := exec.FleetRead("logs", app, "-n", "20")
		if err != nil {
			b.EditMessage(chatID, messageID, fmt.Sprintf("Error: %s", err), appActionKeyboard(app))
			return
		}
		output := res.Stdout
		if output == "" {
			output = "(no logs)"
		}
		if len(output) > 3500 {
			output = output[len(output)-3500:]
		}
		text := fmt.Sprintf("%s logs:\n%s", bot.Bold(app), bot.Pre(output))
		b.EditMessage(chatID, messageID, text, appActionKeyboard(app))

	case "start":
		b.EditMessage(chatID, messageID, fmt.Sprintf("Starting %s...", bot.Bold(app)), appActionKeyboard(app))
		res, err := exec.FleetMutate("start", app)
		if err != nil {
			msg := "Error starting " + app
			if res != nil && res.Stderr != "" {
				msg += "\n" + res.Stderr
			}
			b.EditMessage(chatID, messageID, msg, appActionKeyboard(app))
			return
		}
		b.EditMessage(chatID, messageID,
			fmt.Sprintf("%s %s started.", bot.StatusIcon("healthy"), bot.Bold(app)),
			appActionKeyboard(app))

	case "stop":
		// Show confirm step
		b.EditMessage(chatID, messageID,
			fmt.Sprintf("Stop %s? This will take the app offline.", bot.Bold(app)),
			confirmKeyboard("a:"+app+":stop!", "a:"+app))

	case "stop!":
		b.EditMessage(chatID, messageID, fmt.Sprintf("Stopping %s...", bot.Bold(app)), appActionKeyboard(app))
		res, err := exec.FleetMutate("stop", app)
		if err != nil {
			msg := "Error stopping " + app
			if res != nil && res.Stderr != "" {
				msg += "\n" + res.Stderr
			}
			b.EditMessage(chatID, messageID, msg, appActionKeyboard(app))
			return
		}
		_ = res
		b.EditMessage(chatID, messageID,
			fmt.Sprintf("%s %s stopped.", bot.StatusIcon("down"), bot.Bold(app)),
			appActionKeyboard(app))

	case "restart":
		b.EditMessage(chatID, messageID,
			fmt.Sprintf("Restart %s?", bot.Bold(app)),
			confirmKeyboard("a:"+app+":restart!", "a:"+app))

	case "restart!":
		b.EditMessage(chatID, messageID, fmt.Sprintf("Restarting %s...", bot.Bold(app)), appActionKeyboard(app))
		res, err := exec.FleetMutate("restart", app)
		if err != nil {
			msg := "Error restarting " + app
			if res != nil && res.Stderr != "" {
				msg += "\n" + res.Stderr
			}
			b.EditMessage(chatID, messageID, msg, appActionKeyboard(app))
			return
		}
		_ = res
		b.EditMessage(chatID, messageID,
			fmt.Sprintf("%s %s restarted.", bot.StatusIcon("healthy"), bot.Bold(app)),
			appActionKeyboard(app))

	case "deploy":
		b.EditMessage(chatID, messageID,
			fmt.Sprintf("Deploy %s? This will rebuild and restart.", bot.Bold(app)),
			confirmKeyboard("a:"+app+":deploy!", "a:"+app))

	case "deploy!":
		b.EditMessage(chatID, messageID, fmt.Sprintf("Deploying %s...", bot.Bold(app)), appActionKeyboard(app))
		res, err := exec.FleetMutate("deploy", app, "-y")
		if err != nil {
			msg := "Deploy failed for " + app
			if res != nil {
				msg += "\n" + res.Stderr
			}
			b.EditMessage(chatID, messageID, msg, appActionKeyboard(app))
			return
		}
		output := res.Stdout
		if len(output) > 3000 {
			output = output[len(output)-3000:]
		}
		b.EditMessage(chatID, messageID,
			fmt.Sprintf("%s %s deployed.\n%s", bot.StatusIcon("healthy"), bot.Bold(app), bot.Pre(output)),
			appActionKeyboard(app))
	}
}

func formatHealthDetail(d *HealthData) string {
	text := fmt.Sprintf("%s %s: %s\n\n", bot.StatusIcon(d.Overall), bot.Bold(d.App), d.Overall)
	text += fmt.Sprintf("  %s Systemd: %s\n", bot.StatusIcon(boolHealth(d.Systemd.OK)), d.Systemd.State)
	for _, c := range d.Containers {
		text += fmt.Sprintf("  %s %s (%s)\n", bot.StatusIcon(boolHealth(c.Running)), c.Name, c.Health)
	}
	if d.HTTP != nil {
		if d.HTTP.OK {
			text += fmt.Sprintf("  %s HTTP: %d\n", bot.StatusIcon("healthy"), *d.HTTP.Status)
		} else {
			detail := "failed"
			if d.HTTP.Error != nil {
				detail = *d.HTTP.Error
			}
			text += fmt.Sprintf("  %s HTTP: %s\n", bot.StatusIcon("down"), detail)
		}
	}
	return text
}

func boolHealth(ok bool) string {
	if ok {
		return "healthy"
	}
	return "down"
}

// --- Keyboard builders ---

func appGridKeyboard(apps []StatusData) *bot.InlineKeyboardMarkup {
	var rows [][]bot.InlineKeyboardButton
	var row []bot.InlineKeyboardButton
	for _, a := range apps {
		row = append(row, bot.InlineKeyboardButton{Text: a.Name, CallbackData: "a:" + a.Name})
		if len(row) == 3 {
			rows = append(rows, row)
			row = nil
		}
	}
	if len(row) > 0 {
		rows = append(rows, row)
	}
	return &bot.InlineKeyboardMarkup{InlineKeyboard: rows}
}

func appActionKeyboard(app string) *bot.InlineKeyboardMarkup {
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: "Health", CallbackData: "a:" + app + ":health"},
				{Text: "Logs", CallbackData: "a:" + app + ":logs"},
			},
			{
				{Text: "Start", CallbackData: "a:" + app + ":start"},
				{Text: "Stop", CallbackData: "a:" + app + ":stop"},
				{Text: "Restart", CallbackData: "a:" + app + ":restart"},
			},
			{
				{Text: "Deploy", CallbackData: "a:" + app + ":deploy"},
				{Text: "<< Back", CallbackData: "a:_back"},
			},
		},
	}
}

func confirmKeyboard(yesData, noData string) *bot.InlineKeyboardMarkup {
	return &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: "Yes, do it", CallbackData: yesData},
				{Text: "Cancel", CallbackData: noData},
			},
		},
	}
}
