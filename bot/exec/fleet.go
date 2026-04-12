package exec

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

const (
	FleetBin      = "/usr/local/bin/node"
	ReadTimeout   = 30 * time.Second
	MutateTimeout = 5 * time.Minute
)

// fleetScript returns the path to the fleet CLI script.
// Defaults to /usr/local/lib/node_modules/@wrxck/fleet/dist/index.js but
// can be overridden via FLEET_SCRIPT env var for local development.
func fleetScript() string {
	if s := os.Getenv("FLEET_SCRIPT"); s != "" {
		return s
	}
	return "/usr/local/lib/node_modules/@wrxck/fleet/dist/index.js"
}

// Fleet runs a fleet CLI command and returns the raw result.
func Fleet(timeout time.Duration, args ...string) (*Result, error) {
	args = append([]string{fleetScript()}, args...)
	return Run(timeout, FleetBin, args...)
}

// FleetRead runs a read-only fleet command with default timeout.
func FleetRead(args ...string) (*Result, error) {
	return Fleet(ReadTimeout, args...)
}

// FleetMutate runs a mutating fleet command with extended timeout.
func FleetMutate(args ...string) (*Result, error) {
	return Fleet(MutateTimeout, args...)
}

// FleetJSON runs a fleet command with --json and unmarshals the result.
func FleetJSON[T any](args ...string) (T, error) {
	var zero T
	args = append(args, "--json")
	res, err := FleetRead(args...)
	if err != nil {
		// Still try to return stderr info
		if res != nil && res.Stderr != "" {
			return zero, fmt.Errorf("%s", res.Stderr)
		}
		return zero, err
	}

	stdout := res.Stdout
	if stdout == "" {
		return zero, fmt.Errorf("empty output from fleet %v", args)
	}

	var result T
	if err := json.Unmarshal([]byte(stdout), &result); err != nil {
		return zero, fmt.Errorf("parse fleet JSON: %w\nraw: %s", err, truncate(stdout, 200))
	}
	return result, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
