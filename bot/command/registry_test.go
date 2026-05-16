package command

import (
	"strings"
	"testing"

	"fleet-bot/adapter"
)

// stubCmd is a minimal Command implementation for testing.
type stubCmd struct {
	name    string
	aliases []string
	help    string
}

func (s *stubCmd) Name() string    { return s.name }
func (s *stubCmd) Aliases() []string { return s.aliases }
func (s *stubCmd) Help() string    { return s.help }
func (s *stubCmd) Execute(_ adapter.InboundMessage, _ []string) (adapter.OutboundMessage, error) {
	return adapter.OutboundMessage{Text: "ok"}, nil
}

func newStub(name string, aliases []string, help string) Command {
	return &stubCmd{name: name, aliases: aliases, help: help}
}

func TestLookupByName(t *testing.T) {
	r := NewRegistry()
	r.Register(newStub("status", nil, "show status"))

	cmd := r.Lookup("status")
	if cmd == nil {
		t.Fatal("expected command, got nil")
	}
	if cmd.Name() != "status" {
		t.Errorf("expected name %q, got %q", "status", cmd.Name())
	}
}

func TestLookupByAlias(t *testing.T) {
	r := NewRegistry()
	r.Register(newStub("deploy", []string{"d", "dep"}, "deploy an app"))

	if r.Lookup("d") == nil {
		t.Error("expected to find command via alias 'd'")
	}
	if r.Lookup("dep") == nil {
		t.Error("expected to find command via alias 'dep'")
	}
}

func TestLookupCaseInsensitive(t *testing.T) {
	r := NewRegistry()
	r.Register(newStub("help", []string{"h"}, "show help"))

	cases := []string{"help", "HELP", "Help", "H", "h"}
	for _, name := range cases {
		if r.Lookup(name) == nil {
			t.Errorf("Lookup(%q) returned nil, want command", name)
		}
	}
}

func TestLookupUnknownReturnsNil(t *testing.T) {
	r := NewRegistry()
	r.Register(newStub("ping", nil, "ping"))

	if cmd := r.Lookup("pong"); cmd != nil {
		t.Errorf("expected nil for unknown command, got %v", cmd)
	}
}

func TestHelpTextContainsAliases(t *testing.T) {
	r := NewRegistry()
	r.Register(newStub("restart", []string{"r", "reboot"}, "restart an app"))

	text := r.HelpText()
	if !strings.Contains(text, "/restart") {
		t.Error("HelpText should contain /restart")
	}
	if !strings.Contains(text, "/r") {
		t.Error("HelpText should contain alias /r")
	}
	if !strings.Contains(text, "/reboot") {
		t.Error("HelpText should contain alias /reboot")
	}
	if !strings.Contains(text, "restart an app") {
		t.Error("HelpText should contain help string")
	}
}

func TestHelpTextOrderMatchesRegistration(t *testing.T) {
	r := NewRegistry()
	r.Register(newStub("alpha", nil, "a"))
	r.Register(newStub("beta", nil, "b"))
	r.Register(newStub("gamma", nil, "c"))

	text := r.HelpText()
	posA := strings.Index(text, "/alpha")
	posB := strings.Index(text, "/beta")
	posG := strings.Index(text, "/gamma")

	if posA < 0 || posB < 0 || posG < 0 {
		t.Fatal("not all commands appear in HelpText")
	}
	if !(posA < posB && posB < posG) {
		t.Error("HelpText commands are not in registration order")
	}
}

func TestDuplicateNamePanics(t *testing.T) {
	r := NewRegistry()
	r.Register(newStub("status", nil, "show status"))

	defer func() {
		if rec := recover(); rec == nil {
			t.Error("expected panic on duplicate name, got none")
		}
	}()
	r.Register(newStub("status", nil, "duplicate"))
}

func TestDuplicateAliasPanics(t *testing.T) {
	r := NewRegistry()
	r.Register(newStub("deploy", []string{"d"}, "deploy"))

	defer func() {
		if rec := recover(); rec == nil {
			t.Error("expected panic on duplicate alias, got none")
		}
	}()
	r.Register(newStub("destroy", []string{"d"}, "destroy"))
}

func TestAliasConflictsWithExistingNamePanics(t *testing.T) {
	r := NewRegistry()
	r.Register(newStub("stop", nil, "stop"))

	defer func() {
		if rec := recover(); rec == nil {
			t.Error("expected panic when alias conflicts with existing name, got none")
		}
	}()
	// "stop" is already a primary name — using it as alias should panic
	r.Register(newStub("halt", []string{"stop"}, "halt"))
}

func TestForEach(t *testing.T) {
	r := NewRegistry()
	r.Register(newStub("one", nil, "1"))
	r.Register(newStub("two", nil, "2"))
	r.Register(newStub("three", nil, "3"))

	var names []string
	r.ForEach(func(cmd Command) {
		names = append(names, cmd.Name())
	})

	expected := []string{"one", "two", "three"}
	if len(names) != len(expected) {
		t.Fatalf("expected %d commands, got %d", len(expected), len(names))
	}
	for i, want := range expected {
		if names[i] != want {
			t.Errorf("ForEach[%d]: expected %q, got %q", i, want, names[i])
		}
	}
}
