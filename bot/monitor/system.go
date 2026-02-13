package monitor

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
)

// procRoot and diskRoot allow reading host stats when running in Docker.
var procRoot = "/proc"
var diskRoot = "/"

func init() {
	if _, err := os.Stat("/host/proc/stat"); err == nil {
		procRoot = "/host/proc"
	}
	if _, err := os.Stat("/host_root/proc"); err == nil {
		diskRoot = "/host_root"
	}
}

// SystemStats holds a one-shot snapshot of system metrics.
type SystemStats struct {
	Hostname    string
	Uptime      string
	CPUPercent  float64
	MemTotal    uint64
	MemUsed     uint64
	MemPercent  float64
	SwapTotal   uint64
	SwapUsed    uint64
	DiskTotal   uint64
	DiskUsed    uint64
	DiskPercent float64
	LoadAvg1    float64
	LoadAvg5    float64
	LoadAvg15   float64
}

// GetSystemStats reads system metrics from /proc in a single pass.
// CPU percentage is approximate (instantaneous idle ratio) since we
// don't have a previous sample to diff against.
func GetSystemStats() SystemStats {
	s := SystemStats{}
	s.Hostname, _ = os.Hostname()
	s.Uptime = readUptime()
	s.CPUPercent = readCPUPercent()
	s.MemTotal, s.MemUsed, s.MemPercent, s.SwapTotal, s.SwapUsed = readMeminfo()
	s.DiskTotal, s.DiskUsed, s.DiskPercent = readDisk()
	s.LoadAvg1, s.LoadAvg5, s.LoadAvg15 = readLoadAvg()
	return s
}

func readCPUPercent() float64 {
	f, err := os.Open(procRoot + "/stat")
	if err != nil {
		return 0
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "cpu ") {
			fields := strings.Fields(line)
			if len(fields) < 9 {
				return 0
			}
			user := parseUint(fields[1])
			nice := parseUint(fields[2])
			system := parseUint(fields[3])
			idle := parseUint(fields[4])
			iowait := parseUint(fields[5])
			irq := parseUint(fields[6])
			softirq := parseUint(fields[7])
			steal := parseUint(fields[8])

			total := user + nice + system + idle + iowait + irq + softirq + steal
			busy := total - idle - iowait
			if total > 0 {
				return float64(busy) / float64(total) * 100
			}
		}
	}
	return 0
}

func readMeminfo() (total, used uint64, percent float64, swapTotal, swapUsed uint64) {
	f, err := os.Open(procRoot + "/meminfo")
	if err != nil {
		return
	}
	defer f.Close()

	var avail, swapFree uint64
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "MemTotal:"):
			total = parseMemLine(line) * 1024
		case strings.HasPrefix(line, "MemAvailable:"):
			avail = parseMemLine(line) * 1024
		case strings.HasPrefix(line, "SwapTotal:"):
			swapTotal = parseMemLine(line) * 1024
		case strings.HasPrefix(line, "SwapFree:"):
			swapFree = parseMemLine(line) * 1024
		}
	}
	used = total - avail
	swapUsed = swapTotal - swapFree
	if total > 0 {
		percent = float64(used) / float64(total) * 100
	}
	return
}

func readDisk() (total, used uint64, percent float64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(diskRoot, &stat); err != nil {
		return
	}
	total = stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	used = total - free
	if total > 0 {
		percent = float64(used) / float64(total) * 100
	}
	return
}

func readLoadAvg() (l1, l5, l15 float64) {
	data, err := os.ReadFile(procRoot + "/loadavg")
	if err != nil {
		return
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return
	}
	l1, _ = strconv.ParseFloat(fields[0], 64)
	l5, _ = strconv.ParseFloat(fields[1], 64)
	l15, _ = strconv.ParseFloat(fields[2], 64)
	return
}

func readUptime() string {
	data, err := os.ReadFile(procRoot + "/uptime")
	if err != nil {
		return "unknown"
	}
	fields := strings.Fields(string(data))
	if len(fields) < 1 {
		return "unknown"
	}
	secs, _ := strconv.ParseFloat(fields[0], 64)
	d := int(secs) / 86400
	h := (int(secs) % 86400) / 3600
	m := (int(secs) % 3600) / 60
	if d > 0 {
		return fmt.Sprintf("%dd %dh %dm", d, h, m)
	}
	return fmt.Sprintf("%dh %dm", h, m)
}

func parseUint(s string) uint64 {
	v, _ := strconv.ParseUint(strings.TrimSpace(s), 10, 64)
	return v
}

func parseMemLine(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	return parseUint(fields[1])
}
