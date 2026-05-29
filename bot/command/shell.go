package command

import (
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

const shellTimeout = 30 * time.Second

// dangerousPattern matches commands that should require explicit --force
// before running. these are operations that can take the host offline,
// delete data, or hand control to a third party. the list is conservative
// — false positives mean the operator types --force, false negatives mean
// a misclick takes the box down.
var dangerousPattern = regexp.MustCompile(
	`(?:^|[^a-zA-Z0-9_-])(` +
		`rm|rmdir|mv|dd|mkfs|fdisk|parted|wipefs|` +
		`kill|killall|pkill|halt|shutdown|reboot|poweroff|` +
		`systemctl|service|init|telinit|` +
		`chmod|chown|chgrp|setfacl|` +
		`iptables|nft|ufw|firewall-cmd|` +
		`docker|docker-compose|podman|` +
		`curl|wget|nc|ncat|socat|ssh|scp|rsync` +
		`)(?:$|[^a-zA-Z0-9_-])`,
)

// redirectionPattern matches shell redirection / piping that can write,
// truncate, or pipe into another tool. shell.go uses bash -c so > >> < |
// are interpreted by the shell.
var redirectionPattern = regexp.MustCompile(`[>|&]`)

// ShellCmd implements /shell (alias: sh).
type ShellCmd struct{}

func (c *ShellCmd) Name() string      { return "shell" }
func (c *ShellCmd) Aliases() []string { return []string{"sh"} }
func (c *ShellCmd) Help() string {
	return "Run a shell command on the host. Add --force for destructive ops (rm, kill, systemctl, redirects, etc.)"
}

// isDangerous reports whether the command should be gated behind --force.
func isDangerous(cmd string) bool {
	return dangerousPattern.MatchString(cmd) || redirectionPattern.MatchString(cmd)
}

func (c *ShellCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return adapter.TextResponse("Usage: /sh [--force] <command>\nRuns a shell command on the host. --force is required for destructive operations."), nil
	}

	// strip a leading --force flag and remember whether it was set.
	forced := false
	if args[0] == "--force" {
		forced = true
		args = args[1:]
		if len(args) == 0 {
			return adapter.TextResponse("Usage: /sh --force <command>"), nil
		}
	}

	command := strings.Join(args, " ")

	// every invocation, forced or not, gets a structured audit line. log
	// goes to stderr -> journald via the bot's systemd unit. captures the
	// sender so a post-incident timeline can attribute commands.
	log.Printf("audit shell sender=%q forced=%t cmd=%q", msg.SenderID, forced, command)

	if !forced && isDangerous(command) {
		return adapter.TextResponse(fmt.Sprintf(
			"Refusing to run a destructive command without --force.\n\n"+
				"Command: %s\n\n"+
				"If you really mean to run it, retry with:\n"+
				"  /sh --force %s",
			command, command,
		)), nil
	}

	res, err := exec.Run(shellTimeout, "bash", "-c", command)

	output := ""
	if res != nil {
		output = res.Stdout
		if res.Stderr != "" {
			if output != "" {
				output += "\n"
			}
			output += res.Stderr
		}
	}

	if output == "" {
		output = "(no output)"
	}
	if len(output) > 3800 {
		output = output[len(output)-3800:]
	}

	if err != nil {
		exitCode := -1
		if res != nil {
			exitCode = res.ExitCode
		}
		return adapter.TextResponse(fmt.Sprintf("Exit %d:\n%s", exitCode, output)), nil
	}

	return adapter.TextResponse(output), nil
}
