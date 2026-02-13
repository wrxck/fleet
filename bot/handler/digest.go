package handler

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"fleet-bot/bot"
	"fleet-bot/exec"
	"fleet-bot/monitor"
)

const digestHour = 8 // 8 AM UTC

// DigestManager handles daily digests and scheduled deploys.
type DigestManager struct {
	mu       sync.Mutex
	bot      *bot.Bot
	chatID   int64
	uptime   *UptimeTracker
	alerts   *AlertMonitor
	pings    *PingMonitor
	stop     chan struct{}
	deploys  []ScheduledDeploy
}

// ScheduledDeploy represents a queued deploy.
type ScheduledDeploy struct {
	App  string
	At   time.Time
}

func NewDigestManager(b *bot.Bot, chatID int64, ut *UptimeTracker, am *AlertMonitor, pm *PingMonitor) *DigestManager {
	return &DigestManager{
		bot:    b,
		chatID: chatID,
		uptime: ut,
		alerts: am,
		pings:  pm,
	}
}

func (d *DigestManager) Start() {
	d.mu.Lock()
	if d.stop != nil {
		d.mu.Unlock()
		return
	}
	d.stop = make(chan struct{})
	d.mu.Unlock()
	go d.loop()
	log.Println("digest manager started")
}

func (d *DigestManager) Stop() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.stop != nil {
		close(d.stop)
		d.stop = nil
	}
}

func (d *DigestManager) loop() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	lastDigestDay := -1

	for {
		select {
		case <-d.stop:
			return
		case now := <-ticker.C:
			// Daily digest at 8 AM
			if now.Hour() == digestHour && now.Day() != lastDigestDay {
				lastDigestDay = now.Day()
				d.sendDigest()
				// Also check SSL
				CheckSSLAlerts(d.bot, d.chatID)
			}

			// Process scheduled deploys
			d.processScheduledDeploys(now)
		}
	}
}

func (d *DigestManager) sendDigest() {
	text := bot.Bold("Daily Digest") + " — " + time.Now().Format("Mon Jan 2") + "\n\n"

	// System stats
	sys := monitor.GetSystemStats()
	text += bot.Bold("System") + "\n"
	text += fmt.Sprintf("  CPU: %s | Mem: %s/%s | Disk: %s/%s\n",
		bot.FormatPercent(sys.CPUPercent),
		bot.FormatBytes(sys.MemUsed), bot.FormatBytes(sys.MemTotal),
		bot.FormatBytes(sys.DiskUsed), bot.FormatBytes(sys.DiskTotal))
	text += fmt.Sprintf("  Load: %.2f %.2f %.2f | Up: %s\n\n",
		sys.LoadAvg1, sys.LoadAvg5, sys.LoadAvg15, sys.Uptime)

	// Fleet status
	resp, err := exec.FleetJSON[StatusResponse]("status")
	if err == nil {
		healthy, down := 0, 0
		var downApps []string
		for _, app := range resp.Apps {
			if app.Health == "healthy" {
				healthy++
			} else {
				down++
				downApps = append(downApps, app.Name)
			}
		}
		text += bot.Bold("Fleet") + "\n"
		text += fmt.Sprintf("  %d healthy, %d down\n", healthy, down)
		if len(downApps) > 0 {
			text += fmt.Sprintf("  Down: %s\n", strings.Join(downApps, ", "))
		}
		text += "\n"
	}

	// Uptime summary
	snap := d.uptime.Snapshot()
	if len(snap) > 0 {
		text += bot.Bold("Uptime (24h)") + "\n"
		type appPct struct {
			name string
			pct  float64
		}
		var apps []appPct
		for name, e := range snap {
			pct := float64(0)
			if e.Checks > 0 {
				pct = float64(e.Up) / float64(e.Checks) * 100
			}
			apps = append(apps, appPct{name, pct})
		}
		sort.Slice(apps, func(i, j int) bool { return apps[i].pct < apps[j].pct })
		for _, a := range apps {
			icon := "●"
			if a.pct < 95 {
				icon = "◐"
			}
			if a.pct < 80 {
				icon = "○"
			}
			text += fmt.Sprintf("  %s %s: %.1f%%\n", icon, a.name, a.pct)
		}
		text += "\n"
	}

	// Ping summary
	results := d.pings.Results()
	if len(results) > 0 {
		up, down := 0, 0
		for _, r := range results {
			if r.Err == nil && r.Status < 500 {
				up++
			} else {
				down++
			}
		}
		text += fmt.Sprintf(bot.Bold("HTTP Pings")+": %d up, %d down\n\n", up, down)
	}

	// Scheduled deploys
	d.mu.Lock()
	pendingDeploys := len(d.deploys)
	d.mu.Unlock()
	if pendingDeploys > 0 {
		text += fmt.Sprintf(bot.Bold("Scheduled")+": %d pending deploys\n", pendingDeploys)
	}

	d.bot.SendMessage(d.chatID, text)
}

// ScheduleDeploy queues a deploy for a specific time.
func (d *DigestManager) ScheduleDeploy(app string, at time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.deploys = append(d.deploys, ScheduledDeploy{App: app, At: at})
}

// PendingDeploys returns queued deploys.
func (d *DigestManager) PendingDeploys() []ScheduledDeploy {
	d.mu.Lock()
	defer d.mu.Unlock()
	cp := make([]ScheduledDeploy, len(d.deploys))
	copy(cp, d.deploys)
	return cp
}

func (d *DigestManager) processScheduledDeploys(now time.Time) {
	d.mu.Lock()
	var remaining []ScheduledDeploy
	var due []ScheduledDeploy
	for _, sd := range d.deploys {
		if now.After(sd.At) {
			due = append(due, sd)
		} else {
			remaining = append(remaining, sd)
		}
	}
	d.deploys = remaining
	d.mu.Unlock()

	for _, sd := range due {
		log.Printf("scheduled deploy: %s (was due %s)", sd.App, sd.At.Format(time.RFC3339))
		d.bot.SendMessage(d.chatID, fmt.Sprintf("Deploying %s (scheduled)...", bot.Bold(sd.App)))

		res, err := exec.FleetMutate("deploy", sd.App, "-y")
		if err != nil {
			detail := ""
			if res != nil {
				detail = res.Stderr
			}
			d.bot.SendMessage(d.chatID, fmt.Sprintf("Scheduled deploy failed for %s: %s", bot.Bold(sd.App), detail))
			continue
		}

		output := res.Stdout
		if len(output) > 3000 {
			output = output[len(output)-3000:]
		}
		d.bot.SendMessage(d.chatID, fmt.Sprintf("%s %s deployed (scheduled).\n%s",
			bot.StatusIcon("healthy"), bot.Bold(sd.App), bot.Pre(output)))
	}
}

// handleDeployAt schedules a deploy for a specific time.
func handleDeployAt(ctx context.Context, b *bot.Bot, dm *DigestManager, chatID int64, args string) {
	fields := strings.Fields(args)
	if len(fields) < 2 {
		// Show pending
		pending := dm.PendingDeploys()
		if len(pending) == 0 {
			b.SendMessageWithReply(chatID, "No scheduled deploys.\nUsage: /deploy_at &lt;app&gt; &lt;time&gt;\n\nTime formats: 15:04, 2006-01-02T15:04", helpMainKeyboard())
			return
		}
		text := bot.Bold("Scheduled Deploys") + "\n\n"
		for _, sd := range pending {
			text += fmt.Sprintf("  %s at %s\n", bot.Code(sd.App), sd.At.Format("Jan 2 15:04"))
		}
		b.SendMessageWithReply(chatID, text, helpMainKeyboard())
		return
	}

	app := fields[0]
	timeStr := fields[1]

	// Parse time — try HH:MM (today or tomorrow) and full datetime
	var at time.Time
	now := time.Now()

	if t, err := time.Parse("15:04", timeStr); err == nil {
		at = time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), 0, 0, time.UTC)
		if at.Before(now) {
			at = at.Add(24 * time.Hour)
		}
	} else if t, err := time.Parse("2006-01-02T15:04", timeStr); err == nil {
		at = t
	} else {
		b.SendMessageWithReply(chatID, "Invalid time format. Use HH:MM or YYYY-MM-DDTHH:MM", helpMainKeyboard())
		return
	}

	dm.ScheduleDeploy(app, at)
	b.SendMessageWithReply(chatID, fmt.Sprintf("Scheduled deploy of %s at %s", bot.Bold(app), bot.Code(at.Format("Jan 2 15:04 UTC"))), helpMainKeyboard())
}

// DigestFunc wraps a command needing DigestManager.
type DigestFunc func(ctx context.Context, b *bot.Bot, dm *DigestManager, chatID int64, args string)

// handleDigest triggers an immediate digest send.
func handleDigest(ctx context.Context, b *bot.Bot, dm *DigestManager, chatID int64, args string) {
	dm.sendDigest()
}
