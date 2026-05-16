package command

import "fleet-bot/adapter"

// Command is the interface that all bot commands must implement.
type Command interface {
	// Name returns the primary name used to invoke this command (e.g. "help").
	Name() string

	// Aliases returns alternative names that also trigger this command.
	// May return nil or an empty slice if there are no aliases.
	Aliases() []string

	// Help returns a short description shown in help listings.
	Help() string

	// Execute runs the command and returns a reply message.
	Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error)
}
