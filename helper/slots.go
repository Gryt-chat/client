package main

import (
	"errors"
	"net"
	"sync"
	"time"
)

// The discord-rpc libraries try discord-ipc-0 to discord-ipc-9 and use the first that answers.
const slotCount = 10

// A game that opens more than this is not a game.
const maxGames = 16

// errHeld means another program has the slot. The helper leaves it alone and looks again later.
var errHeld = errors.New("slot held by another program")

// One claimed slot. Release closes it and removes the name only if it still points at ours.
type claimedSlot interface {
	Listener() net.Listener
	StillOurs() bool
	Release()
}

// What a platform offers: claim a slot only when nobody holds it, and say whether
// slot 0 is worth trying again, which on macOS is a pid check rather than an lsof.
type slotPlatform interface {
	Claim(slot int) (claimedSlot, error)
	WorthRetrying(slot int) bool
}

type Slots struct {
	platform slotPlatform
	hub      *Hub
	every    time.Duration

	mu      sync.Mutex
	held    claimedSlot
	slot    int
	games   int
	stopped bool
}

func NewSlots(platform slotPlatform, hub *Hub, every time.Duration) *Slots {
	return &Slots{platform: platform, hub: hub, every: every, slot: -1}
}

// Holds the lowest free slot, and moves down to slot 0 once whatever had it lets go.
// Games already connected on the higher slot keep their connection.
func (s *Slots) Run(stop <-chan struct{}) {
	s.tick()
	t := time.NewTicker(s.every)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			s.tick()
		}
	}
}

func (s *Slots) tick() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped {
		return
	}
	if s.held != nil && !s.held.StillOurs() {
		// Somebody removed our name. The listener can't be reached any more, so it goes.
		s.held.Release()
		s.held, s.slot = nil, -1
	}
	if s.slot == 0 {
		return
	}
	limit := slotCount
	if s.held != nil {
		limit = s.slot
	}
	for slot := 0; slot < limit; slot++ {
		if !s.platform.WorthRetrying(slot) {
			continue
		}
		claimed, err := s.platform.Claim(slot)
		if err != nil {
			continue
		}
		if s.held != nil {
			s.held.Release()
		}
		s.held, s.slot = claimed, slot
		go s.accept(claimed.Listener())
		break
	}
	s.hub.SetState(SlotState{Holding: s.held != nil, Slot: max(s.slot, 0)})
}

func (s *Slots) accept(l net.Listener) {
	for {
		conn, err := l.Accept()
		if err != nil {
			return
		}
		s.mu.Lock()
		full := s.games >= maxGames
		if !full {
			s.games++
		}
		s.mu.Unlock()
		if full {
			conn.Close()
			continue
		}
		go func() {
			serveGame(conn, s.hub)
			s.mu.Lock()
			s.games--
			s.mu.Unlock()
		}()
	}
}

// Removes our name before returning, so a quit leaves no file behind for Discord to trip on.
func (s *Slots) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopped = true
	if s.held != nil {
		s.held.Release()
		s.held, s.slot = nil, -1
	}
}
