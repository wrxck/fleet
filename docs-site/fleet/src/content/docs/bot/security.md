---
title: Bot Security
description: Authentication, authorisation, and security model
---

import { Aside } from '@astrojs/starlight/components';

fleet-bot has access to powerful commands (shell execution, deployments, secret management). The security model ensures only authorised users can interact with it.

## Authentication

### Telegram

Messages are authenticated by **chat ID**. The `allowedChatIds` array in `bot.json` lists the Telegram chat IDs that are allowed to use the bot.

```json
{
  "adapters": {
    "telegram": {
      "allowedChatIds": [221714512]
    }
  }
}
```

The bot checks every incoming message against this list. Unauthorised messages are silently dropped with a log entry — no response is sent.

Additionally, the Go code has a hardcoded `AuthorizedChatID` in `bot/bot/auth.go` that provides a second layer of authorisation.

### BlueBubbles (iMessage)

Messages are authenticated by **phone number**. The `allowedNumbers` array lists permitted phone numbers.

```json
{
  "adapters": {
    "bluebubbles": {
      "allowedNumbers": ["+447123456789"]
    }
  }
}
```

If the BlueBubbles server is behind Cloudflare Access, the adapter includes `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers on every request, adding network-level authentication.

## Destructive command protection

Commands that modify state (stop, restart, deploy, WAF changes, shell) require **inline keyboard confirmation**. The bot sends a message with Confirm/Cancel buttons. This prevents accidental execution.

The confirmation is tied to the requesting user — other users cannot confirm someone else's destructive command.

## Shell access

The `/sh` command executes arbitrary shell commands on the host. It is:
- Marked as destructive (requires confirmation)
- Only available to authorised chat IDs
- Logged with the full command text

<Aside type="danger">
The `/sh` command has full root access. Only authorise trusted chat IDs.
</Aside>

## Network security

### Docker network mode

The bot container runs with `network_mode: host` so it can reach the Docker daemon and systemd bus. This means:
- The bot can call `docker compose`, `systemctl`, etc.
- It binds to the host network (no port mapping needed)

### BlueBubbles + Cloudflare Access

If your BlueBubbles server is behind Cloudflare Access, configure the service token credentials in `bot.json`. The adapter sends these headers with every API call:
- `CF-Access-Client-Id`
- `CF-Access-Client-Secret`

## Best practices

1. **Limit allowed IDs** — only add chat IDs / phone numbers you control
2. **Use private chats** — don't add the bot to group chats
3. **Monitor the logs** — the bot logs all commands and unauthorised attempts
4. **Rotate the Telegram token** if compromised — revoke via BotFather and update `bot.json`
5. **Keep the bot updated** — pull the latest image regularly
