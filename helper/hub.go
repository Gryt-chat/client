package main

// Keeps the latest activity per game and hands it to the Gryt app over the private
// channel, one JSON object per line. An app gets the current state when it connects.

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"sync"
	"time"
)

const protocolVersion = 1

// The running app, and one starting while the old one quits. Anything past that is dropped.
const maxApps = 4

type ActivityEvent struct {
	Connection int64
	ClientID   string
	Pid        *float64
	Activity   map[string]any
}

func (e ActivityEvent) message() map[string]any {
	msg := map[string]any{"type": "activity", "connection": e.Connection, "clientId": e.ClientID, "activity": e.Activity}
	if e.Pid != nil {
		msg["pid"] = *e.Pid
	}
	return msg
}

// Holding: games reach the helper on Slot. Otherwise every slot is taken and the helper keeps trying.
type SlotState struct {
	Holding bool
	Slot    int
}

func (s SlotState) fields(msg map[string]any) map[string]any {
	if s.Holding {
		msg["state"], msg["slot"] = "holding", s.Slot
	} else {
		msg["state"], msg["slot"] = "yielded", nil
	}
	return msg
}

type Hub struct {
	mu         sync.Mutex
	activities map[int64]ActivityEvent
	state      SlotState
	apps       map[net.Conn]*bufio.Writer
	onQuit     func()
}

func NewHub(onQuit func()) *Hub {
	return &Hub{activities: map[int64]ActivityEvent{}, apps: map[net.Conn]*bufio.Writer{}, onQuit: onQuit}
}

// Caller holds the lock. An app that stops reading is dropped rather than waited for.
func (h *Hub) sendLocked(conn net.Conn, w *bufio.Writer, msg any) {
	line, err := json.Marshal(msg)
	if err == nil {
		_ = conn.SetWriteDeadline(time.Now().Add(time.Second))
		_, err = w.Write(append(line, '\n'))
	}
	if err == nil {
		err = w.Flush()
	}
	if err != nil {
		conn.Close()
		delete(h.apps, conn)
	}
}

func (h *Hub) broadcastLocked(msg any) {
	for conn, w := range h.apps {
		h.sendLocked(conn, w, msg)
	}
}

func (h *Hub) Activity(e ActivityEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if e.Activity == nil {
		delete(h.activities, e.Connection)
	} else {
		h.activities[e.Connection] = e
	}
	h.broadcastLocked(e.message())
}

func (h *Hub) SetState(s SlotState) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if s == h.state {
		return
	}
	h.state = s
	h.broadcastLocked(s.fields(map[string]any{"type": "state"}))
}

func (h *Hub) State() SlotState {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.state
}

// One app: hello with the slot state, every live activity, then updates as they happen.
// The only thing an app can say back is quit.
func (h *Hub) ServeApp(conn net.Conn) {
	w := bufio.NewWriter(conn)
	h.mu.Lock()
	if len(h.apps) >= maxApps {
		h.mu.Unlock()
		conn.Close()
		return
	}
	h.apps[conn] = w
	h.sendLocked(conn, w, h.state.fields(map[string]any{"type": "hello", "version": protocolVersion, "pid": os.Getpid()}))
	for _, e := range h.activities {
		h.sendLocked(conn, w, e.message())
	}
	h.mu.Unlock()

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 4096), 4096)
	for scanner.Scan() {
		var msg struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(scanner.Bytes(), &msg) == nil && msg.Type == "quit" {
			h.onQuit()
			break
		}
	}
	h.mu.Lock()
	delete(h.apps, conn)
	h.mu.Unlock()
	conn.Close()
}
