package command

import (
	"fmt"
	"os/exec"
	"strings"

	"fleet-bot/adapter"
)

// fleet-guard cli binary on the host. mounted into the container at the same
// path via the bot's existing host-passthrough volume mounts.
const guardBin = "/usr/local/sbin/fleet-guard"

// runs `fleet-guard <verb> [args...]` and returns combined output.
func runGuard(verb string, args ...string) (string, error) {
	all := append([]string{verb}, args...)
	out, err := exec.Command(guardBin, all...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// ApproveCmd implements /approve.
type ApproveCmd struct{}

func (c *ApproveCmd) Name() string      { return "approve" }
func (c *ApproveCmd) Aliases() []string { return nil }
func (c *ApproveCmd) Help() string {
	return "Approve a fleet-guard pending action. Usage: /approve TOKEN"
}

func (c *ApproveCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) != 1 {
		return adapter.TextResponse("usage: /approve TOKEN"), nil
	}
	actor := fmt.Sprintf("%s:%s", msg.Provider, msg.SenderID)
	out, err := runGuard("approve", args[0], "--actor", actor)
	if err != nil && out == "" {
		return adapter.TextResponse(fmt.Sprintf("approve failed: %v", err)), nil
	}
	if out == "" {
		out = "approved"
	}
	return adapter.TextResponse(out), nil
}

// RejectCmd implements /reject.
type RejectCmd struct{}

func (c *RejectCmd) Name() string      { return "reject" }
func (c *RejectCmd) Aliases() []string { return nil }
func (c *RejectCmd) Help() string {
	return "Reject a fleet-guard pending action. Usage: /reject TOKEN"
}

func (c *RejectCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) != 1 {
		return adapter.TextResponse("usage: /reject TOKEN"), nil
	}
	actor := fmt.Sprintf("%s:%s", msg.Provider, msg.SenderID)
	out, err := runGuard("reject", args[0], "--actor", actor)
	if err != nil && out == "" {
		return adapter.TextResponse(fmt.Sprintf("reject failed: %v", err)), nil
	}
	if out == "" {
		out = "rejected"
	}
	return adapter.TextResponse(out), nil
}

// GuardCmd implements /guard — shows status / lists pending holds.
type GuardCmd struct{}

func (c *GuardCmd) Name() string      { return "guard" }
func (c *GuardCmd) Aliases() []string { return nil }
func (c *GuardCmd) Help() string {
	return "Show fleet-guard status (pending holds, approval queue)"
}

func (c *GuardCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	out, err := runGuard("status")
	if err != nil && out == "" {
		return adapter.TextResponse(fmt.Sprintf("guard status failed: %v", err)), nil
	}
	return adapter.TextResponse(out), nil
}
