package command

import (
	"fleet-bot/adapter"
)

// HelpCmd implements /help. The Registry must be injected via SetRegistry
// after construction so that HelpText() can enumerate all registered commands.
type HelpCmd struct {
	registry *Registry
}

// SetRegistry injects the registry after the command is constructed.
func (c *HelpCmd) SetRegistry(r *Registry) {
	c.registry = r
}

func (c *HelpCmd) Name() string      { return "help" }
func (c *HelpCmd) Aliases() []string { return nil }
func (c *HelpCmd) Help() string      { return "List all available commands" }

func (c *HelpCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if c.registry == nil {
		return adapter.TextResponse("Help unavailable (registry not set)."), nil
	}
	return adapter.TextResponse(c.registry.HelpText()), nil
}
