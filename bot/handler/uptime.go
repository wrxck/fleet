package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

const (
	uptimeFile     = "/etc/fleet/uptime.json"
	uptimeInterval = 2 * time.Minute
)

// UptimeEntry tracks uptime for one app.
type UptimeEntry struct {
	Checks   int   `json:"checks"`
	Up       int   `json:"up"`
	LastDown int64 `json:"last_down,omitempty"` // unix timestamp
}

// UptimeTracker monitors and persists per-app uptime stats.
type UptimeTracker struct {
	mu   sync.Mutex
	data map[string]*UptimeEntry
	stop chan struct{}
}

func NewUptimeTracker() *UptimeTracker {
	t := &UptimeTracker{
		data: make(map[string]*UptimeEntry),
	}
	t.load()
	return t
}

func (t *UptimeTracker) Start() {
	t.mu.Lock()
	if t.stop != nil {
		t.mu.Unlock()
		return
	}
	t.stop = make(chan struct{})
	t.mu.Unlock()
	go t.loop()
	log.Println("uptime tracker started")
}

func (t *UptimeTracker) Stop() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.stop != nil {
		close(t.stop)
		t.stop = nil
	}
}

func (t *UptimeTracker) loop() {
	ticker := time.NewTicker(uptimeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-t.stop:
			return
		case <-ticker.C:
			t.record()
		}
	}
}

func (t *UptimeTracker) record() {
	resp, err := exec.FleetJSON[StatusResponse]("status")
	if err != nil {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	for _, app := range resp.Apps {
		e, ok := t.data[app.Name]
		if !ok {
			e = &UptimeEntry{}
			t.data[app.Name] = e
		}
		e.Checks++
		if app.Health == "healthy" {
			e.Up++
		} else {
			e.LastDown = time.Now().Unix()
		}
	}

	t.save()
}

func (t *UptimeTracker) Snapshot() map[string]*UptimeEntry {
	t.mu.Lock()
	defer t.mu.Unlock()
	cp := make(map[string]*UptimeEntry, len(t.data))
	for k, v := range t.data {
		e := *v
		cp[k] = &e
	}
	return cp
}

func (t *UptimeTracker) load() {
	data, err := os.ReadFile(uptimeFile)
	if err != nil {
		return
	}
	json.Unmarshal(data, &t.data)
}

func (t *UptimeTracker) save() {
	data, err := json.Marshal(t.data)
	if err != nil {
		return
	}
	os.WriteFile(uptimeFile, data, 0644)
}

// handleUptime shows per-app uptime percentages.
func handleUptime(ctx context.Context, b *bot.Bot, ut *UptimeTracker, chatID int64, args string) {
	snap := ut.Snapshot()
	if len(snap) == 0 {
		b.SendMessageWithReply(chatID, "No uptime data yet. Tracking starts shortly...", monitorKeyboard())
		return
	}

	text := bot.Bold("Uptime") + "\n\n"
	for name, e := range snap {
		pct := float64(0)
		if e.Checks > 0 {
			pct = float64(e.Up) / float64(e.Checks) * 100
		}

		icon := "●"
		if pct < 95 {
			icon = "◐"
		}
		if pct < 80 {
			icon = "○"
		}

		line := fmt.Sprintf("%s %s: %.1f%% (%d/%d checks)", icon, bot.Code(name), pct, e.Up, e.Checks)
		if e.LastDown > 0 {
			ago := time.Since(time.Unix(e.LastDown, 0)).Round(time.Minute)
			line += fmt.Sprintf(" — last down %s ago", ago)
		}
		text += line + "\n"
	}

	b.SendMessageWithReply(chatID, text, monitorKeyboard())
}

// UptimeFunc wraps a command needing UptimeTracker.
type UptimeFunc func(ctx context.Context, b *bot.Bot, ut *UptimeTracker, chatID int64, args string)
