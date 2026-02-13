package handler

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

const (
	pingInterval = 3 * time.Minute
	pingTimeout  = 10 * time.Second
	slowThresh   = 3 * time.Second
)

// PingResult holds the latest ping for a domain.
type PingResult struct {
	Domain   string
	App      string
	Status   int
	Latency  time.Duration
	Err      error
	CheckedAt time.Time
}

// PingMonitor periodically pings all app domains.
type PingMonitor struct {
	mu      sync.Mutex
	bot     *bot.Bot
	chatID  int64
	enabled bool
	stop    chan struct{}
	results map[string]*PingResult // domain -> latest
	prev    map[string]bool        // domain -> was ok last time
	client  *http.Client
}

func NewPingMonitor(b *bot.Bot, chatID int64) *PingMonitor {
	return &PingMonitor{
		bot:     b,
		chatID:  chatID,
		enabled: true,
		results: make(map[string]*PingResult),
		prev:    make(map[string]bool),
		client: &http.Client{
			Timeout: pingTimeout,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (p *PingMonitor) Start() {
	p.mu.Lock()
	if p.stop != nil {
		p.mu.Unlock()
		return
	}
	p.stop = make(chan struct{})
	p.mu.Unlock()
	go p.loop()
	log.Println("ping monitor started")
}

func (p *PingMonitor) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.stop != nil {
		close(p.stop)
		p.stop = nil
	}
}

func (p *PingMonitor) SetEnabled(enabled bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.enabled = enabled
}

func (p *PingMonitor) IsEnabled() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.enabled
}

func (p *PingMonitor) Results() []*PingResult {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []*PingResult
	for _, r := range p.results {
		cp := *r
		out = append(out, &cp)
	}
	return out
}

func (p *PingMonitor) loop() {
	// Initial ping
	p.doPings(true)

	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-p.stop:
			return
		case <-ticker.C:
			p.mu.Lock()
			enabled := p.enabled
			p.mu.Unlock()
			if enabled {
				p.doPings(false)
			}
		}
	}
}

func (p *PingMonitor) doPings(silent bool) {
	apps, err := exec.FleetJSON[[]ListDataFull]("list")
	if err != nil {
		return
	}

	type domainApp struct {
		domain, app string
	}
	var targets []domainApp
	for _, app := range apps {
		for _, d := range app.Domains {
			targets = append(targets, domainApp{d, app.Name})
		}
	}

	var wg sync.WaitGroup
	resultsCh := make(chan *PingResult, len(targets))

	for _, t := range targets {
		wg.Add(1)
		go func(domain, app string) {
			defer wg.Done()
			resultsCh <- p.ping(domain, app)
		}(t.domain, t.app)
	}
	wg.Wait()
	close(resultsCh)

	for r := range resultsCh {
		ok := r.Err == nil && r.Status >= 200 && r.Status < 500

		p.mu.Lock()
		p.results[r.Domain] = r
		wasOK, known := p.prev[r.Domain]
		p.prev[r.Domain] = ok
		p.mu.Unlock()

		if silent || !known {
			continue
		}

		// Alert on state changes
		if wasOK && !ok {
			msg := fmt.Sprintf("!! HTTP: %s (%s) is DOWN", bot.Code(r.Domain), bot.Bold(r.App))
			if r.Err != nil {
				msg += fmt.Sprintf(" - %v", r.Err)
			} else {
				msg += fmt.Sprintf(" - status %d", r.Status)
			}
			log.Printf("ping alert: %s down", r.Domain)
			p.bot.SendMessage(p.chatID, msg)
		} else if !wasOK && ok {
			log.Printf("ping recovery: %s back up", r.Domain)
			p.bot.SendMessage(p.chatID, fmt.Sprintf("● HTTP: %s (%s) is back up (%dms)",
				bot.Code(r.Domain), bot.Bold(r.App), r.Latency.Milliseconds()))
		} else if ok && r.Latency > slowThresh {
			log.Printf("ping slow: %s %dms", r.Domain, r.Latency.Milliseconds())
			p.bot.SendMessage(p.chatID, fmt.Sprintf("◐ HTTP: %s (%s) slow: %dms",
				bot.Code(r.Domain), bot.Bold(r.App), r.Latency.Milliseconds()))
		}
	}
}

func (p *PingMonitor) ping(domain, app string) *PingResult {
	url := "https://" + domain
	start := time.Now()

	resp, err := p.client.Get(url)
	latency := time.Since(start)

	if err != nil {
		return &PingResult{Domain: domain, App: app, Err: err, Latency: latency, CheckedAt: time.Now()}
	}
	resp.Body.Close()

	return &PingResult{
		Domain:    domain,
		App:       app,
		Status:    resp.StatusCode,
		Latency:   latency,
		CheckedAt: time.Now(),
	}
}

// handlePing shows current ping results for all domains.
func handlePing(ctx context.Context, b *bot.Bot, pm *PingMonitor, chatID int64, args string) {
	results := pm.Results()
	if len(results) == 0 {
		b.SendMessageWithReply(chatID, "No ping data yet. Waiting for first check cycle...", monitorKeyboard())
		return
	}

	// Sort by app then domain
	sort.Slice(results, func(i, j int) bool {
		if results[i].App != results[j].App {
			return results[i].App < results[j].App
		}
		return results[i].Domain < results[j].Domain
	})

	text := bot.Bold("HTTP Pings") + "\n\n"
	up, down := 0, 0
	for _, r := range results {
		if r.Err != nil {
			down++
			text += fmt.Sprintf("○ %s (%s): %v\n", bot.Code(r.Domain), r.App, r.Err)
			continue
		}

		icon := "●"
		if r.Status >= 500 {
			icon = "○"
			down++
		} else if r.Latency > slowThresh {
			icon = "◐"
			up++
		} else {
			up++
		}

		text += fmt.Sprintf("%s %s (%s): %d %dms\n",
			icon, bot.Code(r.Domain), r.App, r.Status, r.Latency.Milliseconds())
	}

	text += fmt.Sprintf("\n%d up, %d down", up, down)

	var enableLabel, enableData string
	if pm.IsEnabled() {
		enableLabel = "Pings: ON"
		enableData = "pg:off"
	} else {
		enableLabel = "Pings: OFF"
		enableData = "pg:on"
	}
	kb := &bot.InlineKeyboardMarkup{
		InlineKeyboard: [][]bot.InlineKeyboardButton{
			{
				{Text: "Refresh", CallbackData: "pg:refresh"},
				{Text: enableLabel, CallbackData: enableData},
			},
		},
	}
	b.SendMessageWithReply(chatID, text, kb)
}

// PingFunc wraps a command needing PingMonitor.
type PingFunc func(ctx context.Context, b *bot.Bot, pm *PingMonitor, chatID int64, args string)

// CbPingFunc handles ping inline callbacks.
type CbPingFunc func(ctx context.Context, b *bot.Bot, pm *PingMonitor, chatID int64, messageID int64, data string)

func cbPing(ctx context.Context, b *bot.Bot, pm *PingMonitor, chatID int64, messageID int64, data string) {
	parts := strings.SplitN(data, ":", 2)
	if len(parts) < 2 {
		return
	}
	switch parts[1] {
	case "on":
		pm.SetEnabled(true)
		b.EditMessage(chatID, messageID, "HTTP pings enabled.", monitorKeyboard())
	case "off":
		pm.SetEnabled(false)
		b.EditMessage(chatID, messageID, "HTTP pings disabled.", monitorKeyboard())
	case "refresh":
		results := pm.Results()
		sort.Slice(results, func(i, j int) bool {
			if results[i].App != results[j].App {
				return results[i].App < results[j].App
			}
			return results[i].Domain < results[j].Domain
		})
		text := bot.Bold("HTTP Pings") + "\n\n"
		for _, r := range results {
			if r.Err != nil {
				text += fmt.Sprintf("○ %s (%s): err\n", bot.Code(r.Domain), r.App)
				continue
			}
			icon := "●"
			if r.Status >= 500 {
				icon = "○"
			} else if r.Latency > slowThresh {
				icon = "◐"
			}
			text += fmt.Sprintf("%s %s: %d %dms\n", icon, bot.Code(r.Domain), r.Status, r.Latency.Milliseconds())
		}

		enableLabel, enableData := "Pings: ON", "pg:off"
		if !pm.IsEnabled() {
			enableLabel, enableData = "Pings: OFF", "pg:on"
		}
		kb := &bot.InlineKeyboardMarkup{
			InlineKeyboard: [][]bot.InlineKeyboardButton{
				{
					{Text: "Refresh", CallbackData: "pg:refresh"},
					{Text: enableLabel, CallbackData: enableData},
				},
			},
		}
		b.EditMessage(chatID, messageID, text, kb)
	}
}
