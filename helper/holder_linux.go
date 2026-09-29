package main

import (
	"os"
	"strings"
)

// Linux: /proc/net/unix names every bound socket, and reading it spawns nothing.
func procListeners() (map[string]int, error) {
	data, err := os.ReadFile("/proc/net/unix")
	if err != nil {
		return nil, err
	}
	return parseProcNetUnix(string(data)), nil
}

func parseProcNetUnix(data string) map[string]int {
	table := map[string]int{}
	lines := strings.Split(data, "\n")
	for _, line := range lines[min(1, len(lines)):] {
		cols := strings.Fields(line)
		if len(cols) >= 8 && strings.HasPrefix(cols[7], "/") {
			table[strings.Join(cols[7:], " ")] = 0
		}
	}
	return table
}

func platformListeners() listenerTable { return procListeners }
