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

	"github.com/google/uuid"
)

// webhookSignatureHeader is the HTTP header that must carry the hex-encoded
// HMAC-SHA256 of the raw request body, computed with the adapter password as
// the shared key. Requests without a valid signature are rejected.
const webhookSignatureHeader = "X-BlueBubbles-Signature"

// BlueBubblesAdapter implements Adapter for iMessage via BlueBubbles relay.
type BlueBubblesAdapter struct {
	serverURL       string
	password        string
	cfClientID      string
	cfClientSecret  string
	webhookPort     int
	allowedNumbers  map[string]bool
	alertChatGuids  []string
	client          *http.Client
	server          *http.Server
}

// NewBlueBubbles constructs a BlueBubblesAdapter.
func NewBlueBubbles(
	serverURL, password, cfClientID, cfClientSecret string,
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
		cfClientID:     cfClientID,
		cfClientSecret: cfClientSecret,
		webhookPort:    webhookPort,
		allowedNumbers: allowed,
		alertChatGuids: alertChatGuids,
		client:         &http.Client{},
	}
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
		Addr:    fmt.Sprintf(":%d", b.webhookPort),
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
func (b *BlueBubblesAdapter) IsAuthorizedSender(senderID string) bool {
	return b.allowedNumbers[senderID]
}

// verifyWebhookSignature reports whether the hex-encoded signature in
// headerSig matches the HMAC-SHA256 of body keyed by the adapter password.
// Comparison is constant-time. An empty password disables verification (the
// adapter refuses to accept any webhook) to avoid silently accepting an
// unauthenticated deployment.
func (b *BlueBubblesAdapter) verifyWebhookSignature(body []byte, headerSig string) bool {
	if b.password == "" || headerSig == "" {
		return false
	}
	provided, err := hex.DecodeString(headerSig)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(b.password))
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
				Handle struct {
					Address string `json:"address"`
				} `json:"handle"`
				Text string `json:"text"`
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

		sender := payload.Data.Handle.Address
		if !b.IsAuthorizedSender(sender) {
			w.WriteHeader(http.StatusOK)
			return
		}

		chatGuid := fmt.Sprintf("iMessage;-;%s", sender)

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
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("bluebubbles: marshal payload: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/message/text?password=%s", b.serverURL, b.password)
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
