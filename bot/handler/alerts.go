package handler

import (
	"fmt"
	"log"
	"sync"
	"time"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

const (
	alertInterval    = 2 * time.Minute
	restartCooldown  = 10 * time.Minute
)

// AlertMonitor polls fleet health and sends alerts on state changes.
type AlertMonitor struct {
	mu          sync.Mutex
	bot         *bot.Bot
	chatID      int64
	enabled     bool
	autoRestart bool
	muteNonCrit bool // when true, only alert on "down" transitions
	stop        chan struct{}
	lastState   map[string]string    // app -> health
	lastRestart map[string]time.Time // app -> last restart time
}

func NewAlertMonitor(b *bot.Bot, chatID int64) *AlertMonitor {
	return &AlertMonitor{
		bot:         b,
		chatID:      chatID,
		enabled:     true,
		autoRestart: false,
		muteNonCrit: false,
		lastState:   make(map[string]string),
		lastRestart: make(map[string]time.Time),
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

func (m *AlertMonitor) SetEnabled(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.enabled = enabled
}

func (m *AlertMonitor) IsEnabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enabled
}

func (m *AlertMonitor) SetAutoRestart(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.autoRestart = enabled
}

func (m *AlertMonitor) AutoRestart() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.autoRestart
}

func (m *AlertMonitor) SetMuteNonCrit(mute bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.muteNonCrit = mute
}

func (m *AlertMonitor) MuteNonCrit() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.muteNonCrit
}

func (m *AlertMonitor) loop() {
	// Initial poll to seed state (don't alert on startup)
	m.poll(true)

	ticker := time.NewTicker(alertInterval)
	defer ticker.Stop()

	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			m.mu.Lock()
			enabled := m.enabled
			m.mu.Unlock()
			if enabled {
				m.poll(false)
			}
		}
	}
}

func (m *AlertMonitor) poll(silent bool) {
	resp, err := exec.FleetJSON[StatusResponse]("status")
	if err != nil {
		log.Printf("alert poll error: %v", err)
		return
	}

	m.mu.Lock()
	autoRestart := m.autoRestart
	muteNonCrit := m.muteNonCrit
	m.mu.Unlock()

	for _, app := range resp.Apps {
		prev, known := m.lastState[app.Name]
		m.lastState[app.Name] = app.Health

		if silent || !known {
			continue
		}

		if prev == app.Health {
			continue
		}

		// State changed
		isCritical := app.Health == "down" || prev == "down"
		if muteNonCrit && !isCritical {
			log.Printf("alert (muted): %s %s -> %s", app.Name, prev, app.Health)
			continue
		}

		icon := bot.StatusIcon(app.Health)
		var text string

		if app.Health == "down" && prev == "healthy" {
			text = fmt.Sprintf("%s %s went down!", icon, bot.Bold(app.Name))
		} else if app.Health == "healthy" && prev == "down" {
			text = fmt.Sprintf("%s %s is back up.", icon, bot.Bold(app.Name))
		} else {
			text = fmt.Sprintf("%s %s: %s -> %s", icon, bot.Bold(app.Name), prev, app.Health)
		}

		log.Printf("alert: %s %s -> %s", app.Name, prev, app.Health)
		m.bot.SendMessage(m.chatID, text)

		// Auto-restart if enabled and app went down
		if autoRestart && app.Health == "down" {
			m.tryAutoRestart(app.Name)
		}
	}
}

func (m *AlertMonitor) tryAutoRestart(app string) {
	m.mu.Lock()
	lastRestart, ok := m.lastRestart[app]
	if ok && time.Since(lastRestart) < restartCooldown {
		m.mu.Unlock()
		log.Printf("alert: skipping auto-restart for %s (cooldown)", app)
		return
	}
	m.lastRestart[app] = time.Now()
	m.mu.Unlock()

	m.bot.SendMessage(m.chatID, fmt.Sprintf("Auto-restarting %s...", bot.Bold(app)))

	res, err := exec.FleetMutate("restart", app)
	if err != nil {
		detail := ""
		if res != nil && res.Stderr != "" {
			detail = "\n" + res.Stderr
		}
		m.bot.SendMessage(m.chatID, fmt.Sprintf("Auto-restart failed for %s%s", bot.Bold(app), detail))
		return
	}

	m.bot.SendMessage(m.chatID, fmt.Sprintf("%s %s auto-restarted.", bot.StatusIcon("healthy"), bot.Bold(app)))
}
