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
