package command

import (
	"fmt"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// statusResponse matches fleet status --json output.
type statusResponse struct {
	Apps []statusApp `json:"apps"`
}

type statusApp struct {
	Name    string `json:"name"`
	Service string `json:"service"`
	State   string `json:"state"`
	Health  string `json:"health"`
}

func statusIcon(health string) string {
	switch health {
	case "healthy":
		return "[OK]"
	case "degraded":
		return "[!!]"
	case "down":
		return "[XX]"
	case "frozen":
		return "[FR]"
	default:
		return "[??]"
	}
}

// StatusCmd implements /status.
type StatusCmd struct{}

func (c *StatusCmd) Name() string        { return "status" }
func (c *StatusCmd) Aliases() []string   { return []string{"s"} }
func (c *StatusCmd) Help() string        { return "Show fleet app status overview" }

func (c *StatusCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	resp, err := exec.FleetJSON[statusResponse]("status")
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error: %s", err)), nil
	}

	var sb strings.Builder
	sb.WriteString("Fleet Status\n\n")

	healthy, degraded, down := 0, 0, 0
	for _, a := range resp.Apps {
		icon := statusIcon(a.Health)
		sb.WriteString(fmt.Sprintf("%s %s  %s\n", icon, a.Name, a.Health))
		switch a.Health {
		case "healthy":
			healthy++
		case "degraded":
			degraded++
		case "down":
			down++
		}
	}

	sb.WriteString(fmt.Sprintf("\n%d healthy", healthy))
	if degraded > 0 {
		sb.WriteString(fmt.Sprintf(", %d degraded", degraded))
	}
	if down > 0 {
		sb.WriteString(fmt.Sprintf(", %d down", down))
	}

	return adapter.TextResponse(sb.String()), nil
}
