package command

import (
	"fmt"
	"strings"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

const shellTimeout = 30 * time.Second

// ShellCmd implements /shell (alias: sh).
type ShellCmd struct{}

func (c *ShellCmd) Name() string      { return "shell" }
func (c *ShellCmd) Aliases() []string { return []string{"sh"} }
func (c *ShellCmd) Help() string      { return "Run a shell command on the host" }

func (c *ShellCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return adapter.TextResponse("Usage: /sh <command>\nRuns a shell command on the host."), nil
	}

	command := strings.Join(args, " ")
	res, err := exec.Run(shellTimeout, "bash", "-c", command)

	output := ""
	if res != nil {
		output = res.Stdout
		if res.Stderr != "" {
			if output != "" {
				output += "\n"
			}
			output += res.Stderr
		}
	}

	if output == "" {
		output = "(no output)"
	}
	if len(output) > 3800 {
		output = output[len(output)-3800:]
	}

	if err != nil {
		exitCode := -1
		if res != nil {
			exitCode = res.ExitCode
		}
		return adapter.TextResponse(fmt.Sprintf("Exit %d:\n%s", exitCode, output)), nil
	}

	return adapter.TextResponse(output), nil
}
