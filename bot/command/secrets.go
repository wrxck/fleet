package command

import (
	"encoding/json"
	"fmt"
	"strings"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// SecretsCmd implements /secrets.
type SecretsCmd struct{}

func (c *SecretsCmd) Name() string      { return "secrets" }
func (c *SecretsCmd) Aliases() []string { return nil }
func (c *SecretsCmd) Help() string      { return "Manage fleet secrets vault" }

func (c *SecretsCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return secretsStatus()
	}

	subcommand := strings.ToLower(args[0])
	rest := args[1:]

	switch subcommand {
	case "status":
		return secretsStatus()
	case "list":
		app := ""
		if len(rest) > 0 {
			app = rest[0]
		}
		return secretsList(app)
	case "validate":
		app := ""
		if len(rest) > 0 {
			app = rest[0]
		}
		return secretsValidate(app)
	case "get":
		if len(rest) < 2 {
			return adapter.TextResponse("Usage: /secrets get <app> <key>"), nil
		}
		return secretsGet(rest[0], rest[1])
	case "set":
		if len(rest) < 3 {
			return adapter.TextResponse("Usage: /secrets set <app> <key> <value>"), nil
		}
		return secretsSet(rest[0], rest[1], rest[2])
	case "seal":
		app := ""
		if len(rest) > 0 {
			app = rest[0]
		}
		return secretsSeal(app)
	case "drift":
		app := ""
		if len(rest) > 0 {
			app = rest[0]
		}
		return secretsDrift(app)
	default:
		return adapter.TextResponse("Usage: /secrets [status|list|validate|get|set|seal|drift] [app] [key] [value]"), nil
	}
}

func secretsStatus() (adapter.OutboundMessage, error) {
	res, err := exec.FleetRead("secrets", "status", "--json")
	if err != nil {
		msg := "Error fetching secrets status"
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
		return adapter.TextResponse("Secrets Vault\n" + output), nil
	}

	formatted, _ := json.MarshalIndent(data, "", "  ")
	output := string(formatted)
	if len(output) > 3800 {
		output = output[:3800] + "..."
	}
	return adapter.TextResponse(fmt.Sprintf("Secrets Vault\n%s", output)), nil
}

func secretsList(app string) (adapter.OutboundMessage, error) {
	cmdArgs := []string{"secrets", "list"}
	if app != "" {
		cmdArgs = append(cmdArgs, app)
	}
	cmdArgs = append(cmdArgs, "--json")

	res, err := exec.FleetRead(cmdArgs...)
	if err != nil {
		msg := "Error listing secrets"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}

	output := res.Stdout
	if output == "" {
		output = "(no secrets)"
	}
	if len(output) > 3800 {
		output = output[:3800] + "..."
	}
	return adapter.TextResponse(fmt.Sprintf("Secrets\n%s", output)), nil
}

func secretsValidate(app string) (adapter.OutboundMessage, error) {
	cmdArgs := []string{"secrets", "validate"}
	if app != "" {
		cmdArgs = append(cmdArgs, app)
	}
	cmdArgs = append(cmdArgs, "--json")

	res, err := exec.FleetRead(cmdArgs...)
	if err != nil {
		msg := "Error validating secrets"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}

	output := res.Stdout
	if output == "" {
		output = "(no output)"
	}
	if len(output) > 3800 {
		output = output[:3800] + "..."
	}
	return adapter.TextResponse(fmt.Sprintf("Secrets Validation\n%s", output)), nil
}

func secretsGet(app, key string) (adapter.OutboundMessage, error) {
	res, err := exec.FleetRead("secrets", "get", app, key)
	if err != nil {
		msg := fmt.Sprintf("Error getting secret %s/%s", app, key)
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}
	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = "(empty)"
	}
	return adapter.TextResponse(fmt.Sprintf("%s/%s: %s", app, key, output)), nil
}

func secretsSet(app, key, value string) (adapter.OutboundMessage, error) {
	res, err := exec.FleetMutate("secrets", "set", app, key, value)
	if err != nil {
		msg := fmt.Sprintf("Error setting secret %s/%s", app, key)
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}
	return adapter.TextResponse(fmt.Sprintf("Set %s/%s.", app, key)), nil
}

func secretsSeal(app string) (adapter.OutboundMessage, error) {
	cmdArgs := []string{"secrets", "seal"}
	if app != "" {
		cmdArgs = append(cmdArgs, app)
	}
	res, err := exec.FleetMutate(cmdArgs...)
	if err != nil {
		msg := "Error sealing secrets"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}
	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = "Sealed."
	}
	return adapter.TextResponse(output), nil
}

func secretsDrift(app string) (adapter.OutboundMessage, error) {
	cmdArgs := []string{"secrets", "drift"}
	if app != "" {
		cmdArgs = append(cmdArgs, app)
	}
	cmdArgs = append(cmdArgs, "--json")
	res, err := exec.FleetRead(cmdArgs...)
	if err != nil {
		msg := "Error checking drift"
		if res != nil && res.Stderr != "" {
			msg += "\n" + res.Stderr
		}
		return adapter.TextResponse(msg), nil
	}
	output := strings.TrimSpace(res.Stdout)
	if output == "" {
		output = "(no drift)"
	}
	if len(output) > 3800 {
		output = output[:3800] + "..."
	}
	return adapter.TextResponse(fmt.Sprintf("Secrets Drift\n%s", output)), nil
}
