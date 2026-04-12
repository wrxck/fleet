package command

import (
	"fmt"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

const maxLogsLen = 3800

// LogsCmd implements /logs.
type LogsCmd struct{}

func (c *LogsCmd) Name() string      { return "logs" }
func (c *LogsCmd) Aliases() []string { return nil }
func (c *LogsCmd) Help() string      { return "View recent logs for an app" }

func (c *LogsCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("view logs for")
	}

	app := args[0]
	res, err := exec.FleetMutate("logs", app, "--tail", "50")
	if err != nil {
		detail := ""
		if res != nil && res.Stderr != "" {
			detail = "\n" + res.Stderr
		}
		return adapter.TextResponse(fmt.Sprintf("Error fetching logs for %s%s", app, detail)), nil
	}

	output := res.Stdout
	if output == "" {
		output = "(no logs)"
	}
	if len(output) > maxLogsLen {
		output = output[len(output)-maxLogsLen:]
	}

	return adapter.TextResponse(fmt.Sprintf("%s logs (last 50 lines):\n%s", app, output)), nil
}
