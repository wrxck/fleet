package monitor

import (
	"fmt"
	"log"
	"sync"
	"time"

	"fleet-bot/exec"
)

const (
	defaultMaxConsecutiveFailures = 5
	defaultPollInterval           = 2 * time.Minute
	restartCooldown               = 10 * time.Minute
)

type statusResponse struct {
	Apps []struct {
		Name   string `json:"name"`
		Health string `json:"health"`
	} `json:"apps"`
}

// Alerter is satisfied by any type that can broadcast alert messages (e.g.
// *router.Router). Using an interface avoids an import cycle between the
// monitor and router packages.
type Alerter interface {
	SendAlert(text string)
}

// AlertMonitor polls fleet health and sends alerts via all registered adapters.
// It tracks consecutive failures and auto-freezes services that exceed the threshold.
type AlertMonitor struct {
	router      Alerter
	enabled     bool
	autoRestart bool

	maxConsecutiveFailures int
	pollInterval           time.Duration

	stop            chan struct{}
	lastState       map[string]string
	consecutiveDown map[string]int
	lastRestart     map[string]time.Time

	mu sync.Mutex
}

// NewAlertMonitor creates an AlertMonitor. If maxFailures <= 0 the default (5)
// is used; if pollInterval <= 0 the default (2m) is used.
func NewAlertMonitor(r Alerter, maxFailures int, pollInterval time.Duration) *AlertMonitor {
	if maxFailures <= 0 {
		maxFailures = defaultMaxConsecutiveFailures
	}
	if pollInterval <= 0 {
		pollInterval = defaultPollInterval
	}
	return &AlertMonitor{
		router:                 r,
		enabled:                true,
		autoRestart:            false,
		maxConsecutiveFailures: maxFailures,
		pollInterval:           pollInterval,
		lastState:              make(map[string]string),
		consecutiveDown:        make(map[string]int),
		lastRestart:            make(map[string]time.Time),
	}
}

// Start seeds state silently, then begins the polling loop.
// Calling Start on an already-running monitor is a no-op.
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

// Stop shuts down the polling loop.
func (m *AlertMonitor) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stop != nil {
		close(m.stop)
		m.stop = nil
	}
}

// SetEnabled enables or disables alert polling.
func (m *AlertMonitor) SetEnabled(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.enabled = enabled
}

// IsEnabled reports whether alert polling is enabled.
func (m *AlertMonitor) IsEnabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enabled
}

// SetAutoRestart enables or disables automatic service restart on failure.
func (m *AlertMonitor) SetAutoRestart(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.autoRestart = enabled
}

// AutoRestart reports whether automatic restart is enabled.
func (m *AlertMonitor) AutoRestart() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.autoRestart
}

func (m *AlertMonitor) loop() {
	// Seed state without alerting.
	m.poll(true)

	ticker := time.NewTicker(m.pollInterval)
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
	resp, err := exec.FleetJSON[statusResponse]("status")
	if err != nil {
		log.Printf("alert poll error: %v", err)
		return
	}

	m.mu.Lock()
	autoRestart := m.autoRestart
	maxFailures := m.maxConsecutiveFailures
	m.mu.Unlock()

	for _, app := range resp.Apps {
		prev, known := m.lastState[app.Name]
		m.lastState[app.Name] = app.Health

		// Track consecutive down count.
		if app.Health == "down" {
			m.consecutiveDown[app.Name]++
		} else {
			m.consecutiveDown[app.Name] = 0
		}
		count := m.consecutiveDown[app.Name]

		// Auto-freeze when consecutive failure threshold is exceeded.
		if count >= maxFailures {
			m.freezeService(app.Name, count)
		}

		if silent || !known {
			continue
		}

		if prev == app.Health {
			continue
		}

		// State changed — send alert.
		var text string
		switch {
		case app.Health == "down" && prev == "healthy":
			text = fmt.Sprintf("[XX] %s went down!", app.Name)
		case app.Health == "healthy" && prev == "down":
			text = fmt.Sprintf("[OK] %s is back up.", app.Name)
		default:
			text = fmt.Sprintf("[--] %s: %s -> %s", app.Name, prev, app.Health)
		}

		log.Printf("alert: %s %s -> %s", app.Name, prev, app.Health)
		m.router.SendAlert(text)

		// Auto-restart if enabled and the app just went down.
		if autoRestart && app.Health == "down" {
			m.tryAutoRestart(app.Name)
		}
	}
}

// freezeService runs `fleet freeze <app>` and sends an urgent alert.
func (m *AlertMonitor) freezeService(app string, count int) {
	reason := fmt.Sprintf("auto-freeze: %d consecutive failures", count)
	log.Printf("alert: freezing %s (%s)", app, reason)

	_, err := exec.FleetMutate("freeze", app, reason)
	if err != nil {
		log.Printf("alert: freeze failed for %s: %v", app, err)
		m.router.SendAlert(fmt.Sprintf("[URGENT] %s has been down %d times and auto-freeze FAILED: %v", app, count, err))
		return
	}

	m.router.SendAlert(fmt.Sprintf("[URGENT] %s frozen after %d consecutive failures.", app, count))
}

// tryAutoRestart attempts to restart app if the restart cooldown has passed.
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

	m.router.SendAlert(fmt.Sprintf("Auto-restarting %s...", app))

	res, err := exec.FleetMutate("restart", app)
	if err != nil {
		detail := ""
		if res != nil && res.Stderr != "" {
			detail = "\n" + res.Stderr
		}
		m.router.SendAlert(fmt.Sprintf("Auto-restart failed for %s%s", app, detail))
		return
	}

	m.router.SendAlert(fmt.Sprintf("[OK] %s auto-restarted.", app))
}
