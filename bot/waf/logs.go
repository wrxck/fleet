package waf

import (
	"fmt"

	"fleet-bot/exec"
)

const LogFile = "/var/log/truewaf/truewaf.log"

// TailLog returns the last n lines of the truewaf log.
func TailLog(n int) (string, error) {
	res, err := exec.Run(wafTimeout, "tail", "-n", fmt.Sprintf("%d", n), LogFile)
	if err != nil {
		if res != nil && res.Stderr != "" {
			return "", fmt.Errorf("%s", res.Stderr)
		}
		return "", err
	}
	return res.Stdout, nil
}
