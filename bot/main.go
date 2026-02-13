package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"fleet-bot/bot"
	"fleet-bot/config"
	"fleet-bot/handler"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)
	log.Println("fleet-bot starting...")

	cfg, err := config.Load(config.DefaultConfigPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	b := bot.New(cfg.BotToken, cfg.ChatID)
	router := handler.NewRouter(b, cfg)

	// Handle shutdown signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		log.Println("shutting down...")
		cancel()
	}()

	log.Println("fleet-bot ready, polling for updates...")
	b.Poll(ctx, router)
}
