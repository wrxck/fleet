package command

import (
	"fmt"
	"strconv"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/waf"
)

// WAFCmd implements /waf.
type WAFCmd struct{}

func (c *WAFCmd) Name() string      { return "waf" }
func (c *WAFCmd) Aliases() []string { return nil }
func (c *WAFCmd) Help() string      { return "Show WAF status, whitelist, or tail logs" }

func (c *WAFCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	subcommand := ""
	if len(args) > 0 {
		subcommand = strings.ToLower(args[0])
	}

	switch subcommand {
	case "whitelist":
		return wafWhitelist()
	case "logs":
		n := 30
		if len(args) > 1 {
			if parsed, err := strconv.Atoi(args[1]); err == nil && parsed > 0 {
				n = parsed
			}
		}
		return wafLogs(n)
	case "whitelist_add":
		if len(args) < 2 {
			return adapter.TextResponse("Usage: /waf whitelist_add <ip>"), nil
		}
		ip := args[1]
		if err := waf.AddWhitelistIP(ip); err != nil {
			return adapter.TextResponse(fmt.Sprintf("Error: %s", err)), nil
		}
		return adapter.TextResponse(fmt.Sprintf("Added %s to whitelist and reloaded WAF.", ip)), nil
	case "whitelist_rm":
		if len(args) < 2 {
			return adapter.TextResponse("Usage: /waf whitelist_rm <ip>"), nil
		}
		ip := args[1]
		if err := waf.RemoveWhitelistIP(ip); err != nil {
			return adapter.TextResponse(fmt.Sprintf("Error: %s", err)), nil
		}
		return adapter.TextResponse(fmt.Sprintf("Removed %s from whitelist and reloaded WAF.", ip)), nil
	case "rate":
		if len(args) < 3 {
			return adapter.TextResponse("Usage: /waf rate <rps> <burst>"), nil
		}
		rps, err := strconv.Atoi(args[1])
		if err != nil {
			return adapter.TextResponse(fmt.Sprintf("Invalid rps: %s", args[1])), nil
		}
		burst, err := strconv.Atoi(args[2])
		if err != nil {
			return adapter.TextResponse(fmt.Sprintf("Invalid burst: %s", args[2])), nil
		}
		if err := waf.SetRateLimit(rps, burst); err != nil {
			return adapter.TextResponse(fmt.Sprintf("Error: %s", err)), nil
		}
		return adapter.TextResponse(fmt.Sprintf("Rate limit updated to %d req/s, burst %d. WAF reloaded.", rps, burst)), nil
	default:
		return wafStatus()
	}
}

func wafStatus() (adapter.OutboundMessage, error) {
	cfg, err := waf.Read()
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error reading WAF config: %s", err)), nil
	}

	active := strings.TrimSpace(waf.IsActive())

	var sb strings.Builder
	sb.WriteString("TrueWAF\n\n")
	sb.WriteString(fmt.Sprintf("Service: %s\n", active))
	sb.WriteString(fmt.Sprintf("Mode: %s\n", cfg.Mode))
	sb.WriteString(fmt.Sprintf("Log level: %s\n", cfg.LogLevel))
	sb.WriteString(fmt.Sprintf("Proxy: %s:%d -> %s:%d\n",
		cfg.Proxy.ListenAddress, cfg.Proxy.ListenPort,
		cfg.Proxy.BackendAddress, cfg.Proxy.BackendPort))
	sb.WriteString(fmt.Sprintf("Workers: %d, Max conns: %d\n",
		cfg.Proxy.WorkerThreads, cfg.Proxy.MaxConnections))
	sb.WriteString(fmt.Sprintf("\nRate limit: %s\n", boolEnabled(cfg.RateLimit.Enabled)))
	if cfg.RateLimit.Enabled {
		sb.WriteString(fmt.Sprintf("  %d req/s, burst: %d, block: %ds\n",
			cfg.RateLimit.RequestsPerSecond,
			cfg.RateLimit.BurstSize,
			cfg.RateLimit.BlockDurationSeconds))
	}
	sb.WriteString(fmt.Sprintf("\nWhitelist: %d IPs, %d paths\n\n", len(cfg.Whitelist.IPs), len(cfg.Whitelist.Paths)))
	sb.WriteString("Subcommands: whitelist, logs [n], whitelist_add <ip>, whitelist_rm <ip>, rate <rps> <burst>")

	return adapter.TextResponse(sb.String()), nil
}

func wafWhitelist() (adapter.OutboundMessage, error) {
	cfg, err := waf.Read()
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error: %s", err)), nil
	}

	var sb strings.Builder
	sb.WriteString("WAF Whitelist\n\n")
	sb.WriteString("Paths:\n")
	if len(cfg.Whitelist.Paths) == 0 {
		sb.WriteString("  (none)\n")
	}
	for _, p := range cfg.Whitelist.Paths {
		sb.WriteString(fmt.Sprintf("  %s\n", p))
	}
	sb.WriteString("\nIPs:\n")
	if len(cfg.Whitelist.IPs) == 0 {
		sb.WriteString("  (none)\n")
	}
	for _, ip := range cfg.Whitelist.IPs {
		sb.WriteString(fmt.Sprintf("  %s\n", ip))
	}

	return adapter.TextResponse(sb.String()), nil
}

func wafLogs(n int) (adapter.OutboundMessage, error) {
	output, err := waf.TailLog(n)
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error: %s", err)), nil
	}
	if output == "" {
		output = "(empty)"
	}
	if len(output) > 3800 {
		output = output[len(output)-3800:]
	}
	return adapter.TextResponse(fmt.Sprintf("WAF Log (last %d lines):\n%s", n, output)), nil
}

func boolEnabled(b bool) string {
	if b {
		return "enabled"
	}
	return "disabled"
}
