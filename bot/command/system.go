package command

import (
	"fmt"
	"strings"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
	"fleet-bot/monitor"
)

// SysCmd implements /sys (aliases: docker, services).
type SysCmd struct{}

func (c *SysCmd) Name() string      { return "sys" }
func (c *SysCmd) Aliases() []string { return []string{"docker", "services"} }
func (c *SysCmd) Help() string      { return "Show system info, docker containers, or systemd services" }

func (c *SysCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	// Check if triggered via alias or with a subcommand
	subcommand := "sys"
	if len(args) > 0 {
		subcommand = strings.ToLower(args[0])
	} else if msg.Text != "" {
		// Determine from command name via message text
		text := strings.TrimPrefix(msg.Text, "/")
		if strings.HasPrefix(text, "docker") {
			subcommand = "docker"
		} else if strings.HasPrefix(text, "services") {
			subcommand = "services"
		}
	}

	switch subcommand {
	case "docker":
		return sysDocker()
	case "services":
		return sysServices()
	default:
		return sysOverview()
	}
}

func sysOverview() (adapter.OutboundMessage, error) {
	s := monitor.GetSystemStats()

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("System — %s\n\n", s.Hostname))
	sb.WriteString(fmt.Sprintf("Uptime: %s\n", s.Uptime))
	sb.WriteString(fmt.Sprintf("Load:   %.2f %.2f %.2f\n", s.LoadAvg1, s.LoadAvg5, s.LoadAvg15))
	sb.WriteString(fmt.Sprintf("CPU:    %.1f%%\n", s.CPUPercent))
	sb.WriteString(fmt.Sprintf("Memory: %s / %s (%.1f%%)\n",
		formatBytes(s.MemUsed), formatBytes(s.MemTotal), s.MemPercent))
	if s.SwapTotal > 0 {
		sb.WriteString(fmt.Sprintf("Swap:   %s / %s\n",
			formatBytes(s.SwapUsed), formatBytes(s.SwapTotal)))
	}
	sb.WriteString(fmt.Sprintf("Disk:   %s / %s (%.1f%%)\n",
		formatBytes(s.DiskUsed), formatBytes(s.DiskTotal), s.DiskPercent))

	sb.WriteString("\nSubcommands: docker, services")
	return adapter.OptionsResponse(sb.String(), []string{"docker", "services"}), nil
}

func sysDocker() (adapter.OutboundMessage, error) {
	containers, err := monitor.GetContainers()
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error: %s", err)), nil
	}
	if len(containers) == 0 {
		return adapter.TextResponse("No containers found."), nil
	}

	running := 0
	for _, c := range containers {
		if c.State == "running" {
			running++
		}
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Docker Containers (%d, %d running)\n\n", len(containers), running))

	for _, c := range containers {
		icon := "[??]"
		switch c.State {
		case "running":
			icon = "[OK]"
		case "exited", "dead":
			icon = "[XX]"
		}
		line := fmt.Sprintf("%s %s  %s", icon, c.Name, c.State)
		if c.Health != "" {
			line += fmt.Sprintf(" (%s)", c.Health)
		}
		if c.State == "running" {
			line += fmt.Sprintf("\n  CPU: %.1f%%  Mem: %s/%s  PIDs: %d",
				c.CPUPerc,
				formatBytes(c.MemUsed),
				formatBytes(c.MemMax),
				c.PIDs,
			)
		}
		sb.WriteString(line + "\n")
	}

	text := sb.String()
	if len(text) > 3800 {
		// Compact format
		var sb2 strings.Builder
		sb2.WriteString(fmt.Sprintf("Docker Containers (%d, %d running)\n\n", len(containers), running))
		for _, c := range containers {
			icon := "[??]"
			switch c.State {
			case "running":
				icon = "[OK]"
			case "exited", "dead":
				icon = "[XX]"
			}
			sb2.WriteString(fmt.Sprintf("%s %s  %s", icon, c.Name, c.State))
			if c.State == "running" {
				sb2.WriteString(fmt.Sprintf("  cpu:%.1f%%  mem:%s", c.CPUPerc, formatBytes(c.MemUsed)))
			}
			sb2.WriteString("\n")
		}
		text = sb2.String()
	}

	return adapter.TextResponse(text), nil
}

func sysServices() (adapter.OutboundMessage, error) {
	services := []string{"docker", "nginx", "truewaf", "fleet-bot", "docker-dash"}

	var sb strings.Builder
	sb.WriteString("Services\n\n")

	for _, svc := range services {
		res, err := exec.Run(5*time.Second, "systemctl", "is-active", svc)
		state := "unknown"
		if err == nil && res != nil {
			state = strings.TrimSpace(res.Stdout)
		} else if res != nil {
			state = strings.TrimSpace(res.Stdout)
		}
		icon := "[??]"
		if state == "active" {
			icon = "[OK]"
		} else if state == "inactive" || state == "failed" {
			icon = "[XX]"
		}
		sb.WriteString(fmt.Sprintf("%s %s: %s\n", icon, svc, state))
	}

	return adapter.TextResponse(sb.String()), nil
}
