package command

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

const (
	pingTimeout = 10 * time.Second
	slowThresh  = 3 * time.Second
)

// listDataFull matches fleet list --json with domains.
type listDataFull struct {
	Name    string   `json:"name"`
	Domains []string `json:"domains"`
	Port    *int     `json:"port"`
}

// pingResult holds the result of a single domain check.
type pingResult struct {
	Domain    string
	App       string
	Status    int
	Latency   time.Duration
	Err       error
	CheckedAt time.Time
}

// PingCmd implements /ping.
type PingCmd struct{}

func (c *PingCmd) Name() string      { return "ping" }
func (c *PingCmd) Aliases() []string { return nil }
func (c *PingCmd) Help() string      { return "Show HTTP ping status for all app domains" }

func (c *PingCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	apps, err := exec.FleetJSON[[]listDataFull]("list")
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error fetching apps: %s", err)), nil
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

	if len(targets) == 0 {
		return adapter.TextResponse("No domains registered."), nil
	}

	client := &http.Client{
		Timeout: pingTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	var wg sync.WaitGroup
	results := make([]*pingResult, len(targets))
	for i, t := range targets {
		wg.Add(1)
		go func(i int, domain, app string) {
			defer wg.Done()
			results[i] = doPing(client, domain, app)
		}(i, t.domain, t.app)
	}
	wg.Wait()

	sort.Slice(results, func(i, j int) bool {
		if results[i].App != results[j].App {
			return results[i].App < results[j].App
		}
		return results[i].Domain < results[j].Domain
	})

	var sb strings.Builder
	sb.WriteString("HTTP Pings\n\n")

	up, down := 0, 0
	for _, r := range results {
		if r.Err != nil {
			down++
			sb.WriteString(fmt.Sprintf("[XX] %s (%s): %v\n", r.Domain, r.App, r.Err))
			continue
		}
		icon := "[OK]"
		if r.Status >= 500 {
			icon = "[XX]"
			down++
		} else if r.Latency > slowThresh {
			icon = "[~~]"
			up++
		} else {
			up++
		}
		sb.WriteString(fmt.Sprintf("%s %s (%s): %d %dms\n", icon, r.Domain, r.App, r.Status, r.Latency.Milliseconds()))
	}

	sb.WriteString(fmt.Sprintf("\n%d up, %d down", up, down))
	return adapter.TextResponse(sb.String()), nil
}

func doPing(client *http.Client, domain, app string) *pingResult {
	url := "https://" + domain
	start := time.Now()

	resp, err := client.Get(url)
	latency := time.Since(start)

	if err != nil {
		return &pingResult{Domain: domain, App: app, Err: err, Latency: latency, CheckedAt: time.Now()}
	}
	resp.Body.Close()

	return &pingResult{
		Domain:    domain,
		App:       app,
		Status:    resp.StatusCode,
		Latency:   latency,
		CheckedAt: time.Now(),
	}
}
