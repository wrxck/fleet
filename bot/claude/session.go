package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	DefaultModel    = "sonnet"
	DefaultMaxTurns = 50
	SessionTimeout  = 10 * time.Minute
	UpdateInterval  = 3 * time.Second
)

// claudeBin returns the path to the claude CLI binary.
// Uses CLAUDE_BIN env var if set, otherwise falls back to locating it via PATH.
func claudeBin() string {
	if s := os.Getenv("CLAUDE_BIN"); s != "" {
		return s
	}
	return "claude"
}

// defaultWorkDir returns the default working directory for Claude sessions.
// Uses HOME env var if set, otherwise "/root".
func defaultWorkDir() string {
	if h := os.Getenv("HOME"); h != "" {
		return h
	}
	return "/root"
}

// filteredEnv returns a minimal env slice for the claude subprocess. We avoid
// inheriting the bot's full environment because it contains secrets (telegram
// bot token, openai key, etc) which Claude Code has no business seeing — and
// because a prompt-injection vector reading env via a tool would otherwise
// exfiltrate those secrets verbatim. Only the keys an unprivileged process
// needs to function are passed through, plus FLEET_* vars used by fleet
// scripts the bot may invoke.
func filteredEnv() []string {
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

// StreamMsg represents a line from Claude Code --output-format stream-json.
type StreamMsg struct {
	Type      string  `json:"type"`
	Subtype   string  `json:"subtype,omitempty"`
	SessionID string  `json:"session_id,omitempty"`
	Result    string  `json:"result,omitempty"`
	CostUSD   float64 `json:"cost_usd,omitempty"`
	DurationMS int64  `json:"duration_ms,omitempty"`
	NumTurns  int     `json:"num_turns,omitempty"`
	Message   *struct {
		Role    string         `json:"role"`
		Content []ContentBlock `json:"content"`
	} `json:"message,omitempty"`
}

type ContentBlock struct {
	Type  string          `json:"type"`
	Text  string          `json:"text,omitempty"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
}

// RunResult is the outcome of a Claude Code execution.
type RunResult struct {
	Text       string
	SessionID  string
	CostUSD    float64
	DurationMS int64
	NumTurns   int
	ToolCalls  int
}

const MaxHistory = 20

// Session manages a persistent Claude Code conversation.
type Session struct {
	mu        sync.Mutex
	sessionID string
	workDir   string
	model     string
	cancel    context.CancelFunc
	running   bool
	history   []string
}

func NewSession() *Session {
	return &Session{
		workDir: defaultWorkDir(),
		model:   DefaultModel,
	}
}

// LastPrompt returns the most recent prompt, or "".
func (s *Session) LastPrompt() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.history) == 0 {
		return ""
	}
	return s.history[len(s.history)-1]
}

// History returns up to the last N prompts (newest last).
func (s *Session) History() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]string, len(s.history))
	copy(cp, s.history)
	return cp
}

func (s *Session) addHistory(prompt string) {
	s.history = append(s.history, prompt)
	if len(s.history) > MaxHistory {
		s.history = s.history[len(s.history)-MaxHistory:]
	}
}

func (s *Session) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

func (s *Session) WorkDir() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.workDir
}

func (s *Session) SetWorkDir(dir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.workDir = dir
}

func (s *Session) Model() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.model
}

func (s *Session) SetModel(model string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.model = model
}

func (s *Session) SessionID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessionID
}

func (s *Session) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessionID = ""
}

func (s *Session) SetSessionID(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessionID = id
}

// Stop cancels the running Claude process. Returns true if something was stopped.
func (s *Session) Stop() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
		return true
	}
	return false
}

// StatusUpdate is sent as Claude works.
type StatusUpdate struct {
	ToolName  string
	Detail    string
	ToolCount int
}

// Run executes a Claude Code prompt. Blocks until completion.
// onUpdate is called (from this goroutine) with tool-use status updates.
func (s *Session) Run(prompt string, onUpdate func(StatusUpdate)) (*RunResult, error) {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return nil, fmt.Errorf("already running — use /cc_stop first")
	}
	s.running = true
	s.addHistory(prompt)
	sessionID := s.sessionID
	workDir := s.workDir
	model := s.model
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.running = false
		s.cancel = nil
		s.mu.Unlock()
	}()

	args := []string{
		"-p", prompt,
		"--output-format", "stream-json",
		"--verbose",
		"--model", model,
		"--max-turns", fmt.Sprintf("%d", DefaultMaxTurns),
		// Bot exposes Claude Code via Telegram/iMessage chat. We default to
		// read-only tools so a chat user (or prompt-injection vector) cannot
		// escalate to host writes. Power users can extend via fleet-guard
		// approval (TODO).
		"--allowed-tools", "Read,Glob,Grep,WebSearch,WebFetch",
		"--disallowed-tools", "Bash,Write,Edit,NotebookEdit",
		"--append-system-prompt", "You are being controlled via a Telegram bot. Keep your final response concise — summarise what you did rather than showing full file contents. The user is an experienced developer.",
	}
	if sessionID != "" {
		args = append(args, "--resume", sessionID)
	}

	ctx, cancel := context.WithTimeout(context.Background(), SessionTimeout)
	s.mu.Lock()
	s.cancel = cancel
	s.mu.Unlock()
	defer cancel()

	cmd := exec.CommandContext(ctx, claudeBin(), args...)
	cmd.Dir = workDir
	cmd.Env = filteredEnv()

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("pipe: %w", err)
	}

	stderr := &strings.Builder{}
	cmd.Stderr = stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start claude: %w", err)
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 10*1024*1024), 10*1024*1024) // 10MB for big tool results

	result := &RunResult{}
	var lastAssistantText string

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var msg StreamMsg
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "system":
			if msg.SessionID != "" {
				s.mu.Lock()
				s.sessionID = msg.SessionID
				s.mu.Unlock()
				result.SessionID = msg.SessionID
			}

		case "assistant":
			if msg.Message == nil {
				continue
			}
			for _, block := range msg.Message.Content {
				switch block.Type {
				case "text":
					if block.Text != "" {
						lastAssistantText = block.Text
					}
				case "tool_use":
					result.ToolCalls++
					if onUpdate != nil {
						onUpdate(StatusUpdate{
							ToolName:  block.Name,
							Detail:    toolDetail(block.Name, block.Input),
							ToolCount: result.ToolCalls,
						})
					}
				}
			}

		case "result":
			if msg.SessionID != "" {
				s.mu.Lock()
				s.sessionID = msg.SessionID
				s.mu.Unlock()
				result.SessionID = msg.SessionID
			}
			if msg.Result != "" {
				result.Text = msg.Result
			}
			result.CostUSD = msg.CostUSD
			result.DurationMS = msg.DurationMS
			result.NumTurns = msg.NumTurns
		}
	}

	cmdErr := cmd.Wait()

	if ctx.Err() == context.DeadlineExceeded {
		return result, fmt.Errorf("timed out after %v", SessionTimeout)
	}
	if ctx.Err() == context.Canceled {
		return result, fmt.Errorf("cancelled")
	}

	// Fall back to accumulated text if result field was empty
	if result.Text == "" {
		result.Text = lastAssistantText
	}

	if cmdErr != nil && result.Text == "" {
		errStr := stderr.String()
		if errStr != "" {
			return result, fmt.Errorf("claude exited with error:\n%s", errStr)
		}
		return result, fmt.Errorf("claude exited: %w", cmdErr)
	}

	return result, nil
}

func toolDetail(name string, input json.RawMessage) string {
	var m map[string]interface{}
	json.Unmarshal(input, &m)

	switch name {
	case "Read":
		if p, ok := m["file_path"].(string); ok {
			return shortenPath(p)
		}
	case "Write":
		if p, ok := m["file_path"].(string); ok {
			return shortenPath(p)
		}
	case "Edit":
		if p, ok := m["file_path"].(string); ok {
			return shortenPath(p)
		}
	case "Bash":
		if c, ok := m["command"].(string); ok {
			if len(c) > 80 {
				c = c[:80] + "..."
			}
			return c
		}
	case "Glob":
		if p, ok := m["pattern"].(string); ok {
			return p
		}
	case "Grep":
		if p, ok := m["pattern"].(string); ok {
			return p
		}
	case "WebSearch":
		if q, ok := m["query"].(string); ok {
			return q
		}
	case "Task":
		if d, ok := m["description"].(string); ok {
			return d
		}
	}
	return ""
}

func shortenPath(path string) string {
	parts := strings.Split(path, "/")
	if len(parts) > 3 {
		return ".../" + strings.Join(parts[len(parts)-2:], "/")
	}
	return path
}
