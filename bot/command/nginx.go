package command

import (
	"encoding/json"
	"fmt"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// NginxCmd implements /nginx.
type NginxCmd struct{}

func (c *NginxCmd) Name() string      { return "nginx" }
func (c *NginxCmd) Aliases() []string { return nil }
func (c *NginxCmd) Help() string      { return "Show or manage nginx configuration" }

func (c *NginxCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return nginxList()
	}

	subcommand := strings.ToLower(args[0])
	rest := args[1:]

	switch subcommand {
	case "list":
		return nginxList()
	case "reload":
		return nginxReload()
	case "test":
		return nginxTest()
	case "add":
		if len(rest) == 0 {
			return adapter.TextResponse("Usage: /nginx add <app>"), nil
		}
		return nginxAdd(rest[0])
	default:
		return nginxList()
	}
}

func nginxList() (adapter.OutboundMessage, error) {
	res, err := exec.FleetRead("nginx", "list", "--json")
	if err != nil {
		msg := "Error fetching nginx config"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}

	var data interface{}
	if err := json.Unmarshal([]byte(res.Stdout), &data); err != nil {
		output := res.Stdout
		if len(output) > 3800 {
			output = output[:3800] + "..."
		}
		return adapter.TextResponse(fmt.Sprintf("Nginx Configs\n%s", output)), nil
	}

	formatted, _ := json.MarshalIndent(data, "", "  ")
	output := string(formatted)
	if len(output) > 3800 {
		output = output[:3800] + "..."
	}
	return adapter.TextResponse(fmt.Sprintf("Nginx Configs\n%s", output)), nil
}

func nginxReload() (adapter.OutboundMessage, error) {
	res, err := exec.FleetMutate("nginx", "reload")
	if err != nil {
		msg := "Error reloading nginx"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}
	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = "Nginx reloaded."
	}
	return adapter.TextResponse(output), nil
}

func nginxTest() (adapter.OutboundMessage, error) {
	res, err := exec.FleetRead("nginx", "test")
	if err != nil {
		msg := "Nginx config test failed"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}
	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = "Nginx config OK."
	}
	return adapter.TextResponse(output), nil
}

func nginxAdd(app string) (adapter.OutboundMessage, error) {
	res, err := exec.FleetMutate("nginx", "add", app)
	if err != nil {
		msg := fmt.Sprintf("Error adding nginx config for %s", app)
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}
	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = fmt.Sprintf("Added nginx config for %s.", app)
	}
	return adapter.TextResponse(output), nil
}
