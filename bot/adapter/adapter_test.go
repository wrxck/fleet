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

	// With an explicit sender allowlist, only those IDs are authorised.
	tg := NewTelegram("token", []int64{100}, []int64{42, 99}, nil)
	if !tg.IsAuthorizedSender("42") {
		t.Error("expected sender 42 to be authorised")
	}
	if !tg.IsAuthorizedSender("99") {
		t.Error("expected sender 99 to be authorised")
	}
	if tg.IsAuthorizedSender("7") {
		t.Error("expected sender 7 to be rejected (not in allowlist)")
	}
	if tg.IsAuthorizedSender("not-a-number") {
		t.Error("expected non-numeric sender ID to be rejected")
	}
	if tg.IsAuthorizedSender("") {
		t.Error("expected empty sender ID to be rejected")
	}

	// With no allowlist configured, fall back to chat-level allow
	// (single-user installs continue to work).
	tgOpen := NewTelegram("token", []int64{100}, nil, nil)
	if !tgOpen.IsAuthorizedSender("anything") {
		t.Error("expected open install (empty allowlist) to allow any sender")
	}
}
