package bot

const AuthorizedChatID int64 = 221714512

func IsAuthorized(chatID int64) bool {
	return chatID == AuthorizedChatID
}
