# Fleet: Restart Loop Prevention + iMessage Notifications

**Date:** 2026-04-12
**Status:** Approved

## Overview

Two features that work together: (1) prevent services from endlessly crash-looping by freezing them after configurable retries, and (2) replace Telegram with a pluggable notification system that supports iMessage via BlueBubbles, keeping Telegram as a fallback.

---

## Feature 1: Restart Loop Prevention

### Problem

Services with missing secrets or broken configs can restart indefinitely (winzila-affiliate hit 4,451 restarts). There's no mechanism to freeze a service and alert the operator.

### Solution

Three layers working together:

#### 1.1 Systemd Layer

All fleet-managed services get restart limits added to their `[Service]` section:

```ini
StartLimitBurst=5
StartLimitIntervalSec=300
```

This makes systemd stop restarting after 5 failures within 5 minutes.

**Migration:** One-time script patches all existing service files in `/etc/systemd/system/` that match fleet-registered apps, then runs `systemctl daemon-reload`.

**Going forward:** Fleet's `register` command includes these directives in all generated service files.

#### 1.2 Fleet CLI (TypeScript)

**Registry changes** — add to `AppEntry` in `src/core/registry.ts`:

```typescript
frozenAt?: string;    // ISO timestamp when frozen
frozenReason?: string; // why it was frozen
```

**New commands:**

- `fleet freeze <app>` — stops service, disables it via systemctl, writes `frozenAt` + `frozenReason` to registry
- `fleet unfreeze <app>` — clears frozen state from registry, re-enables service, starts it

**Status display** — `fleet status` and the TUI dashboard show frozen apps distinctly (not just "down").

**New files:**
- `src/commands/freeze.ts` — freeze/unfreeze command handler

**Modified files:**
- `src/core/registry.ts` — add `frozenAt`, `frozenReason` to `AppEntry`
- `src/commands/status.ts` — render frozen state
- `src/cli.ts` — register freeze/unfreeze commands
- `src/tui/views/Dashboard.tsx` — frozen badge
- `src/mcp/server.ts` — add `fleet_freeze` and `fleet_unfreeze` MCP tools

#### 1.3 Fleet-bot (Go)

**Alert monitor changes** in `bot/handler/alerts.go`:

- Add `consecutiveDown map[string]int` field to `AlertMonitor`
- Each poll: if app health is "down", increment counter; if healthy, reset to 0
- When counter reaches `maxConsecutiveFailures` (default 5, from config), call `fleet freeze <app>` and send urgent alert to all adapters
- Alert message: "SERVICE FROZEN: {app} has been down for {N} consecutive checks ({N*2} minutes). Run /unfreeze {app} to re-enable."

**New bot commands:**
- `/freeze <app>` — manually freeze a service
- `/unfreeze <app>` — unfreeze and restart

---

## Feature 2: Pluggable Notification Adapter System

### Problem

Notifications are hardcoded to Telegram. Need to support iMessage via BlueBubbles and allow future providers without changing command logic.

### Solution

Provider-agnostic command system with pluggable adapters.

#### 2.1 Core Interfaces (Go)

```go
// Normalized inbound message from any provider
type InboundMessage struct {
    ChatID    string
    SenderID  string
    Text      string
    HasPhoto  bool
    PhotoData []byte
    Provider  string // "imessage", "telegram", etc.
}

// Provider-agnostic response
type OutboundMessage struct {
    Text     string
    Photo    []byte
    Document []byte
    Caption  string
    Options  []string // rendered per-provider
}

// What every adapter must implement
type Adapter interface {
    Name() string
    Start(ctx context.Context, inbox chan<- InboundMessage) error
    Send(chatID string, msg OutboundMessage) error
    Stop() error
}

// What every command must implement
type Command interface {
    Name() string
    Aliases() []string
    Help() string
    Execute(msg InboundMessage, args []string) (OutboundMessage, error)
}
```

#### 2.2 Router

Central dispatcher in `bot/router/router.go`:

- Reads `InboundMessage` from shared inbox channel
- Matches `/command` prefix, extracts args
- Dispatches to registered `Command`
- Sends `OutboundMessage` back through the originating adapter
- Tracks per-chat pending selection state for interactive flows (when a command returns `Options` and user replies with a number)

#### 2.3 BlueBubbles Adapter

New file: `bot/adapter/bluebubbles.go`

**Inbound:**
- Runs HTTP server listening for BlueBubbles webhooks (`new-message` events)
- Normalizes webhook payload to `InboundMessage`
- Auth: whitelist of allowed phone numbers

**Outbound:**
- `Send()` calls `POST /api/v1/message/text` with `chatGuid`, `message`, `tempGuid`
- Includes `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers for Cloudflare Access
- Photo/document sending via `POST /api/v1/message/attachment`
- Renders `Options` as numbered text list:
  ```
  1. saas-plumber
  2. hostclaw
  3. trustedpets
  Reply with a number to select.
  ```

#### 2.4 Telegram Adapter

New file: `bot/adapter/telegram.go`

Wraps existing `tgbotapi` implementation:

**Inbound:** Existing long-poll, normalizes to `InboundMessage`
**Outbound:** Existing bot API. Renders `Options` as inline keyboard buttons.

#### 2.5 Command Porting

All existing handlers become standalone `Command` implementations. Every command is prefixed with `/`.

Full parity port — all existing handlers:

| Command | Source handler | Description |
|---------|---------------|-------------|
| `/status` | `handler/fleet.go` | Fleet service status dashboard |
| `/restart <app>` | `handler/fleet.go` | Restart a service |
| `/start <app>` | `handler/fleet.go` | Start a service |
| `/stop <app>` | `handler/fleet.go` | Stop a service |
| `/logs <app>` | `handler/fleet.go` | Show recent logs |
| `/health [app]` | `handler/fleet.go` | Health check |
| `/freeze <app>` | NEW | Freeze a crash-looping service |
| `/unfreeze <app>` | NEW | Unfreeze and restart |
| `/shell <cmd>` | `handler/shell.go` | Execute shell command |
| `/claude` | `handler/claude.go` | Claude Code session management |
| `/waf` | `handler/waf.go` | WAF log viewer |
| `/ssl` | `handler/ssl.go` | SSL certificate status |
| `/alerts` | `handler/alerts_cmd.go` | Alert monitor control |
| `/ping` | `handler/ping.go` | Latency check |
| `/uptime` | `handler/uptime.go` | System uptime |
| `/digest` | `handler/digest.go` | Daily digest |
| `/cleanup` | `handler/cleanup.go` | Docker cleanup |
| `/secrets` | `handler/fleet_secrets.go` | Secrets management |
| `/git` | `handler/fleet_git.go` | Git operations |
| `/nginx` | `handler/fleet_nginx.go` | Nginx management |
| `/help` | NEW | List all commands with descriptions |

**Interactive flows:** Where Telegram used inline keyboards (e.g. "pick an app"), both adapters use `Options`. Telegram renders as keyboard, iMessage renders as numbered list. Follow-up selections (user replies "2") are handled by the router's pending selection state.

#### 2.6 Alert Monitor

`bot/handler/alerts.go` becomes adapter-agnostic:

- Sends alerts to all configured adapters simultaneously
- Each adapter has its own alert destinations (chat IDs / chat GUIDs)
- If one adapter fails to send, logs warning but doesn't block others

#### 2.7 Configuration

`/etc/fleet/bot.json`:

```json
{
  "adapters": {
    "imessage": {
      "enabled": true,
      "serverUrl": "https://imessage.hesketh.pro",
      "port": 1234,
      "password": "<from vault>",
      "cfAccessClientId": "<from vault>",
      "cfAccessClientSecret": "<from vault>",
      "webhookPort": 8090,
      "allowedNumbers": ["+447388650820"],
      "alertChatGuids": ["iMessage;-;+447388650820"]
    },
    "telegram": {
      "enabled": true,
      "botToken": "<from vault>",
      "allowedChatIds": [123456],
      "alertChatIds": [123456]
    }
  },
  "alerts": {
    "providers": ["imessage", "telegram"],
    "maxConsecutiveFailures": 5,
    "pollInterval": "2m"
  }
}
```

Sensitive values (passwords, tokens) loaded from fleet vault at startup.

#### 2.8 Fleet TypeScript Notification Layer

`src/core/telegram.ts` -> `src/core/notify.ts`:

```typescript
interface NotifyAdapter {
  name: string;
  send(message: string): Promise<boolean>;
}
```

Two implementations:
- `BlueBubblesAdapter` — REST API with CF Access headers
- `TelegramAdapter` — existing Telegram bot API

Config from `/etc/fleet/notify.json`. Watchdog loads all configured adapters, sends to each. If one fails, logs warning, continues to next.

---

## Go Package Structure

```
bot/
  main.go              # startup, config loading, adapter init
  adapter/
    adapter.go         # Adapter interface + types
    bluebubbles.go     # BlueBubbles/iMessage adapter
    telegram.go        # Telegram adapter
  command/
    command.go         # Command interface
    registry.go        # command registration + lookup
    status.go          # /status
    restart.go         # /restart, /start, /stop
    logs.go            # /logs
    health.go          # /health
    freeze.go          # /freeze, /unfreeze
    shell.go           # /shell
    claude.go          # /claude
    waf.go             # /waf
    ssl.go             # /ssl
    alerts.go          # /alerts
    ping.go            # /ping
    uptime.go          # /uptime
    digest.go          # /digest
    cleanup.go         # /cleanup
    secrets.go         # /secrets
    git.go             # /git
    nginx.go           # /nginx
    help.go            # /help
  router/
    router.go          # message dispatch + pending selection state
  monitor/
    alerts.go          # health polling + auto-freeze logic
    docker.go          # container stats (existing)
    system.go          # system metrics (existing)
  config/
    config.go          # bot.json loading
  exec/
    cmd.go             # shell execution (existing)
    fleet.go           # fleet CLI wrapper (existing)
```

---

## Security

- BlueBubbles API protected by Cloudflare WAF (IP whitelist) + Cloudflare Access (service token)
- iMessage adapter only processes messages from whitelisted phone numbers
- Telegram adapter only processes messages from whitelisted chat IDs
- `/shell` command restricted to authenticated users only (both adapters)
- All credentials stored in fleet vault, loaded at runtime

---

## Testing

- Unit tests for router dispatch, command parsing, selection state
- Unit tests for each command's `Execute()` with mock adapters
- Integration test: send test message via BlueBubbles API, verify response
- Freeze/unfreeze: test registry state transitions, systemd interactions (mocked)

---

## Migration Path

1. Patch existing systemd services with restart limits
2. Add freeze/unfreeze to fleet CLI + MCP
3. Restructure Go bot into adapter/command/router packages
4. Port all existing handlers to Command interface
5. Implement BlueBubbles adapter
6. Update fleet TypeScript notify layer
7. Test both channels end-to-end
8. Deploy
