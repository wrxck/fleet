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

	// Build command registry.
	reg := command.NewRegistry()

	helpCmd := &command.HelpCmd{}

	reg.Register(&command.StatusCmd{})
	reg.Register(&command.RestartCmd{})
	reg.Register(&command.StartCmd{})
	reg.Register(&command.StopCmd{})
	reg.Register(&command.LogsCmd{})
	reg.Register(&command.HealthCmd{})
	reg.Register(&command.FreezeCmd{})
	reg.Register(&command.UnfreezeCmd{})
	reg.Register(&command.ShellCmd{})
	reg.Register(&command.PingCmd{})
	reg.Register(&command.UptimeCmd{})
	reg.Register(&command.SSLCmd{})
	reg.Register(&command.WAFCmd{})
	reg.Register(&command.AlertsCmd{})
	reg.Register(&command.CleanupCmd{})
	reg.Register(&command.DigestCmd{})
	reg.Register(&command.ClaudeCmd{})
	reg.Register(&command.SecretsCmd{})
	reg.Register(&command.GitCmd{})
	reg.Register(&command.NginxCmd{})
	reg.Register(&command.SysCmd{})
	reg.Register(&command.DepsCmd{})
	reg.Register(helpCmd)

	helpCmd.SetRegistry(reg)

	// Build router.
	r := router.New(reg)

	// Add adapters based on config.
	if tg := cfg.Adapters.Telegram; tg != nil && tg.Enabled {
		tgAdapter := adapter.NewTelegram(tg.BotToken, tg.AllowedChatIDs, tg.AlertChatIDs)
		r.AddAdapter(tgAdapter)
		log.Println("telegram adapter registered")
	}

	if im := cfg.Adapters.IMessage; im != nil && im.Enabled {
		bbAdapter := adapter.NewBlueBubbles(
			im.ServerURL,
			im.Password,
			im.CfAccessClientID,
			im.CfAccessClientSecret,
			im.WebhookPort,
			im.AllowedNumbers,
			im.AlertChatGuids,
		)
		r.AddAdapter(bbAdapter)
		log.Println("imessage adapter registered")
	}

	// Parse poll interval.
	pollInterval, err := time.ParseDuration(cfg.Alerts.PollInterval)
	if err != nil {
		log.Printf("config: invalid pollInterval %q, using default 2m: %v", cfg.Alerts.PollInterval, err)
		pollInterval = 2 * time.Minute
	}

	// Start alert monitor.
	alertMon := monitor.NewAlertMonitor(r, cfg.Alerts.MaxConsecutiveFailures, pollInterval)
	alertMon.Start()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle shutdown signals.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		log.Println("shutting down...")
		alertMon.Stop()
		cancel()
	}()

	log.Println("fleet-bot ready")
	if err := r.Run(ctx); err != nil {
		log.Fatalf("router: %v", err)
	}
}
