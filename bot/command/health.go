package command

import (
	"fmt"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// HealthCmd implements /health.
type HealthCmd struct{}

func (c *HealthCmd) Name() string      { return "health" }
func (c *HealthCmd) Aliases() []string { return []string{"h"} }
func (c *HealthCmd) Help() string      { return "Check health of apps" }

func (c *HealthCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	cmdArgs := []string{"health", "--json"}
	cmdArgs = append(cmdArgs, args...)

	res, err := exec.FleetMutate(cmdArgs...)
	if err != nil {
		detail := ""
		if res != nil && res.Stderr != "" {
			detail = "\n" + res.Stderr
		}
		return adapter.TextResponse(fmt.Sprintf("Error running health check%s", detail)), nil
	}

	output := res.Stdout
	if res.Stderr != "" {
		if output != "" {
			output += "\n"
		}
		output += res.Stderr
	}
	if output == "" {
		output = "(no output)"
	}

	var sb strings.Builder
	sb.WriteString("Health Check\n\n")
	sb.WriteString(output)

	return adapter.TextResponse(sb.String()), nil
}
