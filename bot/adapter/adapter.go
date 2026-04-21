package adapter

import "context"

// InboundMessage represents a message received from any messaging provider.
type InboundMessage struct {
	ChatID    string
	SenderID  string
	Text      string
	HasPhoto  bool
	PhotoData []byte
	Provider  string
}

// OutboundMessage represents a message to be sent via any messaging provider.
type OutboundMessage struct {
	Text     string
	Photo    []byte
	Document []byte
	Caption  string
	Options  []string
}

// TextResponse constructs an OutboundMessage containing only text.
func TextResponse(text string) OutboundMessage {
	return OutboundMessage{Text: text}
}

// OptionsResponse constructs an OutboundMessage with text and a list of reply options.
func OptionsResponse(text string, options []string) OutboundMessage {
	return OutboundMessage{Text: text, Options: options}
}

// Adapter is the interface that all messaging provider adapters must implement.
type Adapter interface {
	// Name returns the identifier for this adapter (e.g. "telegram", "imessage").
	Name() string

	// Start begins receiving messages, sending inbound messages to the inbox channel.
	Start(ctx context.Context, inbox chan<- InboundMessage) error

	// Send delivers a message to the given chat ID.
	Send(chatID string, msg OutboundMessage) error

	// SendAlert delivers an alert message to the configured alert destination.
	SendAlert(text string) error

	// Stop gracefully shuts down the adapter.
	Stop() error
}

// SenderAuthorizer is an optional interface adapters may implement to let the
// router enforce per-sender authorization before dispatching a command.
// Adapters that do not implement this interface are assumed to have already
// authenticated the sender at the transport layer.
type SenderAuthorizer interface {
	// IsAuthorizedSender reports whether the given senderID (as populated in
	// InboundMessage.SenderID) is permitted to invoke bot commands.
	IsAuthorizedSender(senderID string) bool
}
