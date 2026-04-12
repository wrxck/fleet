package command

import (
	"fmt"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// CleanupCmd implements /cleanup.
type CleanupCmd struct{}

func (c *CleanupCmd) Name() string      { return "cleanup" }
func (c *CleanupCmd) Aliases() []string { return nil }
func (c *CleanupCmd) Help() string      { return "Show Docker disk usage and prune unused resources" }

func (c *CleanupCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	// Show disk usage first
	dfRes, err := exec.Run(15*time.Second, "docker", "system", "df")
	if err != nil {
		return adapter.TextResponse("Error running docker system df"), nil
	}

	dfOutput := dfRes.Stdout
	if dfOutput == "" {
		dfOutput = "(no output)"
	}

	// If no confirmation arg provided, show usage and prompt
	if len(args) == 0 || args[0] != "--confirm" {
		text := fmt.Sprintf("Docker Disk Usage:\n%s\n\nRun /cleanup --confirm to prune unused images, containers, networks, and build cache.", dfOutput)
		return adapter.OptionsResponse(text, []string{"--confirm"}), nil
	}

	// Prune
	pruneRes, err := exec.Run(2*time.Minute, "docker", "system", "prune", "-f")
	if err != nil {
		detail := ""
		if pruneRes != nil && pruneRes.Stderr != "" {
			detail = pruneRes.Stderr
		}
		return adapter.TextResponse(fmt.Sprintf("Prune failed: %s", detail)), nil
	}

	output := pruneRes.Stdout
	if len(output) > 3800 {
		output = output[len(output)-3800:]
	}
	if output == "" {
		output = "(no output)"
	}
	return adapter.TextResponse(fmt.Sprintf("Pruned.\n%s", output)), nil
}
