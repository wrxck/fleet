package bot

import "fmt"

// HTML formatting helpers for Telegram messages.

func Bold(s string) string {
	return "<b>" + s + "</b>"
}

func Code(s string) string {
	return "<code>" + s + "</code>"
}

func Pre(s string) string {
	return "<pre>" + s + "</pre>"
}

func StatusIcon(state string) string {
	switch state {
	case "healthy", "running", "active":
		return "●"
	case "degraded":
		return "◐"
	case "down", "stopped", "exited", "dead", "inactive", "failed":
		return "○"
	default:
		return "◌"
	}
}

func FormatBytes(b uint64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
		TB = GB * 1024
	)
	switch {
	case b >= TB:
		return fmt.Sprintf("%.1f TB", float64(b)/float64(TB))
	case b >= GB:
		return fmt.Sprintf("%.1f GB", float64(b)/float64(GB))
	case b >= MB:
		return fmt.Sprintf("%.1f MB", float64(b)/float64(MB))
	case b >= KB:
		return fmt.Sprintf("%.1f KB", float64(b)/float64(KB))
	default:
		return fmt.Sprintf("%d B", b)
	}
}

func FormatBytesRate(b float64) string {
	const (
		KB = 1024.0
		MB = KB * 1024
		GB = MB * 1024
	)
	switch {
	case b >= GB:
		return fmt.Sprintf("%.1f GB/s", b/GB)
	case b >= MB:
		return fmt.Sprintf("%.1f MB/s", b/MB)
	case b >= KB:
		return fmt.Sprintf("%.1f KB/s", b/KB)
	default:
		return fmt.Sprintf("%.0f B/s", b)
	}
}

func FormatPercent(p float64) string {
	return fmt.Sprintf("%.1f%%", p)
}
