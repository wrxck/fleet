package waf

import (
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"fleet-bot/exec"

	"gopkg.in/yaml.v3"
)

// ConfigPath is the location of the truewaf YAML config. It is a var (rather
// than a const) so tests can point it at a temp file.
var ConfigPath = "/etc/truewaf/truewaf.yaml"

const (
	wafTimeout = 5 * time.Second
	// maxWhitelist caps the number of whitelist entries to prevent unbounded
	// growth from misuse or bot-level abuse.
	maxWhitelist = 256
	// minCIDRPrefix is the smallest (widest) CIDR prefix length we accept.
	// /0..-/7 is wider than any reasonable allowlist (a /7 covers 33M IPv4
	// addresses) — refuse those outright so a chat operator cannot disable
	// the WAF for the entire address space.
	minCIDRPrefix = 8
)

// Config represents the truewaf YAML configuration.
type Config struct {
	DockerLocalhostFallback bool   `yaml:"docker_localhost_fallback"`
	Mode                    string `yaml:"mode"`
	LogLevel                string `yaml:"log_level"`
	LogFile                 string `yaml:"log_file"`
	LogToConsole            bool   `yaml:"log_to_console"`
	TrustForwardedHeaders   bool   `yaml:"trust_forwarded_headers"`

	Proxy struct {
		ListenAddress     string `yaml:"listen_address"`
		ListenPort        int    `yaml:"listen_port"`
		BackendAddress    string `yaml:"backend_address"`
		BackendPort       int    `yaml:"backend_port"`
		ConnectionTimeout int    `yaml:"connection_timeout_ms"`
		ReadTimeout       int    `yaml:"read_timeout_ms"`
		WriteTimeout      int    `yaml:"write_timeout_ms"`
		MaxConnections    int    `yaml:"max_connections"`
		WorkerThreads     int    `yaml:"worker_threads"`
		Listeners         []struct {
			Listen  string `yaml:"listen"`
			Backend string `yaml:"backend"`
		} `yaml:"listeners"`
	} `yaml:"proxy"`

	RateLimit struct {
		Enabled              bool `yaml:"enabled"`
		RequestsPerSecond    int  `yaml:"requests_per_second"`
		BurstSize            int  `yaml:"burst_size"`
		BlockDurationSeconds int  `yaml:"block_duration_seconds"`
	} `yaml:"rate_limit"`

	BlockedResponse struct {
		Code int    `yaml:"code"`
		Body string `yaml:"body"`
	} `yaml:"blocked_response"`

	Whitelist struct {
		Paths []string `yaml:"paths"`
		IPs   []string `yaml:"ips"`
	} `yaml:"whitelist"`
}

// Read loads the truewaf config from disk.
func Read() (*Config, error) {
	data, err := os.ReadFile(ConfigPath)
	if err != nil {
		return nil, fmt.Errorf("read WAF config: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse WAF config: %w", err)
	}
	return &cfg, nil
}

// Write saves the truewaf config to disk.
func Write(cfg *Config) error {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal WAF config: %w", err)
	}
	if err := os.WriteFile(ConfigPath, data, 0644); err != nil {
		return fmt.Errorf("write WAF config: %w", err)
	}
	return nil
}

// Reload sends a reload signal to truewaf.
func Reload() error {
	_, err := exec.Run(wafTimeout, "systemctl", "reload", "truewaf")
	return err
}

// IsActive checks if truewaf service is running.
func IsActive() string {
	res, err := exec.Run(wafTimeout, "systemctl", "is-active", "truewaf")
	if err != nil {
		if res != nil {
			return res.Stdout
		}
		return "unknown"
	}
	return res.Stdout
}

// validateWhitelistIP rejects empty input, malformed IPs/CIDRs, and overly
// wide CIDR ranges. Returning a normalised string keeps the on-disk config
// canonical so duplicate-detection works as expected.
func validateWhitelistIP(ip string) (string, error) {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return "", fmt.Errorf("ip is empty")
	}
	if strings.Contains(ip, "/") {
		_, ipnet, err := net.ParseCIDR(ip)
		if err != nil {
			return "", fmt.Errorf("invalid CIDR: %w", err)
		}
		ones, _ := ipnet.Mask.Size()
		if ones < minCIDRPrefix {
			return "", fmt.Errorf("CIDR /%d is too wide: refuse to whitelist (minimum allowed is /%d)", ones, minCIDRPrefix)
		}
		return ip, nil
	}
	if net.ParseIP(ip) == nil {
		return "", fmt.Errorf("invalid IP address: %q", ip)
	}
	return ip, nil
}

// AddWhitelistIP adds an IP to the whitelist, writes config, and reloads.
// The input is validated to reject malformed addresses and overly wide CIDR
// ranges (e.g. 0.0.0.0/0) that would effectively disable the WAF.
func AddWhitelistIP(ip string) error {
	ip, err := validateWhitelistIP(ip)
	if err != nil {
		return err
	}

	cfg, err := Read()
	if err != nil {
		return err
	}

	// Cap whitelist length so misuse can't grow it without bound.
	if len(cfg.Whitelist.IPs) >= maxWhitelist {
		return fmt.Errorf("whitelist full (%d entries)", maxWhitelist)
	}

	// Check if already whitelisted
	for _, existing := range cfg.Whitelist.IPs {
		if existing == ip {
			return fmt.Errorf("%s is already whitelisted", ip)
		}
	}

	cfg.Whitelist.IPs = append(cfg.Whitelist.IPs, ip)
	if err := Write(cfg); err != nil {
		return err
	}
	return Reload()
}

// RemoveWhitelistIP removes an IP from the whitelist, writes config, and reloads.
func RemoveWhitelistIP(ip string) error {
	cfg, err := Read()
	if err != nil {
		return err
	}

	found := false
	filtered := make([]string, 0, len(cfg.Whitelist.IPs))
	for _, existing := range cfg.Whitelist.IPs {
		if existing == ip {
			found = true
		} else {
			filtered = append(filtered, existing)
		}
	}
	if !found {
		return fmt.Errorf("%s is not in the whitelist", ip)
	}

	cfg.Whitelist.IPs = filtered
	if err := Write(cfg); err != nil {
		return err
	}
	return Reload()
}

// SetRateLimit updates the rate limit settings, writes config, and reloads.
func SetRateLimit(rps, burst int) error {
	cfg, err := Read()
	if err != nil {
		return err
	}

	cfg.RateLimit.RequestsPerSecond = rps
	cfg.RateLimit.BurstSize = burst
	if err := Write(cfg); err != nil {
		return err
	}
	return Reload()
}
