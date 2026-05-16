package command

import (
	"encoding/json"
	"fmt"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// GitCmd implements /git.
type GitCmd struct{}

func (c *GitCmd) Name() string      { return "git" }
func (c *GitCmd) Aliases() []string { return nil }
func (c *GitCmd) Help() string      { return "Show fleet git status or run git operations" }

func (c *GitCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return gitStatus("")
	}

	subcommand := strings.ToLower(args[0])
	rest := args[1:]

	switch subcommand {
	case "status":
		app := ""
		if len(rest) > 0 {
			app = rest[0]
		}
		return gitStatus(app)
	case "pull":
		app := ""
		if len(rest) > 0 {
			app = rest[0]
		}
		return gitPull(app)
	case "branch":
		app := ""
		if len(rest) > 0 {
			app = rest[0]
		}
		return gitBranch(app)
	case "log":
		app := ""
		if len(rest) > 0 {
			app = rest[0]
		}
		return gitLog(app)
	default:
		// Treat as app name for status
		return gitStatus(subcommand)
	}
}

func gitStatus(app string) (adapter.OutboundMessage, error) {
	cmdArgs := []string{"git", "status"}
	if app != "" {
		cmdArgs = append(cmdArgs, app)
	}
	cmdArgs = append(cmdArgs, "--json")

	res, err := exec.FleetRead(cmdArgs...)
	if err != nil {
		msg := "Error fetching git status"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}

	var data interface{}
	if err := json.Unmarshal([]byte(res.Stdout), &data); err != nil {
		output := res.Stdout
		if len(output) > 3800 {
			output = output[:3800] + "..."
		}
		return adapter.TextResponse(fmt.Sprintf("Git Status\n%s", output)), nil
	}

	formatted, _ := json.MarshalIndent(data, "", "  ")
	output := string(formatted)
	if len(output) > 3800 {
		output = output[:3800] + "..."
	}
	return adapter.TextResponse(fmt.Sprintf("Git Status\n%s", output)), nil
}

func gitPull(app string) (adapter.OutboundMessage, error) {
	cmdArgs := []string{"git", "pull"}
	if app != "" {
		cmdArgs = append(cmdArgs, app)
	}
	res, err := exec.FleetMutate(cmdArgs...)
	if err != nil {
		msg := "Error running git pull"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}
	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = "Pull complete."
	}
	if len(output) > 3800 {
		output = output[len(output)-3800:]
	}
	return adapter.TextResponse(output), nil
}

func gitBranch(app string) (adapter.OutboundMessage, error) {
	cmdArgs := []string{"git", "branch"}
	if app != "" {
		cmdArgs = append(cmdArgs, app)
	}
	cmdArgs = append(cmdArgs, "--json")
	res, err := exec.FleetRead(cmdArgs...)
	if err != nil {
		msg := "Error fetching git branch"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}
	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = "(no output)"
	}
	if len(output) > 3800 {
		output = output[:3800] + "..."
	}
	return adapter.TextResponse(fmt.Sprintf("Git Branch\n%s", output)), nil
}

func gitLog(app string) (adapter.OutboundMessage, error) {
	cmdArgs := []string{"git", "log"}
	if app != "" {
		cmdArgs = append(cmdArgs, app)
	}
	cmdArgs = append(cmdArgs, "--json")
	res, err := exec.FleetRead(cmdArgs...)
	if err != nil {
		msg := "Error fetching git log"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}
	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = "(no output)"
	}
	if len(output) > 3800 {
		output = output[len(output)-3800:]
	}
	return adapter.TextResponse(fmt.Sprintf("Git Log\n%s", output)), nil
}
