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

	// stream, if non-nil, is invoked after the message is sent. it gets a
	// closure that edits the just-sent message in place — useful for showing
	// progress during long-running actions. on adapters that don't support
	// edits (eg bluebubbles) the closure is a no-op.
	Stream func(update Updater)
}

// updater edits the message that's currently being streamed.
type Updater func(text string)

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

	// send delivers a message to the given chat ID. returns the provider's
	// message identifier (telegram message_id as decimal string, etc) so
	// callers can edit it later via the edit method. an empty messageID
	// with no error means the adapter doesn't track ids for this message.
	Send(chatID string, msg OutboundMessage) (messageID string, err error)

	// edit replaces the text of a previously-sent message. adapters that
	// don't support editing (bluebubbles, sms, etc) may return nil silently
	// and either no-op or send a follow-up message — implementation choice.
	Edit(chatID, messageID, text string) error

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
