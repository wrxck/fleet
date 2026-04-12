package command

import (
	"fmt"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// FreezeCmd implements /freeze.
type FreezeCmd struct{}

func (c *FreezeCmd) Name() string      { return "freeze" }
func (c *FreezeCmd) Aliases() []string { return nil }
func (c *FreezeCmd) Help() string      { return "Freeze an app to prevent automatic restarts" }

func (c *FreezeCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("freeze")
	}

	app := args[0]
	cmdArgs := []string{"freeze", app}
	if len(args) > 1 {
		cmdArgs = append(cmdArgs, args[1:]...)
	}

	res, err := exec.FleetMutate(cmdArgs...)
	if err != nil {
		detail := ""
		if res != nil && res.Stderr != "" {
			detail = "\n" + res.Stderr
		}
		return adapter.TextResponse(fmt.Sprintf("Error freezing %s%s", app, detail)), nil
	}

	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = fmt.Sprintf("%s frozen.", app)
	}
	return adapter.TextResponse(output), nil
}

// UnfreezeCmd implements /unfreeze.
type UnfreezeCmd struct{}

func (c *UnfreezeCmd) Name() string      { return "unfreeze" }
func (c *UnfreezeCmd) Aliases() []string { return nil }
func (c *UnfreezeCmd) Help() string      { return "Unfreeze an app to allow automatic restarts" }

func (c *UnfreezeCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("unfreeze")
	}

	app := args[0]
	cmdArgs := []string{"unfreeze", app}
	if len(args) > 1 {
		cmdArgs = append(cmdArgs, args[1:]...)
	}

	res, err := exec.FleetMutate(cmdArgs...)
	if err != nil {
		detail := ""
		if res != nil && res.Stderr != "" {
			detail = "\n" + res.Stderr
		}
		return adapter.TextResponse(fmt.Sprintf("Error unfreezing %s%s", app, detail)), nil
	}

	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = fmt.Sprintf("%s unfrozen.", app)
	}
	return adapter.TextResponse(output), nil
}
