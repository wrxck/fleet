package command

import (
	"fmt"
	"strings"
	"sync"
)

// Registry holds all registered commands and provides lookup and iteration.
type Registry struct {
	mu       sync.RWMutex
	commands map[string]Command  // primary name -> Command
	aliases  map[string]string   // alias -> primary name
	order    []string            // primary names in registration order
}

// NewRegistry creates an empty Registry.
func NewRegistry() *Registry {
	return &Registry{
		commands: make(map[string]Command),
		aliases:  make(map[string]string),
	}
}

// Register adds cmd to the registry.
// Panics if cmd.Name() or any of cmd.Aliases() is already registered.
func (r *Registry) Register(cmd Command) {
	r.mu.Lock()
	defer r.mu.Unlock()

	name := strings.ToLower(cmd.Name())

	if _, exists := r.commands[name]; exists {
		panic(fmt.Sprintf("command: duplicate name %q", name))
	}
	if primary, exists := r.aliases[name]; exists {
		panic(fmt.Sprintf("command: name %q already registered as alias for %q", name, primary))
	}

	for _, alias := range cmd.Aliases() {
		a := strings.ToLower(alias)
		if _, exists := r.commands[a]; exists {
			panic(fmt.Sprintf("command: alias %q conflicts with existing command name", a))
		}
		if primary, exists := r.aliases[a]; exists {
			panic(fmt.Sprintf("command: alias %q already registered as alias for %q", a, primary))
		}
	}

	r.commands[name] = cmd
	for _, alias := range cmd.Aliases() {
		r.aliases[strings.ToLower(alias)] = name
	}
	r.order = append(r.order, name)
}

// Lookup returns the Command for the given name or alias (case-insensitive).
// Returns nil if no matching command is found.
func (r *Registry) Lookup(name string) Command {
	r.mu.RLock()
	defer r.mu.RUnlock()

	key := strings.ToLower(name)

	if cmd, ok := r.commands[key]; ok {
		return cmd
	}
	if primary, ok := r.aliases[key]; ok {
		return r.commands[primary]
	}
	return nil
}

// HelpText returns a formatted listing of all registered commands with their
// aliases and help text, in registration order.
func (r *Registry) HelpText() string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var sb strings.Builder
	for _, name := range r.order {
		cmd := r.commands[name]
		line := "/" + name
		if aliases := cmd.Aliases(); len(aliases) > 0 {
			normalized := make([]string, len(aliases))
			for i, a := range aliases {
				normalized[i] = "/" + strings.ToLower(a)
			}
			line += " (" + strings.Join(normalized, ", ") + ")"
		}
		line += " — " + cmd.Help()
		sb.WriteString(line)
		sb.WriteByte('\n')
	}
	return sb.String()
}

// ForEach calls fn for each registered command in registration order.
func (r *Registry) ForEach(fn func(Command)) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, name := range r.order {
		fn(r.commands[name])
	}
}
