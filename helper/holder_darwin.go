package main

import (
	"os/exec"
	"strconv"
	"strings"
)

// macOS: lsof lists each Unix socket under the path it was bound at.
func lsofListeners() (map[string]int, error) {
	out, err := exec.Command("lsof", "-U", "-F", "pn").Output()
	if len(out) == 0 && err != nil {
		return nil, err
	}
	return parseLsof(string(out)), nil
}

func parseLsof(out string) map[string]int {
	table := map[string]int{}
	pid := 0
	for _, line := range strings.Split(out, "\n") {
		if line == "" {
			continue
		}
		switch line[0] {
		case 'p':
			pid, _ = strconv.Atoi(line[1:])
		case 'n':
			if strings.HasPrefix(line[1:], "/") {
				table[line[1:]] = pid
			}
		}
	}
	return table
}

func platformListeners() listenerTable { return lsofListeners }
