package handler

import (
	"context"
	"log"
	"strings"

	"fleet-bot/bot"
	"fleet-bot/claude"
	"fleet-bot/config"
)

// CommandFunc handles a bot command. args is the text after the command.
type CommandFunc func(ctx context.Context, b *bot.Bot, chatID int64, args string)

// CallbackFunc handles an inline keyboard callback.
// chatID and messageID come from the callback's message. data is the full callback_data string.
type CallbackFunc func(ctx context.Context, b *bot.Bot, chatID int64, messageID int64, data string)

// Router dispatches commands and manages confirmation callbacks.
type Router struct {
	commands  map[string]CommandFunc
	callbacks map[string]CallbackFunc // prefix -> handler
	confirm   *bot.ConfirmManager
	session   *claude.Session
	alerts    *AlertMonitor
	pings     *PingMonitor
	uptime    *UptimeTracker
	digest    *DigestManager
	openaiKey string
}

func NewRouter(b *bot.Bot, cfg *config.Config) *Router {
	var alertChatID int64
	if tg := cfg.Adapters.Telegram; tg != nil && len(tg.AlertChatIDs) > 0 {
		alertChatID = tg.AlertChatIDs[0]
	}
	alerts := NewAlertMonitor(b, alertChatID)
	pings := NewPingMonitor(b, alertChatID)
	uptime := NewUptimeTracker()
	digest := NewDigestManager(b, alertChatID, uptime, alerts, pings)

	r := &Router{
		commands:  make(map[string]CommandFunc),
		callbacks: make(map[string]CallbackFunc),
		confirm:   bot.NewConfirmManager(),
		session:   claude.NewSession(),
		alerts:    alerts,
		pings:     pings,
		uptime:    uptime,
		digest:    digest,
		openaiKey: cfg.OpenAIKey,
	}
	r.registerAll(b)
	alerts.Start()
	pings.Start()
	uptime.Start()
	digest.Start()
	return r
}

func (r *Router) registerAll(b *bot.Bot) {
	// Meta
	r.commands["start"] = handleStart
	r.commands["help"] = handleHelp
	r.commands["id"] = handleID

	// Fleet
	r.commands["status"] = handleStatus
	r.commands["list"] = handleList
	r.commands["health"] = handleHealth
	r.commands["start_app"] = handleStartApp
	r.commands["stop"] = r.makeDestructive(handleStopConfirm)
	r.commands["restart"] = r.makeDestructive(handleRestartConfirm)
	r.commands["deploy"] = r.makeDestructive(handleDeployConfirm)
	r.commands["logs"] = handleLogs
	r.commands["watchdog"] = handleWatchdog

	// Fleet - secrets, nginx, git
	r.commands["secrets"] = handleSecrets
	r.commands["secrets_list"] = handleSecretsList
	r.commands["secrets_validate"] = handleSecretsValidate
	r.commands["nginx"] = handleNginx
	r.commands["git"] = handleGit

	// System
	r.commands["sys"] = handleSys
	r.commands["docker"] = handleDocker
	r.commands["services"] = handleServices

	// WAF
	r.commands["waf"] = handleWAF
	r.commands["waf_whitelist"] = handleWAFWhitelist
	r.commands["waf_whitelist_add"] = r.makeDestructive(handleWAFWhitelistAddConfirm)
	r.commands["waf_whitelist_rm"] = r.makeDestructive(handleWAFWhitelistRmConfirm)
	r.commands["waf_rate"] = r.makeDestructive(handleWAFRateConfirm)
	r.commands["waf_logs"] = handleWAFLogs

	// Claude Code
	r.commands["cc_stop"] = r.makeClaude(handleCCStop)
	r.commands["cc_reset"] = r.makeClaude(handleCCReset)
	r.commands["cc_cd"] = r.makeClaude(handleCCCD)
	r.commands["cc_model"] = r.makeClaude(handleCCModel)
	r.commands["cc_status"] = r.makeClaude(handleCCStatus)
	r.commands["cc_resume"] = r.makeClaude(handleCCResume)
	r.commands["cc_history"] = r.makeClaude(handleCCHistory)
	r.commands["cc_sessions"] = r.makeClaude(handleCCSessions)

	// Monitoring
	r.commands["alerts"] = r.makeAlert(handleAlerts)
	r.commands["ping"] = r.makePing(handlePing)
	r.commands["uptime"] = r.makeUptime(handleUptime)
	r.commands["ssl"] = handleSSL
	r.commands["digest"] = r.makeDigest(handleDigest)
	r.commands["deploy_at"] = r.makeDigest(handleDeployAt)

	// Operations
	r.commands["sh"] = r.makeDestructive(handleShell)
	r.commands["logsearch"] = handleLogSearch
	r.commands["cleanup"] = r.makeDestructive(handleCleanup)
	r.commands["pin"] = handlePinCmd

	// Inline keyboard callbacks (prefix-routed)
	r.callbacks["h"] = cbHelp                                   // help navigation
	r.callbacks["a"] = r.makeCbWithConfirm(cbApp)               // app actions
	r.callbacks["s"] = cbSystem                                 // sys/docker/services refresh
	r.callbacks["w"] = cbWAF                                    // WAF actions
	r.callbacks["c"] = r.makeCbWithClaude(cbClaude)             // Claude actions
	r.callbacks["al"] = r.makeCbWithAlert(cbAlerts)             // alert toggles
	r.callbacks["pg"] = r.makeCbWithPing(cbPing)                // ping toggles
	r.callbacks["qp"] = r.makeCbQuickPalette()                  // command palette
}

// makeDestructive wraps a command that needs confirmation.
type DestructiveFunc func(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, args string)

func (r *Router) makeDestructive(fn DestructiveFunc) CommandFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, args string) {
		fn(ctx, b, r.confirm, chatID, args)
	}
}

// makeClaude wraps a command that needs the Claude session.
type ClaudeFunc func(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, args string)

func (r *Router) makeClaude(fn ClaudeFunc) CommandFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, args string) {
		fn(ctx, b, r.session, chatID, args)
	}
}

func (r *Router) makeAlert(fn AlertFunc) CommandFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, args string) {
		fn(ctx, b, r.alerts, chatID, args)
	}
}

// Callback wrapper types
type CbConfirmFunc func(ctx context.Context, b *bot.Bot, cm *bot.ConfirmManager, chatID int64, messageID int64, data string)
type CbClaudeFunc func(ctx context.Context, b *bot.Bot, s *claude.Session, chatID int64, messageID int64, data string)

func (r *Router) makeCbWithConfirm(fn CbConfirmFunc) CallbackFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, messageID int64, data string) {
		fn(ctx, b, r.confirm, chatID, messageID, data)
	}
}

func (r *Router) makeCbWithClaude(fn CbClaudeFunc) CallbackFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, messageID int64, data string) {
		fn(ctx, b, r.session, chatID, messageID, data)
	}
}

func (r *Router) makeCbWithAlert(fn CbAlertFunc) CallbackFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, messageID int64, data string) {
		fn(ctx, b, r.alerts, chatID, messageID, data)
	}
}

func (r *Router) makePing(fn PingFunc) CommandFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, args string) {
		fn(ctx, b, r.pings, chatID, args)
	}
}

func (r *Router) makeCbWithPing(fn CbPingFunc) CallbackFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, messageID int64, data string) {
		fn(ctx, b, r.pings, chatID, messageID, data)
	}
}

func (r *Router) makeUptime(fn UptimeFunc) CommandFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, args string) {
		fn(ctx, b, r.uptime, chatID, args)
	}
}

func (r *Router) makeDigest(fn DigestFunc) CommandFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, args string) {
		fn(ctx, b, r.digest, chatID, args)
	}
}

// makeCbQuickPalette handles the "qp:" callback prefix for the command palette.
func (r *Router) makeCbQuickPalette() CallbackFunc {
	return func(ctx context.Context, b *bot.Bot, chatID int64, messageID int64, data string) {
		parts := strings.SplitN(data, ":", 3)
		if len(parts) < 2 {
			return
		}
		action := parts[1]

		// For "run" actions (slash-from-Claude suggestions)
		if action == "run" && len(parts) == 3 {
			cmd := parts[2]
			cmdParts := strings.SplitN(cmd, " ", 2)
			cmdName := cmdParts[0]
			cmdArgs := ""
			if len(cmdParts) > 1 {
				cmdArgs = cmdParts[1]
			}
			if handler, ok := r.commands[cmdName]; ok {
				b.EditMessage(chatID, messageID, "Running /"+cmd+"...", nil)
				handler(ctx, b, chatID, cmdArgs)
			}
			return
		}

		// Palette shortcuts — dispatch to existing commands
		switch action {
		case "status":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleStatus(ctx, b, chatID, "")
		case "docker":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleDocker(ctx, b, chatID, "")
		case "sys":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleSys(ctx, b, chatID, "")
		case "health":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleHealth(ctx, b, chatID, "")
		case "ping":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handlePing(ctx, b, r.pings, chatID, "")
		case "uptime":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleUptime(ctx, b, r.uptime, chatID, "")
		case "ssl":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleSSL(ctx, b, chatID, "")
		case "alerts":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleAlerts(ctx, b, r.alerts, chatID, "")
		case "cleanup":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleCleanup(ctx, b, r.confirm, chatID, "")
		case "claude":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleCCStatus(ctx, b, r.session, chatID, "")
		case "digest":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleDigest(ctx, b, r.digest, chatID, "")
		case "help":
			b.EditMessage(chatID, messageID, "Loading...", nil)
			handleHelp(ctx, b, chatID, "")
		}
	}
}

// Handle implements bot.Handler.
func (r *Router) Handle(ctx context.Context, b *bot.Bot, u bot.Update) {
	// Handle callback queries
	if u.CallbackQuery != nil {
		if !bot.IsAuthorized(u.CallbackQuery.From.ID) {
			log.Printf("UNAUTHORIZED callback: user=%d name=%q data=%q", u.CallbackQuery.From.ID, u.CallbackQuery.From.FirstName, u.CallbackQuery.Data)
			b.AnswerCallback(u.CallbackQuery.ID)
			return
		}
		b.AnswerCallback(u.CallbackQuery.ID)

		data := u.CallbackQuery.Data

		// Existing confirmation system
		if strings.HasPrefix(data, "confirm_") {
			r.confirm.HandleCallback(b, u.CallbackQuery)
			return
		}

		// Route by prefix (everything before first ":")
		chatID := int64(0)
		messageID := int64(0)
		if u.CallbackQuery.Message != nil {
			chatID = u.CallbackQuery.Message.Chat.ID
			messageID = u.CallbackQuery.Message.MessageID
		}

		prefix := data
		if idx := strings.Index(data, ":"); idx >= 0 {
			prefix = data[:idx]
		}

		if handler, ok := r.callbacks[prefix]; ok {
			handler(ctx, b, chatID, messageID, data)
		}
		return
	}

	if u.Message == nil {
		return
	}

	chatID := u.Message.Chat.ID
	if !bot.IsAuthorized(chatID) {
		log.Printf("UNAUTHORIZED message: chat=%d user=%d name=%q text=%q", chatID, u.Message.From.ID, u.Message.From.FirstName, truncateLog(u.Message.Text, 40))
		return
	}

	if u.Message.Voice != nil {
		handleVoiceMessage(ctx, b, r.session, r.openaiKey, chatID, u.Message.Voice, u.Message.MessageID)
		return
	}

	if len(u.Message.Photo) > 0 {
		handlePhotoMessage(ctx, b, r.session, chatID, u.Message.Photo, u.Message.Caption, u.Message.MessageID)
		return
	}

	if u.Message.Document != nil {
		handleDocumentMessage(ctx, b, r.session, chatID, u.Message.Document, u.Message.Caption, u.Message.MessageID)
		return
	}

	if u.Message.Text == "" {
		return
	}

	text := u.Message.Text

	// Command palette shortcut
	if text == "?" {
		handlePalette(ctx, b, chatID, "")
		return
	}

	// Non-command messages go to Claude Code (with context injection)
	if !strings.HasPrefix(text, "/") {
		log.Printf("claude: %q (chat: %d)", truncateLog(text, 80), chatID)
		if prefix := contextForClaude(r.alerts); prefix != "" {
			text = prefix + text
		}
		handleClaudeMessage(ctx, b, r.session, chatID, text)
		return
	}

	// Parse command: /command@botname args
	text = text[1:] // strip leading /
	parts := strings.SplitN(text, " ", 2)
	cmd := parts[0]
	args := ""
	if len(parts) > 1 {
		args = strings.TrimSpace(parts[1])
	}

	// Strip @botname suffix
	if at := strings.Index(cmd, "@"); at >= 0 {
		cmd = cmd[:at]
	}

	cmd = strings.ToLower(cmd)

	// Special: /pin needs the reply_to_message
	if cmd == "pin" && u.Message.ReplyToMessage != nil {
		handlePin(ctx, b, chatID, u.Message.ReplyToMessage.MessageID)
		return
	}

	handler, exists := r.commands[cmd]
	if !exists {
		b.SendMessageWithReply(chatID, "Unknown command. Try /help", helpMainKeyboard())
		return
	}

	log.Printf("cmd: /%s %s (chat: %d)", cmd, args, chatID)
	handler(ctx, b, chatID, args)
}

func truncateLog(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
