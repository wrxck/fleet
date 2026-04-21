---
title: Custom Adapter
description: How to build a custom messaging adapter for fleet-bot
---

import { Aside } from '@astrojs/starlight/components';

fleet-bot's messaging layer is adapter-based. You can add support for any messaging platform by implementing the `Adapter` interface.

## The Adapter interface

```go
package adapter

type Adapter interface {
    Name() string
    Start(ctx context.Context, inbox chan<- InboundMessage) error
    Send(chatID string, msg OutboundMessage) error
    SendAlert(text string) error
    Stop() error
}
```

### Methods

| Method | Description |
|--------|-------------|
| `Name()` | Return a unique identifier (e.g., `"slack"`, `"discord"`) |
| `Start(ctx, inbox)` | Begin receiving messages. Send received messages to the `inbox` channel. Block until `ctx` is cancelled. |
| `Send(chatID, msg)` | Deliver a message to the given chat. Handle text, photos, documents, and option buttons. |
| `SendAlert(text)` | Send an alert to the configured alert destination. |
| `Stop()` | Gracefully shut down (close connections, cancel polling). |

## Message types

### InboundMessage

Received from the messaging platform:

```go
type InboundMessage struct {
    ChatID    string   // unique chat/conversation identifier
    SenderID  string   // who sent it
    Text      string   // message text
    HasPhoto  bool     // whether a photo is attached
    PhotoData []byte   // photo bytes (if any)
    Provider  string   // adapter name (for routing responses)
}
```

### OutboundMessage

Sent to the messaging platform:

```go
type OutboundMessage struct {
    Text     string   // message text (Markdown supported)
    Photo    []byte   // optional photo attachment
    Document []byte   // optional document attachment
    Caption  string   // caption for photo/document
    Options  []string // reply option buttons
}
```

### Helpers

```go
// Simple text response
msg := TextResponse("Hello!")

// Response with option buttons
msg := OptionsResponse("Choose:", []string{"Option A", "Option B"})
```

## Implementation walkthrough

Here's a minimal adapter for a hypothetical webhook-based service:

```go
package adapter

import (
    "context"
    "net/http"
)

type WebhookAdapter struct {
    url     string
    secret  string
    server  *http.Server
    alertTo string
}

func (a *WebhookAdapter) Name() string { return "webhook" }

func (a *WebhookAdapter) Start(ctx context.Context, inbox chan<- InboundMessage) error {
    mux := http.NewServeMux()
    mux.HandleFunc("/incoming", func(w http.ResponseWriter, r *http.Request) {
        // Parse the incoming webhook payload
        // Validate authentication
        inbox <- InboundMessage{
            ChatID:   parseChatID(r),
            SenderID: parseSenderID(r),
            Text:     parseText(r),
            Provider: a.Name(),
        }
        w.WriteHeader(http.StatusOK)
    })

    a.server = &http.Server{Addr: ":8080", Handler: mux}
    go a.server.ListenAndServe()
    <-ctx.Done()
    return a.server.Shutdown(context.Background())
}

func (a *WebhookAdapter) Send(chatID string, msg OutboundMessage) error {
    // POST to your service's API
    return nil
}

func (a *WebhookAdapter) SendAlert(text string) error {
    return a.Send(a.alertTo, TextResponse(text))
}

func (a *WebhookAdapter) Stop() error {
    if a.server != nil {
        return a.server.Shutdown(context.Background())
    }
    return nil
}
```

## Registering your adapter

Add your adapter to the bot's startup in `bot/main.go`:

```go
if cfg.Adapters.Webhook != nil {
    adapters = append(adapters, &adapter.WebhookAdapter{
        url:     cfg.Adapters.Webhook.URL,
        alertTo: cfg.Adapters.Webhook.AlertTo,
    })
}
```

<Aside>
The bot starts all configured adapters concurrently. Each adapter runs in its own goroutine and sends messages to a shared inbox channel.
</Aside>
