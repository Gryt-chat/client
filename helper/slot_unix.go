//go:build darwin || linux

package main

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// The folder the discord-rpc libraries look in: the first of these that is set.
func ipcDir() string {
	for _, key := range []string{"XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"} {
		if dir := os.Getenv(key); dir != "" {
			return dir
		}
	}
	return "/tmp"
}

// Who listens on which socket path. Found without connecting, since Discord takes any
// connection for a game. A pid of 0 means somebody listens and we couldn't tell who.
type listenerTable func() (map[string]int, error)

type unixSlots struct {
	dir   string
	table listenerTable
	// The pid that held each slot when we last tried, so a retry is a kill(pid, 0) until it's gone.
	holders map[int]int
}

func newUnixSlots(dir string, table listenerTable) *unixSlots {
	return &unixSlots{dir: dir, table: table, holders: map[int]int{}}
}

func (u *unixSlots) path(slot int) string {
	return filepath.Join(u.dir, fmt.Sprintf("discord-ipc-%d", slot))
}

// Our own socket shows under the private name it was bound at, before the link.
func holderOf(table map[string]int, path string) (int, bool) {
	for name, pid := range table {
		if pid == os.Getpid() {
			continue
		}
		if name == path || strings.HasPrefix(name, path+".gryt-") {
			return pid, true
		}
	}
	return 0, false
}

func (u *unixSlots) WorthRetrying(slot int) bool {
	pid, known := u.holders[slot]
	if !known || pid == 0 {
		return true
	}
	if syscall.Kill(pid, 0) == syscall.ESRCH {
		delete(u.holders, slot)
		return true
	}
	return false
}

func (u *unixSlots) Claim(slot int) (claimedSlot, error) {
	path := u.path(slot)
	if info, err := os.Lstat(path); err == nil {
		table, err := u.table()
		if err != nil {
			// Can't tell whether anyone listens, so it's treated as held and left alone.
			u.holders[slot] = 0
			return nil, errHeld
		}
		if pid, held := holderOf(table, path); held {
			u.holders[slot] = pid
			return nil, errHeld
		}
		// Nobody listens: a Discord that quit or crashed left it. Only a socket of ours is removed.
		st, ok := info.Sys().(*syscall.Stat_t)
		if info.Mode()&os.ModeSocket == 0 || !ok || int(st.Uid) != os.Getuid() {
			u.holders[slot] = 0
			return nil, errHeld
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return nil, errHeld
		}
	}
	delete(u.holders, slot)

	// Bound under a private name and hard-linked into place, since link() won't replace a
	// socket somebody made in the meantime.
	temp := fmt.Sprintf("%s.gryt-%d", path, os.Getpid())
	_ = os.Remove(temp)
	l, err := net.Listen("unix", temp)
	if err != nil {
		return nil, err
	}
	l.(*net.UnixListener).SetUnlinkOnClose(false)
	defer os.Remove(temp)
	if err := os.Link(temp, path); err != nil {
		l.Close()
		return nil, errHeld
	}
	var st syscall.Stat_t
	if err := syscall.Stat(path, &st); err != nil {
		l.Close()
		return nil, err
	}
	return &unixSlot{path: path, ino: st.Ino, dev: uint64(st.Dev), l: l}, nil
}

type unixSlot struct {
	path string
	ino  uint64
	dev  uint64
	l    net.Listener
}

func (s *unixSlot) Listener() net.Listener { return s.l }

func (s *unixSlot) StillOurs() bool {
	var st syscall.Stat_t
	return syscall.Stat(s.path, &st) == nil && st.Ino == s.ino && uint64(st.Dev) == s.dev
}

func (s *unixSlot) Release() {
	if s.StillOurs() {
		_ = os.Remove(s.path)
	}
	s.l.Close()
}
