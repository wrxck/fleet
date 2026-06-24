package adapter

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// signBody returns the hex-encoded HMAC-SHA256 of body keyed by secret —
// matching the server's expected signature format.
func signBody(secret, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	return hex.EncodeToString(mac.Sum(nil))
}

// TestWebhookRejectsUnauthenticatedPOST is the inverse of the SEC-0001 PoC:
// an unauthenticated POST (no X-BlueBubbles-Signature header) must NOT be
// accepted, and must NOT enqueue any inbound message.
func TestWebhookRejectsUnauthenticatedPOST(t *testing.T) {
	b := NewBlueBubbles("", "shared-secret", "", "", "", 0, []string{"+15551234567"}, nil)
	inbox := make(chan InboundMessage, 1)

	body := `{"type":"new-message","data":{"handle":{"address":"+15551234567"},"text":"/sh rm -rf /"}}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// Deliberately no X-BlueBubbles-Signature header.

	rec := httptest.NewRecorder()
	b.webhookHandler(inbox).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for unsigned webhook, got %d", rec.Code)
	}

	select {
	case msg := <-inbox:
		t.Fatalf("SEC-0001 REGRESSION: unsigned webhook enqueued message %+v", msg)
	case <-time.After(50 * time.Millisecond):
	}
}

// TestWebhookRejectsBadSignature ensures a forged signature is rejected.
func TestWebhookRejectsBadSignature(t *testing.T) {
	b := NewBlueBubbles("", "shared-secret", "", "", "", 0, []string{"+15551234567"}, nil)
	inbox := make(chan InboundMessage, 1)

	body := `{"type":"new-message","data":{"handle":{"address":"+15551234567"},"text":"/sh id"}}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webhookSignatureHeader, signBody("wrong-secret", body))

	rec := httptest.NewRecorder()
	b.webhookHandler(inbox).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for bad signature, got %d", rec.Code)
	}

	select {
	case msg := <-inbox:
		t.Fatalf("SEC-0001 REGRESSION: bad-signature webhook enqueued %+v", msg)
	case <-time.After(50 * time.Millisecond):
	}
}

// TestWebhookAcceptsValidSignature confirms legitimate traffic is not blocked
// by the fix: a correctly-signed request from an allowlisted sender is
// enqueued as before.
func TestWebhookAcceptsValidSignature(t *testing.T) {
	const secret = "shared-secret"
	b := NewBlueBubbles("", secret, "", "", "", 0, []string{"+15551234567"}, nil)
	inbox := make(chan InboundMessage, 1)

	body := `{"type":"new-message","data":{"handle":{"address":"+15551234567"},"text":"/ping"}}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webhookSignatureHeader, signBody(secret, body))

	rec := httptest.NewRecorder()
	b.webhookHandler(inbox).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for signed webhook, got %d (body=%q)", rec.Code, rec.Body.String())
	}

	select {
	case msg := <-inbox:
		if msg.SenderID != "+15551234567" || msg.Text != "/ping" {
			t.Fatalf("unexpected enqueued message: %+v", msg)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected signed webhook to enqueue a message")
	}
}

// TestWebhookRejectsSignedButUnauthorizedSender verifies the second layer of
// defence: even with a valid signature, a sender outside the allowlist is
// dropped (existing behaviour, reconfirmed).
func TestWebhookRejectsSignedButUnauthorizedSender(t *testing.T) {
	const secret = "shared-secret"
	b := NewBlueBubbles("", secret, "", "", "", 0, []string{"+15551234567"}, nil)
	inbox := make(chan InboundMessage, 1)

	body := `{"type":"new-message","data":{"handle":{"address":"+19999999999"},"text":"/sh id"}}`
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webhookSignatureHeader, signBody(secret, body))

	rec := httptest.NewRecorder()
	b.webhookHandler(inbox).ServeHTTP(rec, req)

	select {
	case msg := <-inbox:
		t.Fatalf("SEC-0001 REGRESSION: non-allowlisted sender enqueued %+v", msg)
	case <-time.After(50 * time.Millisecond):
	}
}

// TestWebhookSeparateSigningSecret verifies that when a dedicated webhookSecret
// is configured it — not the API password — is the inbound signing key, so a
// leak of the API password (sent to the relay on every outbound call) does not
// let an attacker forge inbound webhooks.
func TestWebhookSeparateSigningSecret(t *testing.T) {
	const password = "api-password"
	const webhookSecret = "distinct-webhook-secret"
	b := NewBlueBubbles("", password, webhookSecret, "", "", 0, []string{"+15551234567"}, nil)
	inbox := make(chan InboundMessage, 1)

	body := `{"type":"new-message","data":{"guid":"g1","handle":{"address":"+15551234567"},"text":"/ping"}}`

	// signed with the api password — must be rejected now that a webhook secret exists.
	req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set(webhookSignatureHeader, signBody(password, body))
	rec := httptest.NewRecorder()
	b.webhookHandler(inbox).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when signed with api password, got %d", rec.Code)
	}

	// signed with the dedicated webhook secret — accepted.
	req = httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
	req.Header.Set(webhookSignatureHeader, signBody(webhookSecret, body))
	rec = httptest.NewRecorder()
	b.webhookHandler(inbox).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 when signed with webhook secret, got %d", rec.Code)
	}
	select {
	case <-inbox:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected webhook-secret-signed request to enqueue a message")
	}
}

// TestWebhookRejectsReplay confirms a correctly-signed delivery is processed
// once and a byte-identical replay (same message guid) is dropped.
func TestWebhookRejectsReplay(t *testing.T) {
	const secret = "shared-secret"
	b := NewBlueBubbles("", secret, "", "", "", 0, []string{"+15551234567"}, nil)
	inbox := make(chan InboundMessage, 2)

	body := `{"type":"new-message","data":{"guid":"dup-guid","handle":{"address":"+15551234567"},"text":"/ping"}}`
	sig := signBody(secret, body)

	send := func() int {
		req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
		req.Header.Set(webhookSignatureHeader, sig)
		rec := httptest.NewRecorder()
		b.webhookHandler(inbox).ServeHTTP(rec, req)
		return rec.Code
	}

	if code := send(); code != http.StatusOK {
		t.Fatalf("expected 200 on first delivery, got %d", code)
	}
	if code := send(); code != http.StatusOK {
		t.Fatalf("expected 200 (ack) on replay, got %d", code)
	}
	if len(inbox) != 1 {
		t.Fatalf("expected exactly 1 enqueued message after a replay, got %d", len(inbox))
	}
}

// TestReplayGuardStaleAndDuplicate unit-tests the replay guard directly.
func TestReplayGuardStaleAndDuplicate(t *testing.T) {
	g := newReplayGuard(10 * time.Minute)
	now := time.UnixMilli(1_700_000_000_000)

	if !g.admit("a", now.UnixMilli(), now) {
		t.Error("expected fresh delivery to be admitted")
	}
	if g.admit("a", now.UnixMilli(), now) {
		t.Error("expected duplicate guid to be rejected")
	}
	if g.admit("b", now.Add(-20*time.Minute).UnixMilli(), now) {
		t.Error("expected stale timestamp to be rejected")
	}
	if g.admit("c", now.Add(20*time.Minute).UnixMilli(), now) {
		t.Error("expected far-future timestamp to be rejected")
	}
}

// TestIsAuthorizedSender sanity-checks the SenderAuthorizer implementation
// used by the router to gate dispatch.
func TestIsAuthorizedSender(t *testing.T) {
	b := NewBlueBubbles("", "s", "", "", "", 0, []string{"+15551234567"}, nil)
	var _ SenderAuthorizer = b // compile-time assertion

	if !b.IsAuthorizedSender("+15551234567", "iMessage;-;+15551234567") {
		t.Error("expected allowlisted sender to be authorized")
	}
	if b.IsAuthorizedSender("+19999999999", "iMessage;-;+19999999999") {
		t.Error("expected non-allowlisted sender to be rejected")
	}
	if b.IsAuthorizedSender("", "") {
		t.Error("expected empty sender to be rejected")
	}
}
