package command

import (
	"fmt"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// appSelectionPrompt fetches all app names and returns an OptionsResponse
// prompting the user to select one for the given action.
func appSelectionPrompt(action string) (adapter.OutboundMessage, error) {
	resp, err := exec.FleetJSON[statusResponse]("status")
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error fetching apps: %s", err)), nil
	}

	names := make([]string, 0, len(resp.Apps))
	for _, a := range resp.Apps {
		names = append(names, a.Name)
	}

	return adapter.OptionsResponse(fmt.Sprintf("Select an app to %s:", action), names), nil
}

// RestartCmd implements /restart.
type RestartCmd struct{}

func (c *RestartCmd) Name() string      { return "restart" }
func (c *RestartCmd) Aliases() []string { return nil }
func (c *RestartCmd) Help() string      { return "Restart an app" }

func (c *RestartCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("restart")
	}

	app := args[0]
	res, err := exec.FleetMutate("restart", app)
	if err != nil {
		detail := ""
		if res != nil && res.Stderr != "" {
			detail = "\n" + res.Stderr
		}
		return adapter.TextResponse(fmt.Sprintf("Error restarting %s%s", app, detail)), nil
	}

	output := res.Stdout
	if output == "" {
		output = "Restarted successfully."
	}
	return adapter.TextResponse(fmt.Sprintf("%s restarted.\n%s", app, output)), nil
}

// StartCmd implements /start.
type StartCmd struct{}

func (c *StartCmd) Name() string      { return "start" }
func (c *StartCmd) Aliases() []string { return nil }
func (c *StartCmd) Help() string      { return "Start an app" }

func (c *StartCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("start")
	}

	app := args[0]
	res, err := exec.FleetMutate("start", app)
	if err != nil {
		detail := ""
		if res != nil && res.Stderr != "" {
			detail = "\n" + res.Stderr
		}
		return adapter.TextResponse(fmt.Sprintf("Error starting %s%s", app, detail)), nil
	}

	output := res.Stdout
	if output == "" {
		output = "Started successfully."
	}
	return adapter.TextResponse(fmt.Sprintf("%s started.\n%s", app, output)), nil
}

// StopCmd implements /stop.
type StopCmd struct{}

func (c *StopCmd) Name() string      { return "stop" }
func (c *StopCmd) Aliases() []string { return nil }
func (c *StopCmd) Help() string      { return "Stop an app" }

func (c *StopCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("stop")
	}

	app := args[0]
	res, err := exec.FleetMutate("stop", app)
	if err != nil {
		detail := ""
		if res != nil && res.Stderr != "" {
			detail = "\n" + res.Stderr
		}
		return adapter.TextResponse(fmt.Sprintf("Error stopping %s%s", app, detail)), nil
	}

	output := res.Stdout
	if output == "" {
		output = "Stopped successfully."
	}
	return adapter.TextResponse(fmt.Sprintf("%s stopped.\n%s", app, output)), nil
}
