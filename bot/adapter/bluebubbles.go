package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"
)

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

// webhookHandler returns the HTTP handler for incoming BlueBubbles webhook events.
func (b *BlueBubblesAdapter) webhookHandler(inbox chan<- InboundMessage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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

		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		if payload.Type != "new-message" {
			w.WriteHeader(http.StatusOK)
			return
		}

		sender := payload.Data.Handle.Address
		if !b.allowedNumbers[sender] {
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

// Send delivers a message to the given chat ID.
func (b *BlueBubblesAdapter) Send(chatID string, msg OutboundMessage) error {
	text := msg.Text
	if len(msg.Options) > 0 {
		for i, opt := range msg.Options {
			text += fmt.Sprintf("\n%d. %s", i+1, opt)
		}
	}
	return b.sendText(chatID, text)
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
