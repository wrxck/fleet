package command

import (
	"fmt"
	"strings"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// uptimeStatusResponse matches fleet status --json.
type uptimeStatusResponse struct {
	Apps []uptimeApp `json:"apps"`
}

type uptimeApp struct {
	Name   string `json:"name"`
	Health string `json:"health"`
}

// UptimeCmd implements /uptime.
type UptimeCmd struct{}

func (c *UptimeCmd) Name() string      { return "uptime" }
func (c *UptimeCmd) Aliases() []string { return nil }
func (c *UptimeCmd) Help() string      { return "Show system uptime and app health summary" }

func (c *UptimeCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	// System uptime from /proc/uptime
	sysUptime := readSysUptime()

	var sb strings.Builder
	sb.WriteString("Uptime\n\n")
	sb.WriteString(fmt.Sprintf("System: %s\n\n", sysUptime))

	// Fleet app health
	resp, err := exec.FleetJSON[uptimeStatusResponse]("status")
	if err != nil {
		sb.WriteString(fmt.Sprintf("Fleet status: error (%s)", err))
		return adapter.TextResponse(sb.String()), nil
	}

	if len(resp.Apps) == 0 {
		sb.WriteString("No apps registered.")
		return adapter.TextResponse(sb.String()), nil
	}

	sb.WriteString("Apps:\n")
	for _, app := range resp.Apps {
		icon := "[OK]"
		switch app.Health {
		case "down":
			icon = "[XX]"
		case "degraded":
			icon = "[!!]"
		case "frozen":
			icon = "[FR]"
		}
		sb.WriteString(fmt.Sprintf("  %s %s  %s\n", icon, app.Name, app.Health))
	}

	return adapter.TextResponse(sb.String()), nil
}

func readSysUptime() string {
	res, err := exec.Run(5*time.Second, "uptime", "-p")
	if err != nil || res == nil {
		return "unknown"
	}
	return strings.TrimSpace(res.Stdout)
}
