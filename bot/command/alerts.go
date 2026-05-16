package command

import (
	"fmt"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// AlertsCmd implements /alerts.
// Full AlertMonitor integration happens in Task 11.
// For now, shows watchdog status via fleet CLI.
type AlertsCmd struct{}

func (c *AlertsCmd) Name() string      { return "alerts" }
func (c *AlertsCmd) Aliases() []string { return nil }
func (c *AlertsCmd) Help() string      { return "Show or toggle health alert monitoring status" }

func (c *AlertsCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return alertsStatus()
	}

	switch strings.ToLower(args[0]) {
	case "on":
		res, err := exec.FleetMutate("watchdog", "enable")
		if err != nil {
			detail := ""
			if res != nil && res.Stderr != "" {
				detail = "\n" + res.Stderr
			}
			return adapter.TextResponse(fmt.Sprintf("Error enabling watchdog: %s%s", err, detail)), nil
		}
		return adapter.TextResponse("Health alerts enabled."), nil

	case "off":
		res, err := exec.FleetMutate("watchdog", "disable")
		if err != nil {
			detail := ""
			if res != nil && res.Stderr != "" {
				detail = "\n" + res.Stderr
			}
			return adapter.TextResponse(fmt.Sprintf("Error disabling watchdog: %s%s", err, detail)), nil
		}
		return adapter.TextResponse("Health alerts disabled."), nil

	default:
		return adapter.TextResponse("Usage: /alerts [on|off]\nShows or toggles health alert monitoring."), nil
	}
}

func alertsStatus() (adapter.OutboundMessage, error) {
	var sb strings.Builder
	sb.WriteString("Health Alerts\n\n")

	res, err := exec.FleetRead("watchdog", "status", "--json")
	if err != nil || res == nil || res.Stdout == "" {
		sb.WriteString("Status: unknown (watchdog not available)\n\n")
	} else {
		output := strings.TrimSpace(res.Stdout)
		if len(output) > 500 {
			output = output[:500] + "..."
		}
		sb.WriteString(output + "\n\n")
	}

	sb.WriteString("Usage:\n")
	sb.WriteString("  /alerts on  — enable monitoring\n")
	sb.WriteString("  /alerts off — disable monitoring")

	return adapter.OptionsResponse(sb.String(), []string{"on", "off"}), nil
}
