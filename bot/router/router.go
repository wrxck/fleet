package router

import (
	"context"
	"strings"
	"sync"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/command"
)

const selectionExpiry = 2 * time.Minute

// pendingSelection holds state for a command that returned Options, awaiting
// the user to reply with a numeric choice.
type pendingSelection struct {
	cmd      command.Command
	options  []string
	original adapter.InboundMessage
	expiresAt time.Time
}

// Router dispatches inbound messages to registered commands and manages
// pending selection state.
type Router struct {
	registry *command.Registry
	adapters map[string]adapter.Adapter

	mu      sync.Mutex
	pending map[string]*pendingSelection
}

// New creates a Router backed by the given command registry.
func New(reg *command.Registry) *Router {
	return &Router{
		registry: reg,
		adapters: make(map[string]adapter.Adapter),
		pending:  make(map[string]*pendingSelection),
	}
}

// AddAdapter registers an adapter under its Name().
func (r *Router) AddAdapter(a adapter.Adapter) {
	r.adapters[a.Name()] = a
}

// Adapter returns the named adapter, or nil if not found.
func (r *Router) Adapter(name string) adapter.Adapter {
	return r.adapters[name]
}

// Run starts all adapters and dispatches messages until ctx is cancelled.
// It returns the first non-context error encountered, or nil on clean shutdown.
func (r *Router) Run(ctx context.Context) error {
	inbox := make(chan adapter.InboundMessage, 64)

	for _, a := range r.adapters {
		if err := a.Start(ctx, inbox); err != nil {
			return err
		}
	}

	for {
		select {
		case <-ctx.Done():
			for _, a := range r.adapters {
				_ = a.Stop()
			}
			return nil
		case msg := <-inbox:
			go r.dispatch(msg)
		}
	}
}

// SendAlert sends text through every adapter's SendAlert.
func (r *Router) SendAlert(text string) {
	for _, a := range r.adapters {
		_ = a.SendAlert(text)
	}
}

// dispatch handles a single inbound message.
func (r *Router) dispatch(msg adapter.InboundMessage) {
	// Enforce per-sender authorization if the originating adapter supports it.
	// An adapter that does not implement SenderAuthorizer is assumed to have
	// already authenticated the sender at the transport layer.
	if a, ok := r.adapters[msg.Provider]; ok {
		if auth, ok := a.(adapter.SenderAuthorizer); ok {
			if !auth.IsAuthorizedSender(msg.SenderID) {
				return
			}
		}
	}

	text := strings.TrimSpace(msg.Text)

	// Check pending selection first.
	if r.handlePendingSelection(msg, text) {
		return
	}

	// Only handle /command messages.
	if !strings.HasPrefix(text, "/") {
		return
	}

	cmdName, args := parseCommand(text)
	if cmdName == "" {
		return
	}

	cmd := r.registry.Lookup(cmdName)
	if cmd == nil {
		r.respond(msg, adapter.TextResponse("Unknown command. Try /help"))
		return
	}

	resp, err := cmd.Execute(msg, args)
	if err != nil {
		r.respond(msg, adapter.TextResponse("Error: "+err.Error()))
		return
	}

	if len(resp.Options) > 0 {
		r.mu.Lock()
		r.pending[msg.ChatID] = &pendingSelection{
			cmd:      cmd,
			options:  resp.Options,
			original: msg,
			expiresAt: time.Now().Add(selectionExpiry),
		}
		r.mu.Unlock()
	}

	r.respond(msg, resp)
}

// handlePendingSelection checks if the message is a numeric reply to a pending
// selection, executes the command with the chosen option, and returns true if
// the message was consumed.
func (r *Router) handlePendingSelection(msg adapter.InboundMessage, text string) bool {
	r.mu.Lock()
	ps, ok := r.pending[msg.ChatID]
	if ok {
		if time.Now().After(ps.expiresAt) {
			delete(r.pending, msg.ChatID)
			r.mu.Unlock()
			return false
		}
	}
	r.mu.Unlock()

	if !ok {
		return false
	}

	// accept either a numeric index or the option string itself.
	// callback_query buttons send back the option text as the message body, so
	// match exact-string first, then fall back to "1", "2", "3" replies.
	var chosen string
	if n, valid := parseIndex(text); valid && n >= 1 && n <= len(ps.options) {
		chosen = ps.options[n-1]
	} else {
		for _, opt := range ps.options {
			if opt == text {
				chosen = opt
				break
			}
		}
	}
	if chosen == "" {
		return false
	}

	// consume the pending entry.
	r.mu.Lock()
	delete(r.pending, msg.ChatID)
	r.mu.Unlock()

	resp, err := ps.cmd.Execute(ps.original, []string{chosen})
	if err != nil {
		r.respond(msg, adapter.TextResponse("Error: "+err.Error()))
		return true
	}

	// If the re-execution also returns options, store them.
	if len(resp.Options) > 0 {
		r.mu.Lock()
		r.pending[msg.ChatID] = &pendingSelection{
			cmd:      ps.cmd,
			options:  resp.Options,
			original: ps.original,
			expiresAt: time.Now().Add(selectionExpiry),
		}
		r.mu.Unlock()
	}

	r.respond(msg, resp)
	return true
}

// respond sends a response through the adapter that originated the message.
// if resp.Stream is non-nil, it's invoked in a goroutine with a closure that
// edits the just-sent message in place. on adapters that don't track message
// ids (bluebubbles), the closure is a no-op so the streaming command can run
// the same code path on every provider.
func (r *Router) respond(msg adapter.InboundMessage, resp adapter.OutboundMessage) {
	a, ok := r.adapters[msg.Provider]
	if !ok {
		return
	}
	messageID, err := a.Send(msg.ChatID, resp)
	if err != nil || resp.Stream == nil {
		return
	}
	go resp.Stream(func(text string) {
		if messageID == "" {
			return
		}
		_ = a.Edit(msg.ChatID, messageID, text)
	})
}

// parseCommand strips the leading '/', splits on whitespace, and separates the
// command name (lowercased, @botname suffix removed) from any arguments.
func parseCommand(text string) (name string, args []string) {
	// Strip leading '/'
	text = text[1:]
	parts := strings.Fields(text)
	if len(parts) == 0 {
		return "", nil
	}
	raw := parts[0]
	// Strip @botname suffix (e.g. /start@mybot -> start)
	if idx := strings.Index(raw, "@"); idx != -1 {
		raw = raw[:idx]
	}
	name = strings.ToLower(raw)
	if len(parts) > 1 {
		args = parts[1:]
	}
	return name, args
}

// parseIndex converts a trimmed string to a 1-based integer index.
// Returns (0, false) if the string is not a positive integer.
func parseIndex(s string) (int, bool) {
	if len(s) == 0 || len(s) > 9 {
		return 0, false
	}
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, false
		}
		n = n*10 + int(ch-'0')
	}
	if n == 0 {
		return 0, false
	}
	return n, true
}
