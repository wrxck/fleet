package waf

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestValidateWhitelistIP_RejectsEmpty(t *testing.T) {
	cases := []string{"", "   ", "\t\n"}
	for _, in := range cases {
		if _, err := validateWhitelistIP(in); err == nil {
			t.Errorf("validateWhitelistIP(%q) = nil err, want error", in)
		}
	}
}

func TestValidateWhitelistIP_RejectsZeroCIDR(t *testing.T) {
	// /0 is the entire address space. This is the headline bypass — it must
	// be rejected so a chat operator cannot turn off the WAF.
	cases := []string{"0.0.0.0/0", "::/0"}
	for _, in := range cases {
		_, err := validateWhitelistIP(in)
		if err == nil {
			t.Errorf("validateWhitelistIP(%q) = nil err, want error (would whitelist all addresses)", in)
		}
		if err != nil && !strings.Contains(err.Error(), "too wide") {
			t.Errorf("validateWhitelistIP(%q) error = %v, want 'too wide' message", in, err)
		}
	}
}

func TestValidateWhitelistIP_RejectsWideCIDR(t *testing.T) {
	// /1..-/7 are absurdly wide. Reject all of them.
	cases := []string{"0.0.0.0/1", "0.0.0.0/4", "0.0.0.0/7", "::/1", "::/7"}
	for _, in := range cases {
		if _, err := validateWhitelistIP(in); err == nil {
			t.Errorf("validateWhitelistIP(%q) = nil err, want error (CIDR too wide)", in)
		}
	}
}

func TestValidateWhitelistIP_AcceptsEightAndNarrower(t *testing.T) {
	// /8 is right at the threshold. /16 / /24 / /32 should also pass.
	cases := []string{"10.0.0.0/8", "10.0.0.0/16", "192.168.1.0/24", "192.168.1.1/32", "fd00::/8", "fd00::/64"}
	for _, in := range cases {
		if _, err := validateWhitelistIP(in); err != nil {
			t.Errorf("validateWhitelistIP(%q) = %v, want nil err", in, err)
		}
	}
}

func TestValidateWhitelistIP_RejectsMalformed(t *testing.T) {
	cases := []string{
		"not-an-ip",
		"999.999.999.999",
		"1.2.3",
		"1.2.3.4.5",
		"1.2.3.4/abc",
		"1.2.3.4/33",
		"::1/129",
		"hello/24",
	}
	for _, in := range cases {
		if _, err := validateWhitelistIP(in); err == nil {
			t.Errorf("validateWhitelistIP(%q) = nil err, want error", in)
		}
	}
}

func TestValidateWhitelistIP_AcceptsBareIP(t *testing.T) {
	cases := []string{"1.2.3.4", "192.168.1.1", "::1", "fe80::1", "2001:db8::1"}
	for _, in := range cases {
		if _, err := validateWhitelistIP(in); err != nil {
			t.Errorf("validateWhitelistIP(%q) = %v, want nil err", in, err)
		}
	}
}

func TestValidateWhitelistIP_TrimsWhitespace(t *testing.T) {
	got, err := validateWhitelistIP("  1.2.3.4  ")
	if err != nil {
		t.Fatalf("validateWhitelistIP returned error: %v", err)
	}
	if got != "1.2.3.4" {
		t.Errorf("validateWhitelistIP did not trim whitespace, got %q", got)
	}
}

// withTempConfig writes a minimal WAF config to a temp dir, points
// ConfigPath at it, and returns the path. The original ConfigPath is
// restored at test cleanup.
func withTempConfig(t *testing.T, initialIPs []string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "truewaf.yaml")

	cfg := &Config{}
	cfg.Whitelist.IPs = initialIPs
	data, err := yaml.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal initial config: %v", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("write initial config: %v", err)
	}

	original := ConfigPath
	ConfigPath = path
	t.Cleanup(func() { ConfigPath = original })
	return path
}

// readWhitelist returns the IP whitelist from the config file at
// ConfigPath. Used by tests to assert whether a write happened.
func readWhitelist(t *testing.T) []string {
	t.Helper()
	cfg, err := Read()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	return cfg.Whitelist.IPs
}

func TestAddWhitelistIP_RejectsZeroCIDRWithoutWriting(t *testing.T) {
	withTempConfig(t, []string{"1.2.3.4"})

	err := AddWhitelistIP("0.0.0.0/0")
	if err == nil {
		t.Fatal("AddWhitelistIP(0.0.0.0/0) = nil err, want error")
	}

	// File must be unchanged — the validation must short-circuit before write.
	got := readWhitelist(t)
	if len(got) != 1 || got[0] != "1.2.3.4" {
		t.Errorf("whitelist mutated despite validation failure: %v", got)
	}
}

func TestAddWhitelistIP_RejectsMalformedWithoutWriting(t *testing.T) {
	withTempConfig(t, []string{"1.2.3.4"})

	err := AddWhitelistIP("not-an-ip")
	if err == nil {
		t.Fatal("AddWhitelistIP(not-an-ip) = nil err, want error")
	}

	got := readWhitelist(t)
	if len(got) != 1 || got[0] != "1.2.3.4" {
		t.Errorf("whitelist mutated despite validation failure: %v", got)
	}
}

func TestAddWhitelistIP_AcceptsValidSingleIP(t *testing.T) {
	withTempConfig(t, nil)

	// AddWhitelistIP will fail at the systemctl reload step (truewaf is not
	// installed in the test env), but the validation and config-write
	// happen before reload. We assert the whitelist now contains the entry.
	_ = AddWhitelistIP("1.2.3.4")

	got := readWhitelist(t)
	if len(got) != 1 || got[0] != "1.2.3.4" {
		t.Errorf("whitelist after AddWhitelistIP(1.2.3.4) = %v, want [1.2.3.4]", got)
	}
}

func TestAddWhitelistIP_AcceptsEightCIDR(t *testing.T) {
	withTempConfig(t, nil)

	// /8 is the threshold — must be allowed.
	_ = AddWhitelistIP("10.0.0.0/8")

	got := readWhitelist(t)
	if len(got) != 1 || got[0] != "10.0.0.0/8" {
		t.Errorf("whitelist after AddWhitelistIP(10.0.0.0/8) = %v, want [10.0.0.0/8]", got)
	}
}

func TestAddWhitelistIP_DuplicateReturnsError(t *testing.T) {
	withTempConfig(t, []string{"1.2.3.4"})

	err := AddWhitelistIP("1.2.3.4")
	if err == nil {
		t.Fatal("AddWhitelistIP for duplicate = nil err, want error")
	}
	if !strings.Contains(err.Error(), "already whitelisted") {
		t.Errorf("error = %v, want 'already whitelisted'", err)
	}
}

func TestAddWhitelistIP_FullWhitelistReturnsError(t *testing.T) {
	// Pre-fill to maxWhitelist.
	full := make([]string, maxWhitelist)
	for i := range full {
		full[i] = "10.0.0." + itoa(i%256)
	}
	withTempConfig(t, full)

	err := AddWhitelistIP("172.16.0.1")
	if err == nil {
		t.Fatal("AddWhitelistIP at cap = nil err, want error")
	}
	if !strings.Contains(err.Error(), "full") {
		t.Errorf("error = %v, want 'full'", err)
	}
}

// itoa avoids pulling strconv into the test file just for one helper.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
