# Restart Loop Prevention + iMessage Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent services from endlessly crash-looping (freeze after N failures), and replace Telegram-hardcoded notifications with a pluggable adapter system supporting iMessage via BlueBubbles + Telegram as fallback.

**Architecture:** Two phases — (1) TypeScript CLI gets freeze/unfreeze commands with systemd restart limits, (2) Go bot is restructured into adapter/command/router packages where commands are provider-agnostic and adapters (BlueBubbles, Telegram) handle provider-specific rendering. Alert monitor gains auto-freeze logic.

**Tech Stack:** TypeScript (fleet CLI), Go (fleet-bot), systemd, BlueBubbles REST API, Cloudflare Access

---

## Phase 1: TypeScript — Restart Loop Prevention

### Task 1: Patch Systemd Services with Restart Limits

**Files:**
- Create: `src/commands/patch-systemd.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the migration script**

Create `src/commands/patch-systemd.ts`:

```typescript
import { load } from '../core/registry.js';
import { readServiceFile } from '../core/systemd.js';
import { execSafe } from '../core/exec.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { success, warn, info, error } from '../ui/output.js';

const RESTART_LIMITS = `StartLimitBurst=5\nStartLimitIntervalSec=300`;

export function patchSystemdCommand(): void {
  const reg = load();
  const serviceNames = [
    ...reg.apps.map(a => a.serviceName),
    reg.infrastructure.databases.serviceName,
  ];

  let patched = 0;
  let skipped = 0;

  for (const name of serviceNames) {
    const content = readServiceFile(name);
    if (!content) {
      warn(`${name}: no service file found, skipping`);
      skipped++;
      continue;
    }

    if (content.includes('StartLimitBurst=')) {
      info(`${name}: already has StartLimitBurst, skipping`);
      skipped++;
      continue;
    }

    // Insert restart limits into [Service] section
    const updated = content.replace(
      /(\[Service\]\n)/,
      `$1${RESTART_LIMITS}\n`
    );

    if (updated === content) {
      warn(`${name}: could not find [Service] section, skipping`);
      skipped++;
      continue;
    }

    const path = `/etc/systemd/system/${name}.service`;
    writeFileSync(path, updated);
    success(`${name}: patched with restart limits`);
    patched++;
  }

  if (patched > 0) {
    execSafe('systemctl', ['daemon-reload']);
    success(`daemon-reload complete`);
  }

  info(`Patched: ${patched}, Skipped: ${skipped}`);
}
```

- [ ] **Step 2: Register in CLI**

Add to `src/cli.ts` imports:

```typescript
import { patchSystemdCommand } from './commands/patch-systemd.js';
```

Add to the switch/case or command routing (find the pattern used in cli.ts):

```typescript
case 'patch-systemd':
  patchSystemdCommand();
  break;
```

- [ ] **Step 3: Run the migration**

```bash
npm run build && fleet patch-systemd
```

Expected: Each fleet-managed service gets `StartLimitBurst=5` and `StartLimitIntervalSec=300` in its `[Service]` section.

- [ ] **Step 4: Verify a patched service**

```bash
grep -A2 'StartLimitBurst' /etc/systemd/system/abmanandvan.service
```

Expected:
```
StartLimitBurst=5
StartLimitIntervalSec=300
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/patch-systemd.ts src/cli.ts
git commit -m "feat(systemd): add restart limit migration script"
```

---

### Task 2: Add Frozen State to Registry + Freeze/Unfreeze Commands

**Files:**
- Modify: `src/core/registry.ts` — add `frozenAt`, `frozenReason` to `AppEntry`
- Create: `src/commands/freeze.ts` — freeze/unfreeze handlers
- Modify: `src/cli.ts` — register commands
- Modify: `src/core/systemd.ts` — nothing new needed, already has `enableService`/`disableService`/`stopService`/`startService`

- [ ] **Step 1: Write tests for freeze/unfreeze**

Create `src/commands/freeze.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before imports
vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  save: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  stopService: vi.fn(() => true),
  startService: vi.fn(() => true),
  enableService: vi.fn(() => true),
  disableService: vi.fn(() => true),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { load, save, findApp } from '../core/registry.js';
import { stopService, disableService, startService, enableService } from '../core/systemd.js';
import { freezeApp, unfreezeApp } from './freeze.js';

const mockLoad = vi.mocked(load);
const mockSave = vi.mocked(save);
const mockFindApp = vi.mocked(findApp);

const makeRegistry = (app: any) => ({
  version: 1,
  apps: [app],
  infrastructure: {
    databases: { serviceName: 'docker-databases', composePath: '/home/matt/docker-databases' },
    nginx: { configPath: '/etc/nginx' },
  },
});

describe('freezeApp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stops, disables, and marks app as frozen', () => {
    const app = { name: 'test-app', serviceName: 'test-app' };
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    freezeApp('test-app', 'crash loop detected');

    expect(stopService).toHaveBeenCalledWith('test-app');
    expect(disableService).toHaveBeenCalledWith('test-app');
    expect(app).toHaveProperty('frozenAt');
    expect(app).toHaveProperty('frozenReason', 'crash loop detected');
    expect(mockSave).toHaveBeenCalledWith(reg);
  });

  it('throws if app is already frozen', () => {
    const app = { name: 'test-app', serviceName: 'test-app', frozenAt: '2026-01-01T00:00:00Z' };
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    expect(() => freezeApp('test-app')).toThrow('already frozen');
  });
});

describe('unfreezeApp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clears frozen state, enables, and starts app', () => {
    const app = { name: 'test-app', serviceName: 'test-app', frozenAt: '2026-01-01T00:00:00Z', frozenReason: 'crash' };
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    unfreezeApp('test-app');

    expect(enableService).toHaveBeenCalledWith('test-app');
    expect(startService).toHaveBeenCalledWith('test-app');
    expect(app.frozenAt).toBeUndefined();
    expect(app.frozenReason).toBeUndefined();
    expect(mockSave).toHaveBeenCalledWith(reg);
  });

  it('throws if app is not frozen', () => {
    const app = { name: 'test-app', serviceName: 'test-app' };
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    expect(() => unfreezeApp('test-app')).toThrow('not frozen');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/commands/freeze.test.ts
```

Expected: FAIL — `freeze.js` doesn't exist yet.

- [ ] **Step 3: Add frozen fields to AppEntry**

In `src/core/registry.ts`, add to the `AppEntry` interface after `gitOnboardedAt?`:

```typescript
frozenAt?: string;
frozenReason?: string;
```

- [ ] **Step 4: Implement freeze/unfreeze**

Create `src/commands/freeze.ts`:

```typescript
import { load, save, findApp } from '../core/registry.js';
import { stopService, startService, enableService, disableService } from '../core/systemd.js';
import { AppNotFoundError } from '../core/errors.js';
import { success, error } from '../ui/output.js';

export function freezeApp(appName: string, reason?: string): void {
  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);
  if (app.frozenAt) throw new Error(`${app.name} is already frozen since ${app.frozenAt}`);

  stopService(app.serviceName);
  disableService(app.serviceName);

  app.frozenAt = new Date().toISOString();
  app.frozenReason = reason ?? 'manually frozen';
  save(reg);
}

export function unfreezeApp(appName: string): void {
  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);
  if (!app.frozenAt) throw new Error(`${app.name} is not frozen`);

  delete app.frozenAt;
  delete app.frozenReason;
  save(reg);

  enableService(app.serviceName);
  startService(app.serviceName);
}

export function freezeCommand(args: string[]): void {
  const appName = args[0];
  const reason = args.slice(1).join(' ') || undefined;
  if (!appName) {
    error('Usage: fleet freeze <app> [reason]');
    process.exit(1);
  }
  freezeApp(appName, reason);
  success(`Frozen ${appName}`);
}

export function unfreezeCommand(args: string[]): void {
  const appName = args[0];
  if (!appName) {
    error('Usage: fleet unfreeze <app>');
    process.exit(1);
  }
  unfreezeApp(appName);
  success(`Unfrozen and started ${appName}`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/commands/freeze.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Register in CLI**

In `src/cli.ts`, add import:

```typescript
import { freezeCommand, unfreezeCommand } from './commands/freeze.js';
```

Add cases to the command router:

```typescript
case 'freeze':
  freezeCommand(args);
  break;
case 'unfreeze':
  unfreezeCommand(args);
  break;
```

Update the HELP string to include:

```
  freeze <app>        Freeze a crash-looping service (stop + disable)
  unfreeze <app>      Unfreeze and restart a frozen service
```

- [ ] **Step 7: Add MCP tools**

In `src/mcp/server.ts`, add freeze/unfreeze tools using the existing pattern:

```typescript
import { freezeApp, unfreezeApp } from '../commands/freeze.js';

server.tool(
  'fleet_freeze',
  'Freeze a crash-looping service. Stops and disables it so it cannot restart. Use fleet_unfreeze to re-enable.',
  { app: z.string().describe('App name'), reason: z.string().optional().describe('Reason for freezing') },
  async ({ app, reason }) => {
    freezeApp(app, reason);
    return text(`Frozen ${app}. Run fleet_unfreeze to re-enable.`);
  },
);

server.tool(
  'fleet_unfreeze',
  'Unfreeze a previously frozen service. Re-enables and starts it.',
  { app: z.string().describe('App name') },
  async ({ app }) => {
    unfreezeApp(app);
    return text(`Unfrozen and started ${app}.`);
  },
);
```

- [ ] **Step 8: Update status display for frozen apps**

In `src/commands/status.ts`, check `app.frozenAt` and display frozen state distinctly. Find where the status table is built and add a frozen indicator. If `app.frozenAt` is set, show the health as "frozen" instead of "down".

- [ ] **Step 9: Build and test end-to-end**

```bash
npm run build && npm test
```

Verify: `fleet freeze winzila-affiliate "missing secrets"` works, `fleet status` shows it as frozen, `fleet unfreeze winzila-affiliate` re-enables it.

- [ ] **Step 10: Commit**

```bash
git add src/core/registry.ts src/commands/freeze.ts src/commands/freeze.test.ts src/cli.ts src/mcp/server.ts src/commands/status.ts
git commit -m "feat(freeze): add freeze/unfreeze commands with MCP tools"
```

---

## Phase 2: Go Bot — Core Infrastructure

### Task 3: Adapter Interface + Message Types

**Files:**
- Create: `bot/adapter/adapter.go`
- Create: `bot/adapter/adapter_test.go`

- [ ] **Step 1: Create adapter package with core types**

Create `bot/adapter/adapter.go`:

```go
package adapter

import "context"

// InboundMessage is a provider-agnostic incoming message.
type InboundMessage struct {
	ChatID    string
	SenderID  string
	Text      string
	HasPhoto  bool
	PhotoData []byte
	Provider  string // "imessage", "telegram", etc.
}

// OutboundMessage is a provider-agnostic response.
type OutboundMessage struct {
	Text     string
	Photo    []byte
	Document []byte
	Caption  string
	Options  []string // rendered per-provider (keyboard or numbered list)
}

// TextResponse is a convenience for simple text replies.
func TextResponse(text string) OutboundMessage {
	return OutboundMessage{Text: text}
}

// OptionsResponse is a convenience for text + selectable options.
func OptionsResponse(text string, options []string) OutboundMessage {
	return OutboundMessage{Text: text, Options: options}
}

// Adapter is the interface every messaging provider must implement.
type Adapter interface {
	// Name returns the adapter identifier (e.g. "telegram", "imessage").
	Name() string

	// Start begins listening for inbound messages.
	// Messages are pushed to the inbox channel.
	Start(ctx context.Context, inbox chan<- InboundMessage) error

	// Send delivers an outbound message to the given chat.
	// The adapter handles provider-specific rendering (keyboards, numbered lists, etc.).
	Send(chatID string, msg OutboundMessage) error

	// SendAlert delivers a plain text alert to all configured alert destinations.
	SendAlert(text string) error

	// Stop gracefully shuts down the adapter.
	Stop() error
}
```

- [ ] **Step 2: Write basic test**

Create `bot/adapter/adapter_test.go`:

```go
package adapter

import "testing"

func TestTextResponse(t *testing.T) {
	msg := TextResponse("hello")
	if msg.Text != "hello" {
		t.Fatalf("expected 'hello', got %q", msg.Text)
	}
	if len(msg.Options) != 0 {
		t.Fatal("expected no options")
	}
}

func TestOptionsResponse(t *testing.T) {
	msg := OptionsResponse("pick one:", []string{"a", "b"})
	if msg.Text != "pick one:" {
		t.Fatalf("expected 'pick one:', got %q", msg.Text)
	}
	if len(msg.Options) != 2 {
		t.Fatalf("expected 2 options, got %d", len(msg.Options))
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd bot && go test ./adapter/ -v
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add bot/adapter/
git commit -m "feat(bot): add adapter interface and message types"
```

---

### Task 4: Command Interface + Registry

**Files:**
- Create: `bot/command/command.go`
- Create: `bot/command/registry.go`
- Create: `bot/command/registry_test.go`

- [ ] **Step 1: Create command interface**

Create `bot/command/command.go`:

```go
package command

import "fleet-bot/adapter"

// Command is the interface every bot command must implement.
type Command interface {
	// Name returns the primary command name (without slash), e.g. "status".
	Name() string

	// Aliases returns alternative names, e.g. ["s"] for status.
	Aliases() []string

	// Help returns a short description for the /help listing.
	Help() string

	// Execute runs the command and returns a response.
	Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error)
}
```

- [ ] **Step 2: Create command registry**

Create `bot/command/registry.go`:

```go
package command

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"fleet-bot/adapter"
)

// Registry holds all registered commands and resolves names/aliases.
type Registry struct {
	mu       sync.RWMutex
	commands map[string]Command // name -> command
	aliases  map[string]string  // alias -> canonical name
	order    []string           // insertion order for help
}

func NewRegistry() *Registry {
	return &Registry{
		commands: make(map[string]Command),
		aliases:  make(map[string]string),
	}
}

// Register adds a command. Panics on duplicate name/alias.
func (r *Registry) Register(cmd Command) {
	r.mu.Lock()
	defer r.mu.Unlock()

	name := strings.ToLower(cmd.Name())
	if _, exists := r.commands[name]; exists {
		panic(fmt.Sprintf("duplicate command: %s", name))
	}
	r.commands[name] = cmd
	r.order = append(r.order, name)

	for _, alias := range cmd.Aliases() {
		alias = strings.ToLower(alias)
		if _, exists := r.aliases[alias]; exists {
			panic(fmt.Sprintf("duplicate alias: %s", alias))
		}
		if _, exists := r.commands[alias]; exists {
			panic(fmt.Sprintf("alias %s conflicts with command name", alias))
		}
		r.aliases[alias] = name
	}
}

// Lookup finds a command by name or alias. Returns nil if not found.
func (r *Registry) Lookup(name string) Command {
	r.mu.RLock()
	defer r.mu.RUnlock()

	name = strings.ToLower(name)
	if cmd, ok := r.commands[name]; ok {
		return cmd
	}
	if canonical, ok := r.aliases[name]; ok {
		return r.commands[canonical]
	}
	return nil
}

// HelpText generates the /help listing.
func (r *Registry) HelpText() string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var lines []string
	for _, name := range r.order {
		cmd := r.commands[name]
		aliases := cmd.Aliases()
		entry := fmt.Sprintf("/%s", name)
		if len(aliases) > 0 {
			sort.Strings(aliases)
			entry += fmt.Sprintf(" (%s)", strings.Join(aliases, ", "))
		}
		entry += fmt.Sprintf(" — %s", cmd.Help())
		lines = append(lines, entry)
	}
	return "Available commands:\n\n" + strings.Join(lines, "\n")
}

// ForEach iterates over all commands in registration order.
func (r *Registry) ForEach(fn func(Command)) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, name := range r.order {
		fn(r.commands[name])
	}
}
```

- [ ] **Step 3: Write registry tests**

Create `bot/command/registry_test.go`:

```go
package command

import (
	"strings"
	"testing"

	"fleet-bot/adapter"
)

type stubCmd struct {
	name    string
	aliases []string
	help    string
}

func (s *stubCmd) Name() string        { return s.name }
func (s *stubCmd) Aliases() []string   { return s.aliases }
func (s *stubCmd) Help() string        { return s.help }
func (s *stubCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	return adapter.TextResponse("ok"), nil
}

func TestRegistryLookup(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubCmd{name: "status", aliases: []string{"s"}, help: "Show status"})

	if cmd := r.Lookup("status"); cmd == nil {
		t.Fatal("expected to find 'status'")
	}
	if cmd := r.Lookup("s"); cmd == nil {
		t.Fatal("expected to find alias 's'")
	}
	if cmd := r.Lookup("STATUS"); cmd == nil {
		t.Fatal("expected case-insensitive lookup")
	}
	if cmd := r.Lookup("unknown"); cmd != nil {
		t.Fatal("expected nil for unknown command")
	}
}

func TestRegistryHelpText(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubCmd{name: "status", aliases: []string{"s"}, help: "Show status"})
	r.Register(&stubCmd{name: "restart", help: "Restart app"})

	help := r.HelpText()
	if !strings.Contains(help, "/status (s)") {
		t.Fatalf("expected alias in help, got:\n%s", help)
	}
	if !strings.Contains(help, "/restart") {
		t.Fatalf("expected restart in help, got:\n%s", help)
	}
}

func TestRegistryDuplicatePanics(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubCmd{name: "status"})

	defer func() {
		if recover() == nil {
			t.Fatal("expected panic on duplicate")
		}
	}()
	r.Register(&stubCmd{name: "status"})
}
```

- [ ] **Step 4: Run tests**

```bash
cd bot && go test ./command/ -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add bot/command/
git commit -m "feat(bot): add command interface and registry"
```

---

### Task 5: Router with Selection State

**Files:**
- Create: `bot/router/router.go`
- Create: `bot/router/router_test.go`

- [ ] **Step 1: Create the router**

Create `bot/router/router.go`:

```go
package router

import (
	"context"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/command"
)

// pendingSelection tracks when a command returned Options and we're waiting
// for the user to pick a number.
type pendingSelection struct {
	command   command.Command
	options   []string
	original  adapter.InboundMessage
	expiresAt time.Time
}

// Router dispatches inbound messages to commands via adapters.
type Router struct {
	registry *command.Registry
	adapters map[string]adapter.Adapter // name -> adapter

	mu       sync.Mutex
	pending  map[string]*pendingSelection // chatID -> pending
}

func New(reg *command.Registry) *Router {
	return &Router{
		registry: reg,
		adapters: make(map[string]adapter.Adapter),
		pending:  make(map[string]*pendingSelection),
	}
}

// AddAdapter registers an adapter for routing.
func (r *Router) AddAdapter(a adapter.Adapter) {
	r.adapters[a.Name()] = a
}

// Adapter returns the named adapter, or nil.
func (r *Router) Adapter(name string) adapter.Adapter {
	return r.adapters[name]
}

// Run starts all adapters and processes the shared inbox.
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
				a.Stop()
			}
			return nil
		case msg := <-inbox:
			r.dispatch(msg)
		}
	}
}

// SendAlert sends a text alert through all adapters.
func (r *Router) SendAlert(text string) {
	for _, a := range r.adapters {
		if err := a.SendAlert(text); err != nil {
			log.Printf("alert send error (%s): %v", a.Name(), err)
		}
	}
}

func (r *Router) dispatch(msg adapter.InboundMessage) {
	text := strings.TrimSpace(msg.Text)

	// Check for pending selection (user replied with a number)
	if r.handlePendingSelection(msg, text) {
		return
	}

	// Must start with /
	if !strings.HasPrefix(text, "/") {
		return
	}

	text = text[1:] // strip /
	parts := strings.SplitN(text, " ", 2)
	cmdName := strings.ToLower(parts[0])

	// Strip @botname suffix (Telegram sends /status@botname)
	if at := strings.Index(cmdName, "@"); at >= 0 {
		cmdName = cmdName[:at]
	}

	args := []string{}
	if len(parts) > 1 {
		args = strings.Fields(parts[1])
	}

	cmd := r.registry.Lookup(cmdName)
	if cmd == nil {
		r.respond(msg, adapter.TextResponse("Unknown command. Try /help"))
		return
	}

	log.Printf("cmd: /%s %v (provider: %s, chat: %s)", cmdName, args, msg.Provider, msg.ChatID)

	resp, err := cmd.Execute(msg, args)
	if err != nil {
		r.respond(msg, adapter.TextResponse("Error: "+err.Error()))
		return
	}

	// If command returned options, track as pending selection
	if len(resp.Options) > 0 {
		r.mu.Lock()
		r.pending[msg.ChatID] = &pendingSelection{
			command:   cmd,
			options:   resp.Options,
			original:  msg,
			expiresAt: time.Now().Add(2 * time.Minute),
		}
		r.mu.Unlock()
	}

	r.respond(msg, resp)
}

func (r *Router) handlePendingSelection(msg adapter.InboundMessage, text string) bool {
	r.mu.Lock()
	p, ok := r.pending[msg.ChatID]
	if !ok || time.Now().After(p.expiresAt) {
		delete(r.pending, msg.ChatID)
		r.mu.Unlock()
		return false
	}
	r.mu.Unlock()

	idx, err := strconv.Atoi(text)
	if err != nil || idx < 1 || idx > len(p.options) {
		return false // not a valid selection, let normal routing handle it
	}

	// Clear pending
	r.mu.Lock()
	delete(r.pending, msg.ChatID)
	r.mu.Unlock()

	// Re-execute the command with the selected option as the arg
	selected := p.options[idx-1]
	resp, err := p.command.Execute(msg, []string{selected})
	if err != nil {
		r.respond(msg, adapter.TextResponse("Error: "+err.Error()))
		return true
	}
	r.respond(msg, resp)
	return true
}

func (r *Router) respond(msg adapter.InboundMessage, resp adapter.OutboundMessage) {
	a, ok := r.adapters[msg.Provider]
	if !ok {
		log.Printf("no adapter for provider %q", msg.Provider)
		return
	}
	if err := a.Send(msg.ChatID, resp); err != nil {
		log.Printf("send error (%s -> %s): %v", msg.Provider, msg.ChatID, err)
	}
}
```

- [ ] **Step 2: Write router tests**

Create `bot/router/router_test.go`:

```go
package router

import (
	"context"
	"testing"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/command"
)

type mockAdapter struct {
	name     string
	sent     []adapter.OutboundMessage
	alerts   []string
}

func (m *mockAdapter) Name() string { return m.name }
func (m *mockAdapter) Start(ctx context.Context, inbox chan<- adapter.InboundMessage) error { return nil }
func (m *mockAdapter) Send(chatID string, msg adapter.OutboundMessage) error {
	m.sent = append(m.sent, msg)
	return nil
}
func (m *mockAdapter) SendAlert(text string) error {
	m.alerts = append(m.alerts, text)
	return nil
}
func (m *mockAdapter) Stop() error { return nil }

type echoCmd struct{}

func (e *echoCmd) Name() string        { return "echo" }
func (e *echoCmd) Aliases() []string   { return nil }
func (e *echoCmd) Help() string        { return "Echo back" }
func (e *echoCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	return adapter.TextResponse("echo: " + msg.Text), nil
}

func TestRouterDispatch(t *testing.T) {
	reg := command.NewRegistry()
	reg.Register(&echoCmd{})

	mock := &mockAdapter{name: "test"}
	r := New(reg)
	r.AddAdapter(mock)

	msg := adapter.InboundMessage{
		ChatID:   "123",
		Text:     "/echo hello",
		Provider: "test",
	}
	r.dispatch(msg)

	if len(mock.sent) != 1 {
		t.Fatalf("expected 1 message sent, got %d", len(mock.sent))
	}
	if mock.sent[0].Text != "echo: /echo hello" {
		t.Fatalf("unexpected response: %q", mock.sent[0].Text)
	}
}

func TestRouterUnknownCommand(t *testing.T) {
	reg := command.NewRegistry()
	mock := &mockAdapter{name: "test"}
	r := New(reg)
	r.AddAdapter(mock)

	r.dispatch(adapter.InboundMessage{ChatID: "1", Text: "/nope", Provider: "test"})

	if len(mock.sent) != 1 || mock.sent[0].Text != "Unknown command. Try /help" {
		t.Fatalf("expected unknown command response, got: %+v", mock.sent)
	}
}

func TestRouterPendingSelection(t *testing.T) {
	reg := command.NewRegistry()
	selectCmd := &selectableCmd{}
	reg.Register(selectCmd)

	mock := &mockAdapter{name: "test"}
	r := New(reg)
	r.AddAdapter(mock)

	// First: command returns options
	r.dispatch(adapter.InboundMessage{ChatID: "1", Text: "/pick", Provider: "test"})
	if len(mock.sent) != 1 || len(mock.sent[0].Options) != 3 {
		t.Fatalf("expected options response, got: %+v", mock.sent)
	}

	// Second: user replies with "2"
	r.dispatch(adapter.InboundMessage{ChatID: "1", Text: "2", Provider: "test"})
	if len(mock.sent) != 2 || mock.sent[1].Text != "Selected: banana" {
		t.Fatalf("expected selection response, got: %+v", mock.sent)
	}
}

func TestRouterPendingSelectionExpires(t *testing.T) {
	reg := command.NewRegistry()
	reg.Register(&selectableCmd{})

	mock := &mockAdapter{name: "test"}
	r := New(reg)
	r.AddAdapter(mock)

	r.dispatch(adapter.InboundMessage{ChatID: "1", Text: "/pick", Provider: "test"})

	// Expire the pending selection
	r.mu.Lock()
	r.pending["1"].expiresAt = time.Now().Add(-1 * time.Second)
	r.mu.Unlock()

	// "2" should not be handled as a selection
	r.dispatch(adapter.InboundMessage{ChatID: "1", Text: "2", Provider: "test"})
	if len(mock.sent) != 1 { // only the original options response
		t.Fatalf("expected expired selection to be ignored, got %d messages", len(mock.sent))
	}
}

type selectableCmd struct{}

func (s *selectableCmd) Name() string        { return "pick" }
func (s *selectableCmd) Aliases() []string   { return nil }
func (s *selectableCmd) Help() string        { return "Pick a fruit" }
func (s *selectableCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) > 0 {
		return adapter.TextResponse("Selected: " + args[0]), nil
	}
	return adapter.OptionsResponse("Pick a fruit:", []string{"apple", "banana", "cherry"}), nil
}
```

- [ ] **Step 3: Run tests**

```bash
cd bot && go test ./router/ -v
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add bot/router/
git commit -m "feat(bot): add message router with selection state"
```

---

### Task 6: Configuration Restructure

**Files:**
- Modify: `bot/config/config.go`

- [ ] **Step 1: Update config to support multi-adapter**

Replace `bot/config/config.go`:

```go
package config

import (
	"encoding/json"
	"fmt"
	"os"
)

const DefaultConfigPath = "/etc/fleet/bot.json"

type BlueBubblesConfig struct {
	Enabled              bool     `json:"enabled"`
	ServerURL            string   `json:"serverUrl"`
	Port                 int      `json:"port"`
	Password             string   `json:"password"`
	CfAccessClientID     string   `json:"cfAccessClientId"`
	CfAccessClientSecret string   `json:"cfAccessClientSecret"`
	WebhookPort          int      `json:"webhookPort"`
	AllowedNumbers       []string `json:"allowedNumbers"`
	AlertChatGuids       []string `json:"alertChatGuids"`
}

type TelegramConfig struct {
	Enabled        bool    `json:"enabled"`
	BotToken       string  `json:"botToken"`
	AllowedChatIDs []int64 `json:"allowedChatIds"`
	AlertChatIDs   []int64 `json:"alertChatIds"`
}

type AlertsConfig struct {
	Providers              []string `json:"providers"`
	MaxConsecutiveFailures int      `json:"maxConsecutiveFailures"`
	PollInterval           string   `json:"pollInterval"`
}

type AdaptersConfig struct {
	IMessage *BlueBubblesConfig `json:"imessage,omitempty"`
	Telegram *TelegramConfig    `json:"telegram,omitempty"`
}

type Config struct {
	Adapters  AdaptersConfig `json:"adapters"`
	Alerts    AlertsConfig   `json:"alerts"`
	OpenAIKey string         `json:"openaiKey"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		// Fall back to legacy config
		return loadLegacy(path)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		// Try legacy format
		return loadLegacy(path)
	}

	// If adapters section is empty, try legacy
	if cfg.Adapters.Telegram == nil && cfg.Adapters.IMessage == nil {
		return loadLegacy(path)
	}

	// Defaults
	if cfg.Alerts.MaxConsecutiveFailures == 0 {
		cfg.Alerts.MaxConsecutiveFailures = 5
	}
	if cfg.Alerts.PollInterval == "" {
		cfg.Alerts.PollInterval = "2m"
	}

	return &cfg, nil
}

// loadLegacy handles the old /etc/fleet/telegram.json format.
func loadLegacy(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var raw struct {
		BotToken  string `json:"botToken"`
		ChatID    string `json:"chatId"`
		OpenAIKey string `json:"openaiKey"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if raw.BotToken == "" {
		return nil, fmt.Errorf("botToken is required")
	}

	var chatID int64
	fmt.Sscanf(raw.ChatID, "%d", &chatID)

	return &Config{
		Adapters: AdaptersConfig{
			Telegram: &TelegramConfig{
				Enabled:        true,
				BotToken:       raw.BotToken,
				AllowedChatIDs: []int64{chatID},
				AlertChatIDs:   []int64{chatID},
			},
		},
		Alerts: AlertsConfig{
			Providers:              []string{"telegram"},
			MaxConsecutiveFailures: 5,
			PollInterval:           "2m",
		},
		OpenAIKey: raw.OpenAIKey,
	}, nil
}
```

- [ ] **Step 2: Commit**

```bash
git add bot/config/config.go
git commit -m "feat(bot): restructure config for multi-adapter support"
```

---

## Phase 3: Go Bot — Adapters

### Task 7: Telegram Adapter

**Files:**
- Create: `bot/adapter/telegram.go`

- [ ] **Step 1: Implement Telegram adapter**

Create `bot/adapter/telegram.go`. This wraps the existing `bot.Bot` Telegram client:

```go
package adapter

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"

	"fleet-bot/bot"
)

type TelegramAdapter struct {
	bot            *bot.Bot
	allowedChatIDs map[int64]bool
	alertChatIDs   []int64
}

func NewTelegram(botToken string, allowedChatIDs, alertChatIDs []int64) *TelegramAdapter {
	chatID := int64(0)
	if len(allowedChatIDs) > 0 {
		chatID = allowedChatIDs[0]
	}
	b := bot.New(botToken, chatID)

	allowed := make(map[int64]bool)
	for _, id := range allowedChatIDs {
		allowed[id] = true
	}

	return &TelegramAdapter{
		bot:            b,
		allowedChatIDs: allowed,
		alertChatIDs:   alertChatIDs,
	}
}

func (t *TelegramAdapter) Name() string { return "telegram" }

func (t *TelegramAdapter) Start(ctx context.Context, inbox chan<- InboundMessage) error {
	go t.poll(ctx, inbox)
	return nil
}

func (t *TelegramAdapter) poll(ctx context.Context, inbox chan<- InboundMessage) {
	handler := &telegramInboxHandler{
		adapter: t,
		inbox:   inbox,
	}
	t.bot.Poll(ctx, handler)
}

func (t *TelegramAdapter) Send(chatID string, msg OutboundMessage) error {
	id, err := strconv.ParseInt(chatID, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid telegram chatID: %s", chatID)
	}

	text := msg.Text

	// Render options as inline keyboard
	if len(msg.Options) > 0 {
		var keyboard [][]bot.InlineKeyboardButton
		for i, opt := range msg.Options {
			keyboard = append(keyboard, []bot.InlineKeyboardButton{
				{Text: opt, CallbackData: fmt.Sprintf("sel:%d", i+1)},
			})
		}
		markup := &bot.InlineKeyboardMarkup{InlineKeyboard: keyboard}
		_, err = t.bot.SendMessageWithReply(id, text, markup)
		return err
	}

	_, err = t.bot.SendMessage(id, text)
	return err
}

func (t *TelegramAdapter) SendAlert(text string) error {
	var lastErr error
	for _, chatID := range t.alertChatIDs {
		if _, err := t.bot.SendMessage(chatID, text); err != nil {
			log.Printf("telegram alert error (chat %d): %v", chatID, err)
			lastErr = err
		}
	}
	return lastErr
}

func (t *TelegramAdapter) Stop() error { return nil }

// telegramInboxHandler converts Telegram updates to InboundMessages.
type telegramInboxHandler struct {
	adapter *TelegramAdapter
	inbox   chan<- InboundMessage
}

func (h *telegramInboxHandler) Handle(ctx context.Context, b *bot.Bot, u bot.Update) {
	if u.Message == nil {
		return
	}

	chatID := u.Message.Chat.ID
	if !h.adapter.allowedChatIDs[chatID] {
		log.Printf("telegram: unauthorized chat %d", chatID)
		return
	}

	msg := InboundMessage{
		ChatID:   strconv.FormatInt(chatID, 10),
		SenderID: strconv.FormatInt(int64(u.Message.From.ID), 10),
		Text:     u.Message.Text,
		Provider: "telegram",
	}

	if len(u.Message.Photo) > 0 {
		msg.HasPhoto = true
	}

	h.inbox <- msg
}

// Bot returns the underlying bot.Bot for Telegram-specific operations.
func (t *TelegramAdapter) Bot() *bot.Bot {
	return t.bot
}
```

- [ ] **Step 2: Commit**

```bash
git add bot/adapter/telegram.go
git commit -m "feat(bot): add Telegram adapter"
```

---

### Task 8: BlueBubbles Adapter

**Files:**
- Create: `bot/adapter/bluebubbles.go`
- Create: `bot/adapter/bluebubbles_test.go`

- [ ] **Step 1: Implement BlueBubbles adapter**

Create `bot/adapter/bluebubbles.go`:

```go
package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type BlueBubblesAdapter struct {
	serverURL      string
	password       string
	cfClientID     string
	cfClientSecret string
	webhookPort    int
	allowedNumbers map[string]bool
	alertChatGuids []string
	client         *http.Client
	server         *http.Server
}

func NewBlueBubbles(serverURL, password, cfClientID, cfClientSecret string, webhookPort int, allowedNumbers, alertChatGuids []string) *BlueBubblesAdapter {
	allowed := make(map[string]bool)
	for _, n := range allowedNumbers {
		allowed[n] = true
	}
	return &BlueBubblesAdapter{
		serverURL:      strings.TrimRight(serverURL, "/"),
		password:       password,
		cfClientID:     cfClientID,
		cfClientSecret: cfClientSecret,
		webhookPort:    webhookPort,
		allowedNumbers: allowed,
		alertChatGuids: alertChatGuids,
		client:         &http.Client{Timeout: 30 * time.Second},
	}
}

func (b *BlueBubblesAdapter) Name() string { return "imessage" }

func (b *BlueBubblesAdapter) Start(ctx context.Context, inbox chan<- InboundMessage) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/webhook", b.webhookHandler(inbox))

	b.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", b.webhookPort),
		Handler: mux,
	}

	go func() {
		log.Printf("bluebubbles: webhook listener on :%d", b.webhookPort)
		if err := b.server.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("bluebubbles webhook error: %v", err)
		}
	}()

	go func() {
		<-ctx.Done()
		b.server.Close()
	}()

	return nil
}

func (b *BlueBubblesAdapter) webhookHandler(inbox chan<- InboundMessage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		var payload struct {
			Type string `json:"type"`
			Data struct {
				ChatGUID string `json:"chats"` // simplified; real payload nests differently
				Text     string `json:"text"`
				Handle   struct {
					Address string `json:"address"`
				} `json:"handle"`
				IsFromMe bool `json:"isFromMe"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}

		w.WriteHeader(http.StatusOK)

		// Only process new messages, not our own
		if payload.Type != "new-message" || payload.Data.IsFromMe {
			return
		}

		sender := payload.Data.Handle.Address
		if !b.allowedNumbers[sender] {
			log.Printf("bluebubbles: unauthorized sender %s", sender)
			return
		}

		chatGuid := fmt.Sprintf("iMessage;-;%s", sender)

		inbox <- InboundMessage{
			ChatID:   chatGuid,
			SenderID: sender,
			Text:     payload.Data.Text,
			Provider: "imessage",
		}
	}
}

func (b *BlueBubblesAdapter) Send(chatID string, msg OutboundMessage) error {
	text := msg.Text

	// Render options as numbered list
	if len(msg.Options) > 0 {
		var lines []string
		for i, opt := range msg.Options {
			lines = append(lines, fmt.Sprintf("%d. %s", i+1, opt))
		}
		text += "\n\n" + strings.Join(lines, "\n") + "\n\nReply with a number to select."
	}

	return b.sendText(chatID, text)
}

func (b *BlueBubblesAdapter) SendAlert(text string) error {
	var lastErr error
	for _, guid := range b.alertChatGuids {
		if err := b.sendText(guid, text); err != nil {
			log.Printf("bluebubbles alert error (%s): %v", guid, err)
			lastErr = err
		}
	}
	return lastErr
}

func (b *BlueBubblesAdapter) sendText(chatGuid, text string) error {
	payload := map[string]interface{}{
		"chatGuid": chatGuid,
		"message":  text,
		"tempGuid": uuid.New().String(),
		"method":   "apple-script",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/api/v1/message/text?password=%s", b.serverURL, b.password)
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	// Cloudflare Access headers
	if b.cfClientID != "" {
		req.Header.Set("CF-Access-Client-Id", b.cfClientID)
		req.Header.Set("CF-Access-Client-Secret", b.cfClientSecret)
	}

	resp, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("bluebubbles send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("bluebubbles send: %d %s", resp.StatusCode, string(respBody))
	}

	return nil
}

func (b *BlueBubblesAdapter) Stop() error {
	if b.server != nil {
		return b.server.Close()
	}
	return nil
}
```

- [ ] **Step 2: Add uuid dependency**

```bash
cd bot && go get github.com/google/uuid
```

- [ ] **Step 3: Commit**

```bash
git add bot/adapter/bluebubbles.go bot/go.mod bot/go.sum
git commit -m "feat(bot): add BlueBubbles iMessage adapter"
```

---

## Phase 4: Go Bot — Command Porting

### Task 9: Port Fleet Commands

**Files:**
- Create: `bot/command/status.go`
- Create: `bot/command/restart.go`
- Create: `bot/command/logs.go`
- Create: `bot/command/health.go`
- Create: `bot/command/freeze.go`
- Create: `bot/command/help.go`

Port each handler from `bot/handler/fleet.go` into standalone Command implementations. Each command calls `exec.FleetJSON` or `exec.FleetMutate` and formats the response as an `OutboundMessage`.

- [ ] **Step 1: Port /status command**

Create `bot/command/status.go`:

```go
package command

import (
	"fmt"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

type StatusCmd struct{}

func (c *StatusCmd) Name() string        { return "status" }
func (c *StatusCmd) Aliases() []string   { return []string{"s"} }
func (c *StatusCmd) Help() string        { return "Show fleet service status" }

type statusResponse struct {
	Apps []struct {
		Name   string `json:"name"`
		Health string `json:"health"`
	} `json:"apps"`
}

func (c *StatusCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	resp, err := exec.FleetJSON[statusResponse]("status")
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error: %s", err)), nil
	}

	var lines []string
	healthy, degraded, down := 0, 0, 0
	for _, a := range resp.Apps {
		icon := statusIcon(a.Health)
		lines = append(lines, fmt.Sprintf("%s %s  %s", icon, a.Name, a.Health))
		switch a.Health {
		case "healthy":
			healthy++
		case "degraded":
			degraded++
		default:
			down++
		}
	}

	summary := fmt.Sprintf("\n%d healthy", healthy)
	if degraded > 0 {
		summary += fmt.Sprintf(", %d degraded", degraded)
	}
	if down > 0 {
		summary += fmt.Sprintf(", %d down", down)
	}

	text := "Fleet Status\n\n" + strings.Join(lines, "\n") + summary
	return adapter.TextResponse(text), nil
}

func statusIcon(health string) string {
	switch health {
	case "healthy":
		return "[OK]"
	case "degraded":
		return "[!!]"
	case "down":
		return "[XX]"
	case "frozen":
		return "[FR]"
	default:
		return "[??]"
	}
}
```

- [ ] **Step 2: Port /restart, /start, /stop commands**

Create `bot/command/restart.go`:

```go
package command

import (
	"fmt"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

type RestartCmd struct{}

func (c *RestartCmd) Name() string        { return "restart" }
func (c *RestartCmd) Aliases() []string   { return nil }
func (c *RestartCmd) Help() string        { return "Restart a service" }

func (c *RestartCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("restart")
	}
	app := args[0]
	_, err := exec.FleetMutate("restart", app)
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Failed to restart %s: %v", app, err)), nil
	}
	return adapter.TextResponse(fmt.Sprintf("[OK] Restarted %s", app)), nil
}

type StartAppCmd struct{}

func (c *StartAppCmd) Name() string        { return "start" }
func (c *StartAppCmd) Aliases() []string   { return nil }
func (c *StartAppCmd) Help() string        { return "Start a service" }

func (c *StartAppCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("start")
	}
	app := args[0]
	_, err := exec.FleetMutate("start", app)
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Failed to start %s: %v", app, err)), nil
	}
	return adapter.TextResponse(fmt.Sprintf("[OK] Started %s", app)), nil
}

type StopCmd struct{}

func (c *StopCmd) Name() string        { return "stop" }
func (c *StopCmd) Aliases() []string   { return nil }
func (c *StopCmd) Help() string        { return "Stop a service" }

func (c *StopCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("stop")
	}
	app := args[0]
	_, err := exec.FleetMutate("stop", app)
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Failed to stop %s: %v", app, err)), nil
	}
	return adapter.TextResponse(fmt.Sprintf("[OK] Stopped %s", app)), nil
}

// appSelectionPrompt lists all registered apps for selection.
func appSelectionPrompt(action string) (adapter.OutboundMessage, error) {
	type listItem struct {
		Name string `json:"name"`
	}
	type listResponse struct {
		Apps []listItem `json:"apps"`
	}
	resp, err := exec.FleetJSON[listResponse]("status")
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error listing apps: %v", err)), nil
	}
	var names []string
	for _, a := range resp.Apps {
		names = append(names, a.Name)
	}
	return adapter.OptionsResponse(fmt.Sprintf("Select app to %s:", action), names), nil
}
```

- [ ] **Step 3: Port /logs command**

Create `bot/command/logs.go`:

```go
package command

import (
	"fmt"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

type LogsCmd struct{}

func (c *LogsCmd) Name() string        { return "logs" }
func (c *LogsCmd) Aliases() []string   { return nil }
func (c *LogsCmd) Help() string        { return "Show recent container logs" }

func (c *LogsCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("logs")
	}
	app := args[0]
	lines := "50"
	if len(args) > 1 {
		lines = args[1]
	}
	res, err := exec.FleetMutate("logs", app, "--tail", lines)
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error: %v", err)), nil
	}
	output := res.Stdout
	if len(output) > 3800 {
		output = output[len(output)-3800:]
		output = output[strings.Index(output, "\n")+1:]
	}
	return adapter.TextResponse(fmt.Sprintf("Logs: %s (last %s)\n\n%s", app, lines, output)), nil
}
```

- [ ] **Step 4: Port /health command**

Create `bot/command/health.go`:

```go
package command

import (
	"fmt"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

type HealthCmd struct{}

func (c *HealthCmd) Name() string        { return "health" }
func (c *HealthCmd) Aliases() []string   { return []string{"h"} }
func (c *HealthCmd) Help() string        { return "Run health checks" }

type healthData struct {
	App     string `json:"app"`
	Overall string `json:"overall"`
}

func (c *HealthCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	cmdArgs := []string{"health", "--json"}
	if len(args) > 0 {
		cmdArgs = append(cmdArgs, args[0])
	}
	res, err := exec.FleetMutate(cmdArgs[0], cmdArgs[1:]...)
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error: %v", err)), nil
	}
	// For now, return raw output. Can be parsed and formatted later.
	output := res.Stdout
	if len(output) > 3800 {
		output = output[:3800] + "\n...(truncated)"
	}
	return adapter.TextResponse(fmt.Sprintf("Health Check\n\n%s", strings.TrimSpace(output))), nil
}
```

- [ ] **Step 5: Create /freeze and /unfreeze commands**

Create `bot/command/freeze.go`:

```go
package command

import (
	"fmt"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

type FreezeCmd struct{}

func (c *FreezeCmd) Name() string        { return "freeze" }
func (c *FreezeCmd) Aliases() []string   { return nil }
func (c *FreezeCmd) Help() string        { return "Freeze a crash-looping service" }

func (c *FreezeCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("freeze")
	}
	app := args[0]
	reason := "manual freeze via bot"
	if len(args) > 1 {
		reason = fmt.Sprintf("%s", args[1:])
	}
	_, err := exec.FleetMutate("freeze", app, reason)
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Failed to freeze %s: %v", app, err)), nil
	}
	return adapter.TextResponse(fmt.Sprintf("[FR] Frozen %s (%s)", app, reason)), nil
}

type UnfreezeCmd struct{}

func (c *UnfreezeCmd) Name() string        { return "unfreeze" }
func (c *UnfreezeCmd) Aliases() []string   { return nil }
func (c *UnfreezeCmd) Help() string        { return "Unfreeze and restart a frozen service" }

func (c *UnfreezeCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return appSelectionPrompt("unfreeze")
	}
	app := args[0]
	_, err := exec.FleetMutate("unfreeze", app)
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Failed to unfreeze %s: %v", app, err)), nil
	}
	return adapter.TextResponse(fmt.Sprintf("[OK] Unfrozen and started %s", app)), nil
}
```

- [ ] **Step 6: Create /help command**

Create `bot/command/help.go`:

```go
package command

import (
	"fleet-bot/adapter"
)

// HelpCmd is special — it gets the registry injected after construction.
type HelpCmd struct {
	Registry *Registry
}

func (c *HelpCmd) Name() string        { return "help" }
func (c *HelpCmd) Aliases() []string   { return nil }
func (c *HelpCmd) Help() string        { return "Show all available commands" }

func (c *HelpCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	return adapter.TextResponse(c.Registry.HelpText()), nil
}
```

- [ ] **Step 7: Commit**

```bash
git add bot/command/status.go bot/command/restart.go bot/command/logs.go bot/command/health.go bot/command/freeze.go bot/command/help.go
git commit -m "feat(bot): port fleet commands to command interface"
```

---

### Task 10: Port Remaining Commands

Port the remaining handlers. Each follows the same pattern — extract the logic from the old handler, call `exec.FleetMutate` or shell commands, return `OutboundMessage`.

**Files:**
- Create: `bot/command/shell.go` — wraps `exec.RunShell` from existing `handler/shell.go`
- Create: `bot/command/ping.go` — wraps ping logic from `handler/ping.go`
- Create: `bot/command/uptime.go` — wraps uptime from `handler/uptime.go`
- Create: `bot/command/ssl.go` — wraps SSL check from `handler/ssl.go`
- Create: `bot/command/waf.go` — wraps WAF from `handler/waf.go`
- Create: `bot/command/alerts.go` — wraps alert control from `handler/alerts_cmd.go`
- Create: `bot/command/cleanup.go` — wraps cleanup from `handler/cleanup.go`
- Create: `bot/command/digest.go` — wraps digest from `handler/digest.go`
- Create: `bot/command/claude.go` — wraps Claude Code from `handler/claude.go`
- Create: `bot/command/secrets.go` — wraps secrets from `handler/fleet_secrets.go`
- Create: `bot/command/git.go` — wraps git from `handler/fleet_git.go`
- Create: `bot/command/nginx.go` — wraps nginx from `handler/fleet_nginx.go`
- Create: `bot/command/system.go` — wraps sys/docker/services from `handler/system.go`

For each command file, follow the pattern established in Task 9:
1. Read the existing handler in `bot/handler/`
2. Extract the business logic (the fleet/exec calls and response formatting)
3. Wrap it in a `Command` struct with `Execute()` returning `OutboundMessage`
4. Replace Telegram-specific formatting (`bot.Bold()`, `bot.Code()`) with plain text
5. Replace inline keyboards with `Options` slices

- [ ] **Step 1: Port all remaining commands one by one**

Each file follows the identical pattern. Read the corresponding handler, extract its logic, wrap in Command interface. The agent executing this task should read each handler file and port it.

- [ ] **Step 2: Run build to verify compilation**

```bash
cd bot && go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add bot/command/
git commit -m "feat(bot): port all remaining commands to adapter-agnostic interface"
```

---

## Phase 5: Go Bot — Alert Monitor + Main

### Task 11: Alert Monitor with Auto-Freeze

**Files:**
- Create: `bot/monitor/alerts.go` (replaces logic from `bot/handler/alerts.go`)

- [ ] **Step 1: Create adapter-agnostic alert monitor**

Create `bot/monitor/alerts.go`:

```go
package monitor

import (
	"fmt"
	"log"
	"sync"
	"time"

	"fleet-bot/exec"
	"fleet-bot/router"
)

type AlertMonitor struct {
	mu                     sync.Mutex
	router                 *router.Router
	enabled                bool
	autoRestart            bool
	maxConsecutiveFailures int
	pollInterval           time.Duration
	stop                   chan struct{}
	lastState              map[string]string
	consecutiveDown        map[string]int
	lastRestart            map[string]time.Time
}

type statusResponse struct {
	Apps []struct {
		Name   string `json:"name"`
		Health string `json:"health"`
	} `json:"apps"`
}

func NewAlertMonitor(r *router.Router, maxFailures int, pollInterval time.Duration) *AlertMonitor {
	if maxFailures <= 0 {
		maxFailures = 5
	}
	if pollInterval <= 0 {
		pollInterval = 2 * time.Minute
	}
	return &AlertMonitor{
		router:                 r,
		enabled:                true,
		maxConsecutiveFailures: maxFailures,
		pollInterval:           pollInterval,
		lastState:              make(map[string]string),
		consecutiveDown:        make(map[string]int),
		lastRestart:            make(map[string]time.Time),
	}
}

func (m *AlertMonitor) Start() {
	m.mu.Lock()
	if m.stop != nil {
		m.mu.Unlock()
		return
	}
	m.stop = make(chan struct{})
	m.mu.Unlock()
	go m.loop()
	log.Println("alert monitor started")
}

func (m *AlertMonitor) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stop != nil {
		close(m.stop)
		m.stop = nil
	}
}

func (m *AlertMonitor) SetEnabled(e bool)     { m.mu.Lock(); m.enabled = e; m.mu.Unlock() }
func (m *AlertMonitor) IsEnabled() bool       { m.mu.Lock(); defer m.mu.Unlock(); return m.enabled }
func (m *AlertMonitor) SetAutoRestart(e bool) { m.mu.Lock(); m.autoRestart = e; m.mu.Unlock() }
func (m *AlertMonitor) AutoRestart() bool     { m.mu.Lock(); defer m.mu.Unlock(); return m.autoRestart }

func (m *AlertMonitor) loop() {
	m.poll(true) // seed state
	ticker := time.NewTicker(m.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			if m.IsEnabled() {
				m.poll(false)
			}
		}
	}
}

func (m *AlertMonitor) poll(silent bool) {
	resp, err := exec.FleetJSON[statusResponse]("status")
	if err != nil {
		log.Printf("alert poll error: %v", err)
		return
	}

	for _, app := range resp.Apps {
		prev, known := m.lastState[app.Name]
		m.lastState[app.Name] = app.Health

		// Track consecutive down counts
		if app.Health == "down" {
			m.consecutiveDown[app.Name]++
		} else {
			m.consecutiveDown[app.Name] = 0
		}

		// Auto-freeze after max consecutive failures
		count := m.consecutiveDown[app.Name]
		if count >= m.maxConsecutiveFailures {
			m.freezeService(app.Name, count)
			m.consecutiveDown[app.Name] = 0 // reset after freeze
			continue
		}

		if silent || !known || prev == app.Health {
			continue
		}

		// State changed — send alert
		var text string
		if app.Health == "down" {
			text = fmt.Sprintf("[XX] %s went down!", app.Name)
		} else if app.Health == "healthy" && prev == "down" {
			text = fmt.Sprintf("[OK] %s is back up.", app.Name)
		} else {
			text = fmt.Sprintf("[!!] %s: %s -> %s", app.Name, prev, app.Health)
		}

		log.Printf("alert: %s", text)
		m.router.SendAlert(text)

		// Auto-restart if enabled
		if m.autoRestart && app.Health == "down" {
			m.tryAutoRestart(app.Name)
		}
	}
}

func (m *AlertMonitor) freezeService(app string, count int) {
	log.Printf("auto-freeze: %s after %d consecutive down polls", app, count)

	_, err := exec.FleetMutate("freeze", app, fmt.Sprintf("auto-frozen after %d consecutive failures", count))
	if err != nil {
		log.Printf("auto-freeze failed for %s: %v", app, err)
		m.router.SendAlert(fmt.Sprintf("[!!] Failed to auto-freeze %s: %v", app, err))
		return
	}

	minutes := count * int(m.pollInterval.Minutes())
	text := fmt.Sprintf("[FR] SERVICE FROZEN: %s has been down for %d consecutive checks (%d minutes). Run /unfreeze %s to re-enable.",
		app, count, minutes, app)
	m.router.SendAlert(text)
}

func (m *AlertMonitor) tryAutoRestart(app string) {
	m.mu.Lock()
	last, ok := m.lastRestart[app]
	if ok && time.Since(last) < 10*time.Minute {
		m.mu.Unlock()
		return
	}
	m.lastRestart[app] = time.Now()
	m.mu.Unlock()

	m.router.SendAlert(fmt.Sprintf("Auto-restarting %s...", app))
	_, err := exec.FleetMutate("restart", app)
	if err != nil {
		m.router.SendAlert(fmt.Sprintf("Auto-restart failed for %s: %v", app, err))
		return
	}
	m.router.SendAlert(fmt.Sprintf("[OK] %s auto-restarted.", app))
}
```

- [ ] **Step 2: Commit**

```bash
git add bot/monitor/alerts.go
git commit -m "feat(bot): adapter-agnostic alert monitor with auto-freeze"
```

---

### Task 12: Restructure main.go

**Files:**
- Modify: `bot/main.go`

- [ ] **Step 1: Rewrite main.go to use new architecture**

Replace `bot/main.go`:

```go
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/command"
	"fleet-bot/config"
	"fleet-bot/monitor"
	"fleet-bot/router"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)
	log.Println("fleet-bot starting...")

	cfg, err := config.Load(config.DefaultConfigPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// Build command registry
	reg := command.NewRegistry()
	helpCmd := &command.HelpCmd{}

	reg.Register(&command.StatusCmd{})
	reg.Register(&command.RestartCmd{})
	reg.Register(&command.StartAppCmd{})
	reg.Register(&command.StopCmd{})
	reg.Register(&command.LogsCmd{})
	reg.Register(&command.HealthCmd{})
	reg.Register(&command.FreezeCmd{})
	reg.Register(&command.UnfreezeCmd{})
	reg.Register(&command.ShellCmd{})
	reg.Register(&command.PingCmd{})
	reg.Register(&command.UptimeCmd{})
	reg.Register(&command.SslCmd{})
	reg.Register(&command.WafCmd{})
	reg.Register(&command.AlertsCmd{})
	reg.Register(&command.CleanupCmd{})
	reg.Register(&command.DigestCmd{})
	reg.Register(&command.ClaudeCmd{})
	reg.Register(&command.SecretsCmd{})
	reg.Register(&command.GitCmd{})
	reg.Register(&command.NginxCmd{})
	reg.Register(&command.SystemCmd{})
	reg.Register(helpCmd)
	helpCmd.Registry = reg // inject after registration so /help sees all commands

	// Build router
	r := router.New(reg)

	// Add adapters
	if tc := cfg.Adapters.Telegram; tc != nil && tc.Enabled {
		tg := adapter.NewTelegram(tc.BotToken, tc.AllowedChatIDs, tc.AlertChatIDs)
		r.AddAdapter(tg)
		log.Println("telegram adapter enabled")
	}

	if ic := cfg.Adapters.IMessage; ic != nil && ic.Enabled {
		bb := adapter.NewBlueBubbles(
			ic.ServerURL, ic.Password,
			ic.CfAccessClientID, ic.CfAccessClientSecret,
			ic.WebhookPort, ic.AllowedNumbers, ic.AlertChatGuids,
		)
		r.AddAdapter(bb)
		log.Println("bluebubbles adapter enabled")
	}

	// Parse poll interval
	pollInterval := 2 * time.Minute
	if d, err := time.ParseDuration(cfg.Alerts.PollInterval); err == nil {
		pollInterval = d
	}

	// Start alert monitor
	alerts := monitor.NewAlertMonitor(r, cfg.Alerts.MaxConsecutiveFailures, pollInterval)
	alerts.Start()

	// Handle shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("shutting down...")
		alerts.Stop()
		cancel()
	}()

	log.Println("fleet-bot ready")
	if err := r.Run(ctx); err != nil {
		log.Fatalf("router error: %v", err)
	}
}
```

- [ ] **Step 2: Build and verify**

```bash
cd bot && go build -o fleet-bot .
```

- [ ] **Step 3: Commit**

```bash
git add bot/main.go
git commit -m "feat(bot): restructure main.go for adapter/command/router architecture"
```

---

## Phase 6: TypeScript Notify Layer

### Task 13: Replace telegram.ts with notify.ts

**Files:**
- Create: `src/core/notify.ts`
- Create: `src/core/notify.test.ts`
- Modify: `src/commands/watchdog.ts` — use notify instead of telegram
- Keep: `src/core/telegram.ts` — don't delete, the TelegramAdapter in notify.ts imports from it

- [ ] **Step 1: Write tests**

Create `src/core/notify.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => JSON.stringify({
    adapters: [
      { type: 'bluebubbles', serverUrl: 'https://test.local', password: 'pw', chatGuid: 'iMessage;-;+44', cfAccessClientId: '', cfAccessClientSecret: '' }
    ]
  })),
}));

import { loadNotifyConfig } from './notify.js';

describe('loadNotifyConfig', () => {
  it('loads adapters from config file', () => {
    const cfg = loadNotifyConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.adapters).toHaveLength(1);
    expect(cfg!.adapters[0].type).toBe('bluebubbles');
  });
});
```

- [ ] **Step 2: Implement notify.ts**

Create `src/core/notify.ts`:

```typescript
import { readFileSync, existsSync } from 'node:fs';

const NOTIFY_CONFIG_PATH = '/etc/fleet/notify.json';

export interface NotifyAdapterConfig {
  type: 'bluebubbles' | 'telegram';
  // BlueBubbles
  serverUrl?: string;
  password?: string;
  chatGuid?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  // Telegram
  botToken?: string;
  chatId?: string;
}

export interface NotifyConfig {
  adapters: NotifyAdapterConfig[];
}

export function loadNotifyConfig(): NotifyConfig | null {
  if (!existsSync(NOTIFY_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(NOTIFY_CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export async function sendNotification(config: NotifyConfig, message: string): Promise<boolean> {
  let anySuccess = false;
  for (const adapter of config.adapters) {
    try {
      const ok = adapter.type === 'bluebubbles'
        ? await sendBlueBubbles(adapter, message)
        : await sendTelegram(adapter, message);
      if (ok) anySuccess = true;
    } catch (err) {
      console.error(`notify (${adapter.type}): ${err}`);
    }
  }
  return anySuccess;
}

async function sendBlueBubbles(cfg: NotifyAdapterConfig, message: string): Promise<boolean> {
  const url = `${cfg.serverUrl}/api/v1/message/text?password=${cfg.password}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.cfAccessClientId) {
    headers['CF-Access-Client-Id'] = cfg.cfAccessClientId;
    headers['CF-Access-Client-Secret'] = cfg.cfAccessClientSecret!;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      chatGuid: cfg.chatGuid,
      message,
      tempGuid: `fleet-${Date.now()}`,
      method: 'apple-script',
    }),
  });
  return res.ok;
}

async function sendTelegram(cfg: NotifyAdapterConfig, message: string): Promise<boolean> {
  const res = await fetch(
    `https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    }
  );
  return res.ok;
}
```

- [ ] **Step 3: Update watchdog to use notify**

In `src/commands/watchdog.ts`, replace the telegram import and usage:

Change imports from:
```typescript
import { loadTelegramConfig, sendTelegram } from '../core/telegram.js';
```
To:
```typescript
import { loadNotifyConfig, sendNotification } from '../core/notify.js';
```

Replace the alert sending section (lines ~59-79) with:

```typescript
const config = loadNotifyConfig();
if (!config) {
  warn('No notify config at /etc/fleet/notify.json — alert not sent');
  process.exit(1);
}

const message = [
  'fleet watchdog alert',
  `host: ${hostname}`,
  `failures: ${failures.length}`,
  '',
  ...failures.map(f => `- ${f}`),
].join('\n');

const sent = await sendNotification(config, message);
if (sent) {
  success('Alert sent');
} else {
  error('Failed to send alert');
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/core/notify.test.ts
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/core/notify.ts src/core/notify.test.ts src/commands/watchdog.ts
git commit -m "feat(notify): pluggable notification layer replacing telegram-only watchdog"
```

---

## Phase 7: Configuration + Deploy

### Task 14: Create Config Files + Deploy

- [ ] **Step 1: Create /etc/fleet/bot.json**

```bash
cat > /etc/fleet/bot.json << 'EOF'
{
  "adapters": {
    "imessage": {
      "enabled": true,
      "serverUrl": "https://imessage.hesketh.pro",
      "port": 1234,
      "password": "<loaded from vault>",
      "cfAccessClientId": "<loaded from vault>",
      "cfAccessClientSecret": "<loaded from vault>",
      "webhookPort": 8090,
      "allowedNumbers": ["+447388650820"],
      "alertChatGuids": ["iMessage;-;+447388650820"]
    },
    "telegram": {
      "enabled": true,
      "botToken": "<loaded from vault>",
      "allowedChatIds": [],
      "alertChatIds": []
    }
  },
  "alerts": {
    "providers": ["imessage", "telegram"],
    "maxConsecutiveFailures": 5,
    "pollInterval": "2m"
  }
}
EOF
```

Fill in actual values from the fleet vault (`fleet secrets list fleet-bot`).

- [ ] **Step 2: Create /etc/fleet/notify.json**

```bash
cat > /etc/fleet/notify.json << 'EOF'
{
  "adapters": [
    {
      "type": "bluebubbles",
      "serverUrl": "https://imessage.hesketh.pro",
      "password": "<from vault>",
      "chatGuid": "iMessage;-;+447388650820",
      "cfAccessClientId": "<from vault>",
      "cfAccessClientSecret": "<from vault>"
    }
  ]
}
EOF
```

- [ ] **Step 3: Build and deploy fleet TypeScript**

```bash
cd /home/matt/fleet && npm run build && npm test
```

- [ ] **Step 4: Build and deploy fleet-bot Go**

```bash
cd /home/matt/fleet/bot && go build -o /usr/local/bin/fleet-bot . && systemctl restart fleet-bot
```

- [ ] **Step 5: Test iMessage end-to-end**

Send `/status` via iMessage to the BlueBubbles server. Verify you get a response with fleet status.

- [ ] **Step 6: Test alert flow**

Manually stop a service, wait for the alert monitor to detect it, verify alert arrives via iMessage.

- [ ] **Step 7: Test auto-freeze**

Leave a broken service down for 5 consecutive polls (~10 minutes). Verify it gets auto-frozen and you receive the freeze alert via iMessage.

- [ ] **Step 8: Commit all config**

```bash
git add -A
git commit -m "feat: deploy restart loop prevention + iMessage adapter system"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | 1-2 | Systemd restart limits + freeze/unfreeze CLI |
| 2 | 3-6 | Adapter interface, command interface, router, config |
| 3 | 7-8 | Telegram + BlueBubbles adapters |
| 4 | 9-10 | All 20+ commands ported |
| 5 | 11-12 | Alert monitor with auto-freeze + new main.go |
| 6 | 13 | TypeScript notify layer |
| 7 | 14 | Config files + deploy + e2e testing |
