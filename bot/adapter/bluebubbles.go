package adapter

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
)

// replayWindow bounds how old a signed webhook delivery may be and how long a
// seen message guid is remembered for de-duplication.
const replayWindow = 10 * time.Minute

// webhookSignatureHeader is the HTTP header that must carry the hex-encoded
// HMAC-SHA256 of the raw request body, computed with the adapter password as
// the shared key. Requests without a valid signature are rejected.
const webhookSignatureHeader = "X-BlueBubbles-Signature"

// BlueBubblesAdapter implements the adapter interface for imessage via the
// bluebubbles relay.
type BlueBubblesAdapter struct {
	serverURL      string
	password       string
	webhookSecret  string
	cfClientID     string
	cfClientSecret string
	webhookPort    int
	allowedNumbers map[string]bool
	alertChatGuids []string
	client         *http.Client
	server         *http.Server
	replay         *replayGuard
}

// NewBlueBubbles constructs a BlueBubblesAdapter. webhookSecret keys the
// inbound-webhook HMAC; when empty it falls back to password for backwards
// compatibility, but separating the two means a leak of one does not grant the
// other (the API password is sent to the relay on every outbound call, so it is
// the weaker secret to verify inbound auth with).
func NewBlueBubbles(
	serverURL, password, webhookSecret, cfClientID, cfClientSecret string,
	webhookPort int,
	allowedNumbers, alertChatGuids []string,
) *BlueBubblesAdapter {
	allowed := make(map[string]bool, len(allowedNumbers))
	for _, n := range allowedNumbers {
		allowed[n] = true
	}
	return &BlueBubblesAdapter{
		serverURL:      serverURL,
		password:       password,
		webhookSecret:  webhookSecret,
		cfClientID:     cfClientID,
		cfClientSecret: cfClientSecret,
		webhookPort:    webhookPort,
		allowedNumbers: allowed,
		alertChatGuids: alertChatGuids,
		client:         &http.Client{},
		replay:         newReplayGuard(replayWindow),
	}
}

// signingKey is the secret used to verify inbound webhook signatures: a
// dedicated webhookSecret when configured, otherwise the API password.
func (b *BlueBubblesAdapter) signingKey() string {
	if b.webhookSecret != "" {
		return b.webhookSecret
	}
	return b.password
}

// replayGuard rejects duplicate or stale webhook deliveries. it keys on the
// imessage message guid — which is covered by the hmac signature and so cannot
// be forged or altered without the signing secret — and additionally rejects
// deliveries whose signed creation time is outside the window. together these
// close the replay gap: a captured-and-resent body is dropped because its guid
// is already seen or its timestamp is stale.
type replayGuard struct {
	mu     sync.Mutex
	seen   map[string]time.Time
	window time.Duration
}

func newReplayGuard(window time.Duration) *replayGuard {
	return &replayGuard{seen: make(map[string]time.Time), window: window}
}

// admit reports whether a delivery with the given guid and signed creation time
// (unix milliseconds; 0 when unknown) should be processed. it returns false for
// a replayed guid or an out-of-window timestamp, and prunes expired entries so
// the seen-set cannot grow unbounded.
func (g *replayGuard) admit(guid string, createdMs int64, now time.Time) bool {
	// the guid is the dedup key; without it there is no anti-replay (a fresh
	// timestamp alone does not stop a replay within the window), so fail closed.
	// real bluebubbles "new-message" deliveries always carry a message guid.
	if guid == "" {
		return false
	}
	if createdMs > 0 {
		age := now.Sub(time.UnixMilli(createdMs))
		if age > g.window || age < -g.window {
			return false
		}
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	for k, t := range g.seen {
		if now.Sub(t) > g.window {
			delete(g.seen, k)
		}
	}
	if _, dup := g.seen[guid]; dup {
		return false
	}
	g.seen[guid] = now
	return true
}

// Name returns the adapter identifier.
func (b *BlueBubblesAdapter) Name() string {
	return "imessage"
}

// Start begins receiving messages via an HTTP webhook server.
func (b *BlueBubblesAdapter) Start(ctx context.Context, inbox chan<- InboundMessage) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/webhook", b.webhookHandler(inbox))

	b.server = &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", b.webhookPort),
		Handler: mux,
	}

	errCh := make(chan error, 1)
	go func() {
		if err := b.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	go func() {
		select {
		case <-ctx.Done():
			_ = b.server.Close()
		case <-errCh:
		}
	}()

	return nil
}

// IsAuthorizedSender reports whether the given sender identity is in the
// configured allowlist. The router consults this before dispatching any
// command originating from the BlueBubbles adapter.
// chatID is unused: bluebubbles authorises strictly by the configured handle
// allowlist (default-deny — an empty map rejects everyone), independent of the
// chat the message arrived on.
func (b *BlueBubblesAdapter) IsAuthorizedSender(senderID, _ string) bool {
	return b.allowedNumbers[senderID]
}

// verifyWebhookSignature reports whether the hex-encoded signature in
// headerSig matches the HMAC-SHA256 of body keyed by the adapter password.
// Comparison is constant-time. An empty password disables verification (the
// adapter refuses to accept any webhook) to avoid silently accepting an
// unauthenticated deployment.
func (b *BlueBubblesAdapter) verifyWebhookSignature(body []byte, headerSig string) bool {
	key := b.signingKey()
	if key == "" || headerSig == "" {
		return false
	}
	provided, err := hex.DecodeString(headerSig)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write(body)
	expected := mac.Sum(nil)
	return subtle.ConstantTimeCompare(provided, expected) == 1
}

// webhookHandler returns the HTTP handler for incoming BlueBubbles webhook events.
func (b *BlueBubblesAdapter) webhookHandler(inbox chan<- InboundMessage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		if !b.verifyWebhookSignature(body, r.Header.Get(webhookSignatureHeader)) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var payload struct {
			Type string `json:"type"`
			Data struct {
				GUID   string `json:"guid"`
				Handle struct {
					Address string `json:"address"`
				} `json:"handle"`
				Text        string `json:"text"`
				DateCreated int64  `json:"dateCreated"`
			} `json:"data"`
		}

		if err := json.Unmarshal(body, &payload); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		if payload.Type != "new-message" {
			w.WriteHeader(http.StatusOK)
			return
		}

		// reject replayed or stale deliveries. the guid and dateCreated are
		// covered by the verified signature, so they cannot be forged.
		if !b.replay.admit(payload.Data.GUID, payload.Data.DateCreated, time.Now()) {
			w.WriteHeader(http.StatusOK)
			return
		}

		sender := payload.Data.Handle.Address
		chatGuid := fmt.Sprintf("iMessage;-;%s", sender)
		if !b.IsAuthorizedSender(sender, chatGuid) {
			w.WriteHeader(http.StatusOK)
			return
		}

		inbox <- InboundMessage{
			ChatID:   chatGuid,
			SenderID: sender,
			Text:     payload.Data.Text,
			Provider: b.Name(),
		}

		w.WriteHeader(http.StatusOK)
	}
}

// send delivers a message to the given chat ID. imessage has no message id
// callers can edit later, so the returned id is always the empty string.
func (b *BlueBubblesAdapter) Send(chatID string, msg OutboundMessage) (string, error) {
	text := msg.Text
	if len(msg.Options) > 0 {
		for i, opt := range msg.Options {
			text += fmt.Sprintf("\n%d. %s", i+1, opt)
		}
	}
	return "", b.sendText(chatID, text)
}

// edit is a no-op on imessage — the protocol doesn't support editing previous
// messages. callers that want streaming progress should use the stream
// callback on outboundmessage; on this adapter it's invoked with a no-op
// updater so the same code path works on both providers.
func (b *BlueBubblesAdapter) Edit(chatID, messageID, text string) error {
	return nil
}

// SendAlert delivers an alert message to all configured alert chat GUIDs.
func (b *BlueBubblesAdapter) SendAlert(text string) error {
	var lastErr error
	for _, guid := range b.alertChatGuids {
		if err := b.sendText(guid, text); err != nil {
			lastErr = err
		}
	}
	return lastErr
}

// Stop gracefully shuts down the HTTP server.
func (b *BlueBubblesAdapter) Stop() error {
	if b.server != nil {
		return b.server.Close()
	}
	return nil
}

// sendText POSTs a text message to BlueBubbles via its REST API.
func (b *BlueBubblesAdapter) sendText(chatGuid, text string) error {
	body := map[string]string{
		"chatGuid": chatGuid,
		"message":  text,
		"tempGuid": uuid.NewString(),
		"method":   "apple-script",
		"password": b.password,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("bluebubbles: marshal payload: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/message/text", b.serverURL)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("bluebubbles: create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CF-Access-Client-Id", b.cfClientID)
	req.Header.Set("CF-Access-Client-Secret", b.cfClientSecret)

	resp, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("bluebubbles: send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bluebubbles: unexpected status %d", resp.StatusCode)
	}

	return nil
}
