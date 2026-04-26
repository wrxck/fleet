package command

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"fleet-bot/adapter"
	"fleet-bot/exec"
)

// DepsCmd implements /deps.
//
// summary mode (no args):
//   runs `fleet deps --json`, groups findings by app, shows top apps by
//   severity with one-tap "fix <app>" buttons for those with fixable
//   findings.
//
// fix mode (`/deps fix <app>` or button click):
//   runs `fleet deps fix <app>` which creates a github pr with the
//   updates. returns the (truncated) output as a follow-up message.
type DepsCmd struct{}

func (c *DepsCmd) Name() string      { return "deps" }
func (c *DepsCmd) Aliases() []string { return nil }
func (c *DepsCmd) Help() string {
	return "Show dependency health (outdated/CVE/EOL). One-tap fix per app."
}

// finding mirrors the relevant fields from `fleet deps --json`'s findings array.
type depsFinding struct {
	AppName  string `json:"appName"`
	Severity string `json:"severity"`
	Fixable  bool   `json:"fixable"`
}

type depsReport struct {
	LastScan string        `json:"lastScan"`
	Findings []depsFinding `json:"findings"`
}

type appCounts struct {
	app                                  string
	crit, high, med, low, fixableHighCrit int
}

func (c *DepsCmd) Execute(msg adapter.InboundMessage, args []string) (adapter.OutboundMessage, error) {
	// fix mode: the first arg looks like "fix <app>" (typed) or "fix:<app>"
	// (button-callback form). also accept just "<app>" if it matches a known
	// fixable app — we render buttons as "fix <app>" so users get both paths.
	if len(args) >= 1 {
		first := args[0]
		if first == "fix" && len(args) >= 2 {
			return runDepsFix(args[1])
		}
		if strings.HasPrefix(first, "fix ") {
			return runDepsFix(strings.TrimSpace(strings.TrimPrefix(first, "fix ")))
		}
	}

	report, err := exec.FleetJSON[depsReport]("deps")
	if err != nil {
		return adapter.TextResponse(fmt.Sprintf("Error fetching deps report: %s", err)), nil
	}

	if len(report.Findings) == 0 {
		return adapter.TextResponse("No dependency findings."), nil
	}

	byApp := make(map[string]*appCounts)
	for _, f := range report.Findings {
		c, ok := byApp[f.AppName]
		if !ok {
			c = &appCounts{app: f.AppName}
			byApp[f.AppName] = c
		}
		switch f.Severity {
		case "critical":
			c.crit++
		case "high":
			c.high++
		case "medium":
			c.med++
		case "low":
			c.low++
		}
		if f.Fixable && (f.Severity == "critical" || f.Severity == "high") {
			c.fixableHighCrit++
		}
	}

	rows := make([]*appCounts, 0, len(byApp))
	for _, c := range byApp {
		rows = append(rows, c)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].crit != rows[j].crit {
			return rows[i].crit > rows[j].crit
		}
		if rows[i].high != rows[j].high {
			return rows[i].high > rows[j].high
		}
		return rows[i].med > rows[j].med
	})

	var sb strings.Builder
	sb.WriteString("Dependency Health\n\n")
	if report.LastScan != "" {
		sb.WriteString(fmt.Sprintf("scanned: %s\n\n", report.LastScan))
	}

	for i, r := range rows {
		if i >= 10 {
			sb.WriteString(fmt.Sprintf("...and %d more apps\n", len(rows)-10))
			break
		}
		sb.WriteString(fmt.Sprintf("%s — crit=%d high=%d med=%d low=%d\n",
			r.app, r.crit, r.high, r.med, r.low))
	}

	// build buttons for top apps with fixable high/critical findings
	options := make([]string, 0, 5)
	for _, r := range rows {
		if r.fixableHighCrit == 0 {
			continue
		}
		options = append(options, "fix "+r.app)
		if len(options) >= 5 {
			break
		}
	}

	if len(options) == 0 {
		return adapter.TextResponse(sb.String()), nil
	}

	sb.WriteString("\nTap a button to open a PR with fixes:")
	return adapter.OptionsResponse(sb.String(), options), nil
}

// runDepsFix runs `fleet deps fix <app>` and returns the output. uses an
// extended timeout because fix shells out to npm/pip and creates a github pr.
func runDepsFix(app string) (adapter.OutboundMessage, error) {
	app = strings.TrimSpace(app)
	if app == "" {
		return adapter.TextResponse("usage: /deps fix <app>"), nil
	}
	res, err := exec.Run(5*time.Minute, "fleet", "deps", "fix", app)
	if err != nil {
		stderr := ""
		if res != nil && res.Stderr != "" {
			stderr = "\n" + res.Stderr
		}
		return adapter.TextResponse(fmt.Sprintf("deps fix %s failed: %v%s", app, err, stderr)), nil
	}
	out := res.Stdout
	if out == "" {
		out = "(no output)"
	}
	if len(out) > 3800 {
		out = out[len(out)-3800:]
	}
	return adapter.TextResponse(fmt.Sprintf("deps fix %s:\n\n%s", app, out)), nil
}
