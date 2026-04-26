package router

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/command"
)

// --- Mock adapter ---

type mockAdapter struct {
	mu     sync.Mutex
	name   string
	sent   []adapter.OutboundMessage
	alerts []string
	inbox  chan<- adapter.InboundMessage
}

func newMockAdapter(name string) *mockAdapter {
	return &mockAdapter{name: name}
}

func (m *mockAdapter) Name() string { return m.name }

func (m *mockAdapter) Start(_ context.Context, inbox chan<- adapter.InboundMessage) error {
	m.mu.Lock()
	m.inbox = inbox
	m.mu.Unlock()
	return nil
}

func (m *mockAdapter) Send(_ string, msg adapter.OutboundMessage) error {
	m.mu.Lock()
	m.sent = append(m.sent, msg)
	m.mu.Unlock()
	return nil
}

func (m *mockAdapter) SendAlert(text string) error {
	m.mu.Lock()
	m.alerts = append(m.alerts, text)
	m.mu.Unlock()
	return nil
}

func (m *mockAdapter) Stop() error { return nil }

func (m *mockAdapter) send(msg adapter.InboundMessage) {
	m.mu.Lock()
	ch := m.inbox
	m.mu.Unlock()
	ch <- msg
}

func (m *mockAdapter) lastSent() *adapter.OutboundMessage {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sent) == 0 {
		return nil
	}
	v := m.sent[len(m.sent)-1]
	return &v
}

// --- Stub commands ---

type echoCmd struct{}

func (c *echoCmd) Name() string    { return "echo" }
func (c *echoCmd) Aliases() []string { return nil }
func (c *echoCmd) Help() string    { return "echo args back" }
func (c *echoCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return adapter.TextResponse("nothing to echo"), nil
	}
	return adapter.TextResponse(args[0]), nil
}

// optionsCmd returns Options on the first call, then echoes the chosen option.
type optionsCmd struct {
	mu      sync.Mutex
	firstCall bool
}

func newOptionsCmd() *optionsCmd { return &optionsCmd{firstCall: true} }

func (c *optionsCmd) Name() string      { return "pick" }
func (c *optionsCmd) Aliases() []string { return nil }
func (c *optionsCmd) Help() string      { return "pick an option" }
func (c *optionsCmd) Execute(_ adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.firstCall {
		c.firstCall = false
		return adapter.OptionsResponse("choose one", []string{"alpha", "beta", "gamma"}), nil
	}
	if len(args) > 0 {
		return adapter.TextResponse("you chose: " + args[0]), nil
	}
	return adapter.TextResponse("no choice"), nil
}

type errCmd struct{}

func (c *errCmd) Name() string      { return "fail" }
func (c *errCmd) Aliases() []string { return nil }
func (c *errCmd) Help() string      { return "always fails" }
func (c *errCmd) Execute(_ adapter.InboundMessage, _ []string) (adapter.OutboundMessage, error) {
	return adapter.OutboundMessage{}, errors.New("boom")
}

// --- Helpers ---

func inboxMsg(provider, chatID, text string) adapter.InboundMessage {
	return adapter.InboundMessage{
		Provider: provider,
		ChatID:   chatID,
		SenderID: "user1",
		Text:     text,
	}
}

// waitFor polls until fn returns true or the deadline passes.
func waitFor(t *testing.T, timeout time.Duration, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not met within timeout")
}

// --- Tests ---

func TestDispatch_RoutesCommandToHandler(t *testing.T) {
	reg := command.NewRegistry()
	reg.Register(&echoCmd{})

	a := newMockAdapter("test")
	r := New(reg)
	r.AddAdapter(a)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = r.Run(ctx) }()

	// Give Run a moment to start the adapter.
	time.Sleep(10 * time.Millisecond)

	a.send(inboxMsg("test", "chat1", "/echo hello"))

	waitFor(t, time.Second, func() bool {
		m := a.lastSent()
		return m != nil && m.Text == "hello"
	})
}

func TestDispatch_UnknownCommand(t *testing.T) {
	reg := command.NewRegistry()

	a := newMockAdapter("test")
	r := New(reg)
	r.AddAdapter(a)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = r.Run(ctx) }()
	time.Sleep(10 * time.Millisecond)

	a.send(inboxMsg("test", "chat1", "/nope"))

	waitFor(t, time.Second, func() bool {
		m := a.lastSent()
		return m != nil && m.Text == "Unknown command. Try /help"
	})
}

func TestDispatch_NonCommandIgnored(t *testing.T) {
	reg := command.NewRegistry()
	reg.Register(&echoCmd{})

	a := newMockAdapter("test")
	r := New(reg)
	r.AddAdapter(a)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = r.Run(ctx) }()
	time.Sleep(10 * time.Millisecond)

	a.send(inboxMsg("test", "chat1", "just a plain message"))

	// Nothing should be sent.
	time.Sleep(50 * time.Millisecond)
	if m := a.lastSent(); m != nil {
		t.Fatalf("expected no response, got %q", m.Text)
	}
}

func TestDispatch_CommandError(t *testing.T) {
	reg := command.NewRegistry()
	reg.Register(&errCmd{})

	a := newMockAdapter("test")
	r := New(reg)
	r.AddAdapter(a)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = r.Run(ctx) }()
	time.Sleep(10 * time.Millisecond)

	a.send(inboxMsg("test", "chat1", "/fail"))

	waitFor(t, time.Second, func() bool {
		m := a.lastSent()
		return m != nil && m.Text == "Error: boom"
	})
}

func TestPendingSelection_SelectsOption(t *testing.T) {
	reg := command.NewRegistry()
	cmd := newOptionsCmd()
	reg.Register(cmd)

	a := newMockAdapter("test")
	r := New(reg)
	r.AddAdapter(a)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = r.Run(ctx) }()
	time.Sleep(10 * time.Millisecond)

	// First message: command returns options.
	a.send(inboxMsg("test", "chat1", "/pick"))

	waitFor(t, time.Second, func() bool {
		m := a.lastSent()
		return m != nil && len(m.Options) == 3
	})

	// Second message: user picks option 2.
	a.send(inboxMsg("test", "chat1", "2"))

	waitFor(t, time.Second, func() bool {
		m := a.lastSent()
		return m != nil && m.Text == "you chose: beta"
	})

	// Pending state should be cleared.
	r.mu.Lock()
	_, hasPending := r.pending["chat1"]
	r.mu.Unlock()
	if hasPending {
		t.Fatal("expected pending state to be cleared after selection")
	}
}

func TestPendingSelection_OutOfRangeIgnored(t *testing.T) {
	reg := command.NewRegistry()
	cmd := newOptionsCmd()
	reg.Register(cmd)

	a := newMockAdapter("test")
	r := New(reg)
	r.AddAdapter(a)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = r.Run(ctx) }()
	time.Sleep(10 * time.Millisecond)

	a.send(inboxMsg("test", "chat1", "/pick"))

	waitFor(t, time.Second, func() bool {
		m := a.lastSent()
		return m != nil && len(m.Options) == 3
	})

	sentBefore := len(a.sent)

	// Out-of-range number: should not consume pending, no response.
	a.send(inboxMsg("test", "chat1", "99"))

	time.Sleep(50 * time.Millisecond)

	a.mu.Lock()
	sentAfter := len(a.sent)
	a.mu.Unlock()

	if sentAfter != sentBefore {
		t.Fatalf("expected no new response for out-of-range index, got %d new messages", sentAfter-sentBefore)
	}

	// Pending state should still be present.
	r.mu.Lock()
	_, hasPending := r.pending["chat1"]
	r.mu.Unlock()
	if !hasPending {
		t.Fatal("expected pending state to still be set")
	}
}

func TestPendingSelection_ExpiresAfterTimeout(t *testing.T) {
	reg := command.NewRegistry()
	cmd := newOptionsCmd()
	reg.Register(cmd)

	a := newMockAdapter("test")
	r := New(reg)
	r.AddAdapter(a)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = r.Run(ctx) }()
	time.Sleep(10 * time.Millisecond)

	a.send(inboxMsg("test", "chat1", "/pick"))

	waitFor(t, time.Second, func() bool {
		m := a.lastSent()
		return m != nil && len(m.Options) == 3
	})

	// Manually expire the pending entry.
	r.mu.Lock()
	if ps, ok := r.pending["chat1"]; ok {
		ps.expiresAt = time.Now().Add(-time.Second)
	}
	r.mu.Unlock()

	sentBefore := len(a.sent)

	// A numeric reply should not be handled — pending has expired.
	a.send(inboxMsg("test", "chat1", "1"))

	time.Sleep(50 * time.Millisecond)

	a.mu.Lock()
	sentAfter := len(a.sent)
	a.mu.Unlock()

	// The "1" is not a /command so it should be silently ignored, not trigger a response.
	if sentAfter != sentBefore {
		t.Fatalf("expected no response after expiry, got %d new messages", sentAfter-sentBefore)
	}
}

func TestSendAlert_BroadcastsToAllAdapters(t *testing.T) {
	reg := command.NewRegistry()

	a1 := newMockAdapter("adapterA")
	a2 := newMockAdapter("adapterB")
	r := New(reg)
	r.AddAdapter(a1)
	r.AddAdapter(a2)

	r.SendAlert("fire!")

	if len(a1.alerts) != 1 || a1.alerts[0] != "fire!" {
		t.Errorf("adapterA: expected alert, got %v", a1.alerts)
	}
	if len(a2.alerts) != 1 || a2.alerts[0] != "fire!" {
		t.Errorf("adapterB: expected alert, got %v", a2.alerts)
	}
}

func TestParseCommand(t *testing.T) {
	cases := []struct {
		input    string
		wantName string
		wantArgs []string
	}{
		{"/start", "start", nil},
		{"/Start", "start", nil},
		{"/echo hello world", "echo", []string{"hello", "world"}},
		{"/start@mybot", "start", nil},
		{"/echo@mybot arg1", "echo", []string{"arg1"}},
		{"/ ", "", nil},
	}
	for _, tc := range cases {
		name, args := parseCommand(tc.input)
		if name != tc.wantName {
			t.Errorf("parseCommand(%q): name = %q, want %q", tc.input, name, tc.wantName)
		}
		if len(args) != len(tc.wantArgs) {
			t.Errorf("parseCommand(%q): args = %v, want %v", tc.input, args, tc.wantArgs)
			continue
		}
		for i := range args {
			if args[i] != tc.wantArgs[i] {
				t.Errorf("parseCommand(%q): args[%d] = %q, want %q", tc.input, i, args[i], tc.wantArgs[i])
			}
		}
	}
}

func TestParseIndex(t *testing.T) {
	cases := []struct {
		input string
		want  int
		valid bool
	}{
		{"1", 1, true},
		{"3", 3, true},
		{"0", 0, false},
		{"-1", 0, false},
		{"abc", 0, false},
		{"", 0, false},
		{"1a", 0, false},
	}
	for _, tc := range cases {
		got, ok := parseIndex(tc.input)
		if ok != tc.valid || got != tc.want {
			t.Errorf("parseIndex(%q) = (%d, %v), want (%d, %v)", tc.input, got, ok, tc.want, tc.valid)
		}
	}
}

// covers the new path where the user picks an option by clicking an inline
// keyboard button — the callback delivers the option string itself, not a
// numeric index. before this fix the click was a no-op.
func TestPendingSelection_SelectsOptionByText(t *testing.T) {
	reg := command.NewRegistry()
	cmd := newOptionsCmd()
	reg.Register(cmd)

	a := newMockAdapter("test")
	r := New(reg)
	r.AddAdapter(a)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = r.Run(ctx) }()
	time.Sleep(10 * time.Millisecond)

	a.send(inboxMsg("test", "chat1", "/pick"))
	waitFor(t, time.Second, func() bool {
		m := a.lastSent()
		return m != nil && len(m.Options) == 3
	})

	a.send(inboxMsg("test", "chat1", "gamma"))
	waitFor(t, time.Second, func() bool {
		m := a.lastSent()
		return m != nil && m.Text == "you chose: gamma"
	})

	r.mu.Lock()
	_, hasPending := r.pending["chat1"]
	r.mu.Unlock()
	if hasPending {
		t.Fatal("expected pending state to be cleared after option-text match")
	}
}
