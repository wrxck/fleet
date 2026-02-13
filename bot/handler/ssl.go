package handler

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"math"
	"net"
	"sort"
	"sync"
	"time"

	"fleet-bot/bot"
	"fleet-bot/exec"
)

// ListDataFull matches fleet list --json with domains.
type ListDataFull struct {
	Name    string   `json:"name"`
	Domains []string `json:"domains"`
	Port    *int     `json:"port"`
}

// SSLResult holds cert check result for one domain.
type SSLResult struct {
	Domain  string
	App     string
	Expiry  time.Time
	Days    int
	Err     error
}

func handleSSL(ctx context.Context, b *bot.Bot, chatID int64, args string) {
	b.SendChatAction(chatID, "typing")

	apps, err := exec.FleetJSON[[]ListDataFull]("list")
	if err != nil {
		b.SendMessageWithReply(chatID, fmt.Sprintf("Error: %s", err), monitorKeyboard())
		return
	}

	// Collect all domains
	type domainApp struct {
		domain, app string
	}
	var domains []domainApp
	for _, app := range apps {
		for _, d := range app.Domains {
			domains = append(domains, domainApp{d, app.Name})
		}
	}

	if len(domains) == 0 {
		b.SendMessageWithReply(chatID, "No domains registered.", monitorKeyboard())
		return
	}

	// Check certs in parallel
	var wg sync.WaitGroup
	results := make([]SSLResult, len(domains))
	for i, da := range domains {
		wg.Add(1)
		go func(i int, domain, app string) {
			defer wg.Done()
			results[i] = checkSSL(domain, app)
		}(i, da.domain, da.app)
	}
	wg.Wait()

	// Sort by days remaining
	sort.Slice(results, func(i, j int) bool {
		if results[i].Err != nil && results[j].Err == nil {
			return true
		}
		if results[i].Err == nil && results[j].Err != nil {
			return false
		}
		return results[i].Days < results[j].Days
	})

	text := bot.Bold("SSL Certificates") + "\n\n"
	for _, r := range results {
		if r.Err != nil {
			text += fmt.Sprintf("!! %s (%s): %v\n", bot.Code(r.Domain), r.App, r.Err)
			continue
		}

		icon := "●"
		if r.Days < 7 {
			icon = "!!"
		} else if r.Days < 14 {
			icon = "◐"
		}

		text += fmt.Sprintf("%s %s (%s): %dd left (%s)\n",
			icon, bot.Code(r.Domain), r.App, r.Days, r.Expiry.Format("Jan 2"))
	}

	b.SendMessageWithReply(chatID, text, monitorKeyboard())
}

func checkSSL(domain, app string) SSLResult {
	conn, err := tls.DialWithDialer(
		&net.Dialer{Timeout: 5 * time.Second},
		"tcp", domain+":443",
		&tls.Config{InsecureSkipVerify: false},
	)
	if err != nil {
		return SSLResult{Domain: domain, App: app, Err: err}
	}
	defer conn.Close()

	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return SSLResult{Domain: domain, App: app, Err: fmt.Errorf("no certificates")}
	}

	expiry := certs[0].NotAfter
	days := int(math.Floor(time.Until(expiry).Hours() / 24))

	return SSLResult{
		Domain: domain,
		App:    app,
		Expiry: expiry,
		Days:   days,
	}
}

// CheckSSLAlerts checks for expiring certs and sends alerts. Called by digest.
func CheckSSLAlerts(b *bot.Bot, chatID int64) {
	apps, err := exec.FleetJSON[[]ListDataFull]("list")
	if err != nil {
		return
	}

	for _, app := range apps {
		for _, domain := range app.Domains {
			r := checkSSL(domain, app.Name)
			if r.Err != nil {
				continue
			}
			if r.Days <= 14 {
				log.Printf("ssl alert: %s expires in %d days", domain, r.Days)
				b.SendMessage(chatID, fmt.Sprintf("!! SSL: %s (%s) expires in %d days!",
					bot.Code(domain), bot.Bold(app.Name), r.Days))
			}
		}
	}
}
