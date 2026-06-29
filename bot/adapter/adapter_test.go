package adapter

import (
	"testing"
)

func TestTextResponse(t *testing.T) {
	msg := TextResponse("hello world")

	if msg.Text != "hello world" {
		t.Errorf("expected Text %q, got %q", "hello world", msg.Text)
	}
	if len(msg.Options) != 0 {
		t.Errorf("expected no Options, got %v", msg.Options)
	}
	if msg.Photo != nil {
		t.Error("expected nil Photo")
	}
	if msg.Document != nil {
		t.Error("expected nil Document")
	}
	if msg.Caption != "" {
		t.Errorf("expected empty Caption, got %q", msg.Caption)
	}
}

func TestOptionsResponse(t *testing.T) {
	opts := []string{"yes", "no", "maybe"}
	msg := OptionsResponse("choose one", opts)

	if msg.Text != "choose one" {
		t.Errorf("expected Text %q, got %q", "choose one", msg.Text)
	}
	if len(msg.Options) != 3 {
		t.Errorf("expected 3 options, got %d", len(msg.Options))
	}
	for i, want := range opts {
		if msg.Options[i] != want {
			t.Errorf("Options[%d]: expected %q, got %q", i, want, msg.Options[i])
		}
	}
}

func TestOptionsResponseEmptyOptions(t *testing.T) {
	msg := OptionsResponse("no options here", nil)

	if msg.Text != "no options here" {
		t.Errorf("expected Text %q, got %q", "no options here", msg.Text)
	}
	if msg.Options != nil {
		t.Errorf("expected nil Options, got %v", msg.Options)
	}
}

// TestTelegramIsAuthorizedSender locks in the per-sender authorisation gate
// added so the Telegram adapter implements SenderAuthorizer the same way the
// BlueBubbles adapter does. Without this, the router falls back to chat-level
// auth only — which means anyone in an allowed group chat can drive the bot.
func TestTelegramIsAuthorizedSender(t *testing.T) {
	// Compile-time assertion: TelegramAdapter implements SenderAuthorizer.
	var _ SenderAuthorizer = (*TelegramAdapter)(nil)

	// with an explicit sender allowlist, only those ids are authorised
	// (chat id is irrelevant once a sender allowlist is present).
	tg := NewTelegram("token", []int64{100}, []int64{42, 99}, nil)
	if !tg.IsAuthorizedSender("42", "100") {
		t.Error("expected sender 42 to be authorised")
	}
	if !tg.IsAuthorizedSender("99", "100") {
		t.Error("expected sender 99 to be authorised")
	}
	if tg.IsAuthorizedSender("7", "100") {
		t.Error("expected sender 7 to be rejected (not in allowlist)")
	}
	if tg.IsAuthorizedSender("not-a-number", "100") {
		t.Error("expected non-numeric sender ID to be rejected")
	}
	if tg.IsAuthorizedSender("", "100") {
		t.Error("expected empty sender ID to be rejected")
	}

	// With no allowlist configured we default-deny: only a private chat
	// (chat id == sender id) is accepted. group chats (negative ids that never
	// equal a sender id) and any sender!=chat are rejected.
	tgOpen := NewTelegram("token", []int64{42}, nil, nil)
	if !tgOpen.IsAuthorizedSender("42", "42") {
		t.Error("expected private chat (sender==chat) to be authorised with no allowlist")
	}
	if tgOpen.IsAuthorizedSender("500", "-1001234567890") {
		t.Error("expected group-chat member to be rejected with no sender allowlist")
	}
	if tgOpen.IsAuthorizedSender("42", "-1001234567890") {
		t.Error("expected sender!=chat to be rejected with no sender allowlist")
	}
	if tgOpen.IsAuthorizedSender("", "") {
		t.Error("expected empty sender id to be rejected even when it equals chat id")
	}
}

// TestValidateTelegramAuth locks in the startup guard that refuses an
// allowlisted group/channel chat with no per-sender allowlist.
func TestValidateTelegramAuth(t *testing.T) {
	// private-chat-only install (positive chat id, no sender list) is fine.
	if err := ValidateTelegramAuth([]int64{42}, nil); err != nil {
		t.Errorf("expected private-chat install to validate, got %v", err)
	}
	// a group chat (negative id) with no sender allowlist must be refused.
	if err := ValidateTelegramAuth([]int64{-1001234567890}, nil); err == nil {
		t.Error("expected group chat without sender allowlist to be rejected")
	}
	// a group chat is allowed once an explicit sender allowlist is present.
	if err := ValidateTelegramAuth([]int64{-1001234567890}, []int64{42}); err != nil {
		t.Errorf("expected group chat with sender allowlist to validate, got %v", err)
	}
}
