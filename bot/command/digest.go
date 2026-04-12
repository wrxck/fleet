package command

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
	"fleet-bot/monitor"
)

// digestStatusResponse matches fleet status --json.
type digestStatusResponse struct {
	Apps []digestApp `json:"apps"`
}

type digestApp struct {
	Name   string `json:"name"`
	Health string `json:"health"`
}

// DigestCmd implements /digest.
type DigestCmd struct{}

func (c *DigestCmd) Name() string      { return "digest" }
func (c *DigestCmd) Aliases() []string { return nil }
func (c *DigestCmd) Help() string      { return "Show daily digest summary of system and fleet health" }

func (c *DigestCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Daily Digest — %s\n\n", time.Now().Format("Mon Jan 2")))

	// System stats
	sys := monitor.GetSystemStats()
	sb.WriteString("System\n")
	sb.WriteString(fmt.Sprintf("  CPU: %.1f%% | Mem: %s/%s | Disk: %s/%s\n",
		sys.CPUPercent,
		formatBytes(sys.MemUsed), formatBytes(sys.MemTotal),
		formatBytes(sys.DiskUsed), formatBytes(sys.DiskTotal)))
	sb.WriteString(fmt.Sprintf("  Load: %.2f %.2f %.2f | Up: %s\n\n",
		sys.LoadAvg1, sys.LoadAvg5, sys.LoadAvg15, sys.Uptime))

	// Fleet status
	resp, err := exec.FleetJSON[digestStatusResponse]("status")
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
		sb.WriteString("Fleet\n")
		sb.WriteString(fmt.Sprintf("  %d healthy, %d down\n", healthy, down))
		if len(downApps) > 0 {
			sort.Strings(downApps)
			sb.WriteString(fmt.Sprintf("  Down: %s\n", strings.Join(downApps, ", ")))
		}
		sb.WriteString("\n")
	} else {
		sb.WriteString(fmt.Sprintf("Fleet: error (%s)\n\n", err))
	}

	// Docker containers
	containers, err := monitor.GetContainers()
	if err == nil {
		running := 0
		for _, c := range containers {
			if c.State == "running" {
				running++
			}
		}
		sb.WriteString(fmt.Sprintf("Docker: %d containers, %d running\n\n", len(containers), running))
	}

	// SSL quick check
	apps, err := exec.FleetJSON[[]listDataFull]("list")
	if err == nil {
		expiring := 0
		for _, app := range apps {
			for _, domain := range app.Domains {
				r := checkSSLCert(domain, app.Name)
				if r.Err == nil && r.Days <= 14 {
					expiring++
					sb.WriteString(fmt.Sprintf("[!!] SSL: %s expires in %d days\n", domain, r.Days))
				}
			}
		}
		if expiring == 0 {
			sb.WriteString("SSL: all certs OK\n")
		}
	}

	return adapter.TextResponse(sb.String()), nil
}

func formatBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%dB", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%cB", float64(b)/float64(div), "KMGTPE"[exp])
}
