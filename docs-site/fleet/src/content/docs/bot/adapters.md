---
title: Messaging Adapters
description: Built-in Telegram and iMessage adapters
---

import { Aside } from '@astrojs/starlight/components';

fleet-bot communicates through messaging adapters. Each adapter implements the same interface, so commands work identically regardless of which messaging platform you use.

## Available adapters

### Telegram

The default adapter. Uses the Telegram Bot API with long polling.

**Config** (`/etc/fleet/bot.json`):
```json
{
  "adapters": {
    "telegram": {
      "token": "123456:ABC-DEF...",
      "allowedChatIds": [221714512],
      "alertChatIds": [221714512]
    }
  }
}
```

- `token` — Bot token from [@BotFather](https://t.me/BotFather)
- `allowedChatIds` — Chat IDs authorised to use the bot
- `alertChatIds` — Where to send automated alerts

The adapter polls for updates and routes messages to the command handler. Outbound messages support text, photos, documents, and inline keyboard buttons.

### BlueBubbles (iMessage)

Connects to a [BlueBubbles](https://bluebubbles.app/) server running on macOS to send and receive iMessages.

**Config**:
```json
{
  "adapters": {
    "bluebubbles": {
      "url": "https://bb.example.com",
      "password": "your-api-password",
      "allowedNumbers": ["+447..."],
      "cfAccessClientId": "...",
      "cfAccessClientSecret": "..."
    }
  }
}
```

- `url` — BlueBubbles server URL
- `password` — API password configured in BlueBubbles
- `allowedNumbers` — Phone numbers authorised to use the bot
- `cfAccessClientId` / `cfAccessClientSecret` — Optional Cloudflare Access credentials if the server is behind a Cloudflare tunnel

The adapter registers a webhook with the BlueBubbles server and listens for incoming messages. Outbound messages are sent via the BlueBubbles REST API.

<Aside>
BlueBubbles requires a Mac running the BlueBubbles server app. iMessage must be signed in on that Mac.
</Aside>

## Running multiple adapters

You can enable both adapters simultaneously. Configure both in `bot.json` and the bot will start both, routing messages from either platform to the same command handler.

## The Adapter interface

Both adapters implement this Go interface:

```go
type Adapter interface {
    Name() string
    Start(ctx context.Context, inbox chan<- InboundMessage) error
    Send(chatID string, msg OutboundMessage) error
    SendAlert(text string) error
    Stop() error
}
```

See [Custom Adapter](/bot/custom-adapter/) for how to implement your own.
