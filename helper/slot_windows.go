package main

import (
	"errors"
	"fmt"
	"net"

	"github.com/Microsoft/go-winio"
)

// ListenPipe creates the first instance with FILE_CREATE, so it fails when any other
// program already has the pipe. That is the whole check, and it never connects.
type windowsSlots struct{ prefix string }

func (w windowsSlots) name(slot int) string { return fmt.Sprintf(`%sdiscord-ipc-%d`, w.prefix, slot) }

func (w windowsSlots) WorthRetrying(int) bool { return true }

func (w windowsSlots) Claim(slot int) (claimedSlot, error) {
	l, err := winio.ListenPipe(w.name(slot), &winio.PipeConfig{InputBufferSize: 64 * 1024, OutputBufferSize: 64 * 1024})
	if err != nil {
		return nil, errors.Join(errHeld, err)
	}
	return &windowsSlot{l: l}, nil
}

// A pipe goes away with its last handle, so there is no file to leave behind.
type windowsSlot struct{ l net.Listener }

func (s *windowsSlot) Listener() net.Listener { return s.l }
func (s *windowsSlot) StillOurs() bool        { return true }
func (s *windowsSlot) Release()               { s.l.Close() }

func newPlatformSlots(prefix string) slotPlatform {
	if prefix == "" {
		prefix = `\\.\pipe\`
	}
	return windowsSlots{prefix: prefix}
}
