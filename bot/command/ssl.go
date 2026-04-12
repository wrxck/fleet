package command

import (
	"crypto/tls"
	"fmt"
	"math"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// sslResult holds the certificate check result for one domain.
type sslResult struct {
	Domain string
	App    string
	Expiry time.Time
	Days   int
	Err    error
}

// SSLCmd implements /ssl.
type SSLCmd struct{}

func (c *SSLCmd) Name() string      { return "ssl" }
func (c *SSLCmd) Aliases() []string { return nil }
func (c *SSLCmd) Help() string      { return "Check SSL certificate expiry for all app domains" }

func (c *SSLCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	apps, err := exec.FleetJSON[[]listDataFull]("list")
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error fetching apps: %s", err)), nil
	}

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
		return adapter.TextResponse("No domains registered."), nil
	}

	var wg sync.WaitGroup
	results := make([]sslResult, len(domains))
	for i, da := range domains {
		wg.Add(1)
		go func(i int, domain, app string) {
			defer wg.Done()
			results[i] = checkSSLCert(domain, app)
		}(i, da.domain, da.app)
	}
	wg.Wait()

	sort.Slice(results, func(i, j int) bool {
		if results[i].Err != nil && results[j].Err == nil {
			return true
		}
		if results[i].Err == nil && results[j].Err != nil {
			return false
		}
		return results[i].Days < results[j].Days
	})

	var sb strings.Builder
	sb.WriteString("SSL Certificates\n\n")

	for _, r := range results {
		if r.Err != nil {
			sb.WriteString(fmt.Sprintf("[!!] %s (%s): %v\n", r.Domain, r.App, r.Err))
			continue
		}
		icon := "[OK]"
		if r.Days < 7 {
			icon = "[!!]"
		} else if r.Days < 14 {
			icon = "[~~]"
		}
		sb.WriteString(fmt.Sprintf("%s %s (%s): %dd left (%s)\n",
			icon, r.Domain, r.App, r.Days, r.Expiry.Format("Jan 2")))
	}

	return adapter.TextResponse(sb.String()), nil
}

func checkSSLCert(domain, app string) sslResult {
	conn, err := tls.DialWithDialer(
		&net.Dialer{Timeout: 5 * time.Second},
		"tcp", domain+":443",
		&tls.Config{InsecureSkipVerify: false},
	)
	if err != nil {
		return sslResult{Domain: domain, App: app, Err: err}
	}
	defer conn.Close()

	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return sslResult{Domain: domain, App: app, Err: fmt.Errorf("no certificates")}
	}

	expiry := certs[0].NotAfter
	days := int(math.Floor(time.Until(expiry).Hours() / 24))

	return sslResult{
		Domain: domain,
		App:    app,
		Expiry: expiry,
		Days:   days,
	}
}
