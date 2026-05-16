package adapter

import (
	"context"
	"fmt"
	"strconv"

	"fleet-bot/bot"
)

// TelegramAdapter wraps *bot.Bot and implements the Adapter interface.
type TelegramAdapter struct {
	b                *bot.Bot
	allowedChatIDs   []int64
	allowedSenderIDs []int64
	alertChatIDs     []int64
}

// NewTelegram creates a TelegramAdapter. The bot.Bot is initialised with the
// first allowedChatID as the primary chat (required by bot.New), falling back
// to 0 when the slice is empty.
//
// allowedSenderIDs gates per-user dispatch via the router's SenderAuthorizer
// path. When empty, sender-level auth is a no-op and the chat-level allowlist
// is the only gate (preserves single-user installs).
func NewTelegram(botToken string, allowedChatIDs, allowedSenderIDs, alertChatIDs []int64) *TelegramAdapter {
	var primaryChatID int64
	if len(allowedChatIDs) > 0 {
		primaryChatID = allowedChatIDs[0]
	}
	return &TelegramAdapter{
		b:                bot.New(botToken, primaryChatID),
		allowedChatIDs:   allowedChatIDs,
		allowedSenderIDs: allowedSenderIDs,
		alertChatIDs:     alertChatIDs,
	}
}

// IsAuthorizedSender reports whether senderID is in the allowed list.
// Telegram senders are user IDs; we authorise by chat ID (transport-level)
// AND by sender ID for parity with the BlueBubbles adapter.
//
// If no per-sender list is configured, fall back to chat-level allow
// (preserves existing behaviour for single-user installs).
func (a *TelegramAdapter) IsAuthorizedSender(senderID string) bool {
	if len(a.allowedSenderIDs) == 0 {
		return true
	}
	n, err := strconv.ParseInt(senderID, 10, 64)
	if err != nil {
		return false
	}
	for _, id := range a.allowedSenderIDs {
		if id == n {
			return true
		}
	}
	return false
}

// Name returns the adapter identifier.
func (a *TelegramAdapter) Name() string {
	return "telegram"
}

// Start launches a goroutine that polls Telegram and pushes authorised updates
// to inbox as InboundMessages.
func (a *TelegramAdapter) Start(ctx context.Context, inbox chan<- InboundMessage) error {
	h := &telegramInboxHandler{
		allowedChatIDs: a.allowedChatIDs,
		inbox:          inbox,
	}
	go a.b.Poll(ctx, h)
	return nil
}

// send delivers msg to the given chatID. if options are present they are sent
// as an inline keyboard. returns the telegram message_id (decimal string) so
// the caller can edit it later.
func (a *TelegramAdapter) Send(chatID string, msg OutboundMessage) (string, error) {
	id, err := strconv.ParseInt(chatID, 10, 64)
	if err != nil {
		return "", fmt.Errorf("telegram Send: invalid chatID %q: %w", chatID, err)
	}

	var sent *bot.Message
	if len(msg.Options) > 0 {
		buttons := make([]bot.InlineKeyboardButton, len(msg.Options))
		for i, opt := range msg.Options {
			buttons[i] = bot.InlineKeyboardButton{
				Text:         opt,
				CallbackData: opt,
			}
		}
		markup := &bot.InlineKeyboardMarkup{
			InlineKeyboard: [][]bot.InlineKeyboardButton{buttons},
		}
		sent, err = a.b.SendMessageWithReply(id, msg.Text, markup)
	} else {
		sent, err = a.b.SendMessage(id, msg.Text)
	}
	if err != nil || sent == nil {
		return "", err
	}
	return strconv.FormatInt(sent.MessageID, 10), nil
}

// edit replaces the body of a previously-sent telegram message.
func (a *TelegramAdapter) Edit(chatID, messageID, text string) error {
	cid, err := strconv.ParseInt(chatID, 10, 64)
	if err != nil {
		return fmt.Errorf("telegram Edit: invalid chatID %q: %w", chatID, err)
	}
	mid, err := strconv.ParseInt(messageID, 10, 64)
	if err != nil {
		return fmt.Errorf("telegram Edit: invalid messageID %q: %w", messageID, err)
	}
	return a.b.EditMessage(cid, mid, text, nil)
}

// SendAlert delivers text to all configured alertChatIDs.
func (a *TelegramAdapter) SendAlert(text string) error {
	var firstErr error
	for _, id := range a.alertChatIDs {
		if _, err := a.b.SendMessage(id, text); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// Stop is a no-op; polling stops via context cancellation in Start.
func (a *TelegramAdapter) Stop() error {
	return nil
}

// Bot returns the underlying *bot.Bot for Telegram-specific operations.
func (a *TelegramAdapter) Bot() *bot.Bot {
	return a.b
}

// isAllowed reports whether chatID is in the allowed list.
func isAllowed(chatID int64, allowedChatIDs []int64) bool {
	for _, id := range allowedChatIDs {
		if id == chatID {
			return true
		}
	}
	return false
}

// telegramInboxHandler implements bot.Handler and converts Updates to
// InboundMessages.
type telegramInboxHandler struct {
	allowedChatIDs []int64
	inbox          chan<- InboundMessage
}

// handle checks authorisation, converts the update to an inbound message, and
// pushes it to the inbox channel. callback_query updates (inline keyboard
// button clicks) are converted into inbound messages whose text is the
// button's callback data, so the router's pending-selection handler can pick
// them up the same way as numeric replies.
func (h *telegramInboxHandler) Handle(ctx context.Context, b *bot.Bot, u bot.Update) {
	if u.CallbackQuery != nil {
		h.handleCallback(ctx, b, u.CallbackQuery)
		return
	}
	if u.Message == nil {
		return
	}
	msg := u.Message
	chatID := msg.Chat.ID

	if !isAllowed(chatID, h.allowedChatIDs) {
		return
	}

	var senderID string
	if msg.From != nil {
		senderID = strconv.FormatInt(msg.From.ID, 10)
	}

	inbound := InboundMessage{
		ChatID:   strconv.FormatInt(chatID, 10),
		SenderID: senderID,
		Text:     msg.Text,
		HasPhoto: len(msg.Photo) > 0,
		Provider: "telegram",
	}

	select {
	case h.inbox <- inbound:
	case <-ctx.Done():
	}
}

// handleCallback converts an inline-keyboard button click into an inbound
// message. always answers the callback so the spinner stops on the client.
func (h *telegramInboxHandler) handleCallback(ctx context.Context, b *bot.Bot, cb *bot.CallbackQuery) {
	defer b.AnswerCallback(cb.ID)
	if cb.Message == nil {
		return
	}
	chatID := cb.Message.Chat.ID
	if !isAllowed(chatID, h.allowedChatIDs) {
		return
	}

	inbound := InboundMessage{
		ChatID:   strconv.FormatInt(chatID, 10),
		SenderID: strconv.FormatInt(cb.From.ID, 10),
		Text:     cb.Data,
		Provider: "telegram",
	}

	select {
	case h.inbox <- inbound:
	case <-ctx.Done():
	}
}
