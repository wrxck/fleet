package command

import (
	"bytes"
	"context"
	"fmt"
	"os"
	osexec "os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// claudeFilteredEnv mirrors claude.filteredEnv: a minimal allowlist of env
// vars passed to the claude subprocess. The bot inherits secrets like the
// telegram bot token and openai key — none of which the claude CLI needs.
// Restricting the surface stops a prompt-injection vector from exfiltrating
// those secrets via tool calls.
func claudeFilteredEnv() []string {
	keep := map[string]bool{
		"PATH": true, "HOME": true, "USER": true, "LANG": true, "LC_ALL": true,
		"TERM": true, "TZ": true,
		"CLAUDE_BIN": true, "FLEET_SCRIPT": true, "ANTHROPIC_API_KEY": true,
	}
	out := []string{}
	for _, e := range os.Environ() {
		eq := strings.IndexByte(e, '=')
		if eq < 0 {
			continue
		}
		key := e[:eq]
		if keep[key] {
			out = append(out, e)
			continue
		}
		if strings.HasPrefix(key, "FLEET_") {
			out = append(out, e)
		}
	}
	return out
}

func claudeProjectsDir() string {
	if h := os.Getenv("HOME"); h != "" {
		return h + "/.claude/projects"
	}
	return "/root/.claude/projects"
}

// claudeSession holds minimal session info for listing.
type claudeSession struct {
	ID        string
	Dir       string
	UpdatedAt time.Time
}

// ClaudeCmd implements /claude (alias: cc).
type ClaudeCmd struct{}

func (c *ClaudeCmd) Name() string      { return "claude" }
func (c *ClaudeCmd) Aliases() []string { return []string{"cc"} }
func (c *ClaudeCmd) Help() string      { return "Run Claude Code or manage sessions" }

func (c *ClaudeCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	if len(args) == 0 {
		return claudeStatus()
	}

	subcommand := strings.ToLower(args[0])
	rest := args[1:]

	switch subcommand {
	case "sessions", "list":
		return claudeSessions()
	case "run":
		if len(rest) == 0 {
			return adapter.TextResponse("Usage: /claude run <prompt>"), nil
		}
		prompt := strings.Join(rest, " ")
		return claudeRun(prompt, "")
	case "stop":
		return claudeStop()
	case "status":
		return claudeStatus()
	case "model":
		if len(rest) == 0 {
			return adapter.TextResponse("Usage: /claude model <sonnet|opus|haiku>"), nil
		}
		return adapter.TextResponse(fmt.Sprintf("Model preference noted: %s\n(Full model switching requires active session integration.)", rest[0])), nil
	default:
		// Treat args as a prompt
		prompt := strings.Join(args, " ")
		return claudeRun(prompt, "")
	}
}

func claudeStatus() (adapter.OutboundMessage, error) {
	var sb strings.Builder
	sb.WriteString("Claude Code\n\n")

	// Check if claude CLI is available
	res, err := exec.Run(5*time.Second, "which", "claude")
	if err != nil || (res != nil && strings.TrimSpace(res.Stdout) == "") {
		sb.WriteString("Status: claude CLI not found\n\n")
	} else {
		sb.WriteString("Status: idle\n")
		sb.WriteString(fmt.Sprintf("CLI: %s\n\n", strings.TrimSpace(res.Stdout)))
	}

	sessions := findClaudeSessions(3)
	if len(sessions) > 0 {
		sb.WriteString("Recent sessions:\n")
		for i, s := range sessions {
			ago := time.Since(s.UpdatedAt).Round(time.Minute)
			dir := s.Dir
			if len(dir) > 40 {
				dir = "..." + dir[len(dir)-37:]
			}
			sb.WriteString(fmt.Sprintf("  %d. %s  %s ago  %s\n", i+1, s.ID[:8], ago, dir))
		}
	}

	sb.WriteString("\nSubcommands: run <prompt>, sessions, stop, status, model <name>")
	return adapter.TextResponse(sb.String()), nil
}

func claudeRun(prompt, workDir string) (adapter.OutboundMessage, error) {
	if workDir == "" {
		if h := os.Getenv("HOME"); h != "" {
			workDir = h
		} else {
			workDir = "/root"
		}
	}

	// Bot exposes Claude Code via Telegram/iMessage chat. We default to
	// read-only tools so a chat user (or prompt-injection vector) cannot
	// escalate to host writes. Power users can extend via fleet-guard
	// approval (TODO).
	cmdArgs := []string{
		"--print",
		"--output-format", "text",
		"--allowed-tools", "Read,Glob,Grep,WebSearch,WebFetch",
		"--disallowed-tools", "Bash,Write,Edit,NotebookEdit",
		prompt,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	cmd := osexec.CommandContext(ctx, "claude", cmdArgs...)
	cmd.Dir = workDir
	cmd.Env = claudeFilteredEnv()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	stdoutStr := exec.StripANSI(stdout.String())
	stderrStr := exec.StripANSI(stderr.String())

	if ctx.Err() == context.DeadlineExceeded {
		runErr = fmt.Errorf("command timed out")
	}

	if runErr != nil {
		detail := ""
		if stderrStr != "" {
			detail = "\n" + stderrStr
		} else if stdoutStr != "" {
			detail = "\n" + stdoutStr
		}
		return adapter.TextResponse(fmt.Sprintf("Claude error: %s%s", runErr, detail)), nil
	}

	output := strings.TrimSpace(stdoutStr)
	if output == "" {
		output = "(no output)"
	}
	if len(output) > 3800 {
		output = output[len(output)-3800:]
	}

	return adapter.TextResponse(output), nil
}

func claudeStop() (adapter.OutboundMessage, error) {
	res, err := exec.Run(5*time.Second, "pkill", "-f", "claude")
	if err != nil {
		if res != nil && res.ExitCode == 1 {
			return adapter.TextResponse("No Claude process running."), nil
		}
		return adapter.TextResponse(fmt.Sprintf("Error: %s", err)), nil
	}
	return adapter.TextResponse("Stopped Claude process."), nil
}

func claudeSessions() (adapter.OutboundMessage, error) {
	sessions := findClaudeSessions(10)
	if len(sessions) == 0 {
		return adapter.TextResponse("No recent Claude sessions found."), nil
	}

	var sb strings.Builder
	sb.WriteString("Recent Claude Sessions\n\n")

	options := make([]string, 0, len(sessions))
	for i, s := range sessions {
		ago := time.Since(s.UpdatedAt).Round(time.Minute)
		dir := s.Dir
		if len(dir) > 30 {
			dir = "..." + dir[len(dir)-27:]
		}
		sb.WriteString(fmt.Sprintf("%d. %s  %s ago\n   %s\n", i+1, s.ID[:8], ago, dir))
		options = append(options, fmt.Sprintf("%s (%s)", s.ID[:8], dir))
	}

	return adapter.OptionsResponse(sb.String(), options), nil
}

func findClaudeSessions(limit int) []claudeSession {
	var sessions []claudeSession

	projectsDir := claudeProjectsDir()
	projectDirs, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil
	}

	for _, pd := range projectDirs {
		if !pd.IsDir() {
			continue
		}

		dir := "/" + strings.ReplaceAll(pd.Name(), "-", "/")
		sessDir := filepath.Join(projectsDir, pd.Name())

		entries, err := os.ReadDir(sessDir)
		if err != nil {
			continue
		}

		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".jsonl") {
				continue
			}
			sessID := strings.TrimSuffix(e.Name(), ".jsonl")
			info, err := e.Info()
			if err != nil {
				continue
			}
			sessions = append(sessions, claudeSession{
				ID:        sessID,
				Dir:       dir,
				UpdatedAt: info.ModTime(),
			})
		}
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt.After(sessions[j].UpdatedAt)
	})

	if len(sessions) > limit {
		sessions = sessions[:limit]
	}
	return sessions
}
