package bot

import (
	"fmt"
	"sync"
	"time"
)

const confirmExpiry = 60 * time.Second

// ActionFunc is called when a destructive action is confirmed.
type ActionFunc func() (string, error)

// PendingAction represents a destructive operation awaiting confirmation.
type PendingAction struct {
	ChatID    int64
	MessageID int64
	Label     string
	Action    ActionFunc
	CreatedAt time.Time
}

// ConfirmManager tracks pending destructive actions.
type ConfirmManager struct {
	mu      sync.Mutex
	pending map[string]*PendingAction // key -> pending action
	counter int64
}

func NewConfirmManager() *ConfirmManager {
	return &ConfirmManager{
		pending: make(map[string]*PendingAction),
	}
}

// Request creates a pending action and sends a confirmation keyboard.
func (cm *ConfirmManager) Request(b *Bot, chatID int64, prompt string, confirmLabel string, action ActionFunc) error {
	cm.mu.Lock()
	cm.counter++
	key := fmt.Sprintf("confirm_%d", cm.counter)
	cm.mu.Unlock()

	markup := &InlineKeyboardMarkup{
		InlineKeyboard: [][]InlineKeyboardButton{
			{
				{Text: confirmLabel, CallbackData: key + ":yes"},
				{Text: "Cancel", CallbackData: key + ":no"},
			},
		},
	}

	msg, err := b.SendMessageWithReply(chatID, prompt, markup)
	if err != nil {
		return err
	}

	cm.mu.Lock()
	cm.pending[key] = &PendingAction{
		ChatID:    chatID,
		MessageID: msg.MessageID,
		Label:     confirmLabel,
		Action:    action,
		CreatedAt: time.Now(),
	}
	cm.mu.Unlock()

	// Auto-expire
	go func() {
		time.Sleep(confirmExpiry)
		cm.mu.Lock()
		if _, exists := cm.pending[key]; exists {
			delete(cm.pending, key)
			cm.mu.Unlock()
			b.EditMessage(chatID, msg.MessageID, prompt+"\n\n<i>Expired.</i>", nil)
		} else {
			cm.mu.Unlock()
		}
	}()

	return nil
}

// HandleCallback processes a callback query for confirmations. Returns true if handled.
func (cm *ConfirmManager) HandleCallback(b *Bot, cb *CallbackQuery) bool {
	// Parse "confirm_N:yes" or "confirm_N:no"
	data := cb.Data
	var key, choice string
	for i := len(data) - 1; i >= 0; i-- {
		if data[i] == ':' {
			key = data[:i]
			choice = data[i+1:]
			break
		}
	}
	if key == "" {
		return false
	}

	cm.mu.Lock()
	action, exists := cm.pending[key]
	if exists {
		delete(cm.pending, key)
	}
	cm.mu.Unlock()

	if !exists {
		b.AnswerCallback(cb.ID)
		return true // was a confirm callback, just expired
	}

	b.AnswerCallback(cb.ID)

	if choice == "no" {
		b.EditMessage(action.ChatID, action.MessageID, "<i>Cancelled.</i>", nil)
		return true
	}

	// Execute the action
	b.EditMessage(action.ChatID, action.MessageID, "Executing...", nil)

	result, err := action.Action()
	if err != nil {
		b.EditMessage(action.ChatID, action.MessageID, fmt.Sprintf("Error: %s", err), nil)
	} else {
		b.EditMessage(action.ChatID, action.MessageID, result, nil)
	}
	return true
}
