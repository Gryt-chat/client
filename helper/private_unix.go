//go:build darwin || linux

package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

// Where the app finds the helper. electron/presenceHelper.ts works out the same path.
func privatePath() string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support", "chat.gryt.helper", "helper.sock")
	}
	if dir := os.Getenv("XDG_RUNTIME_DIR"); dir != "" {
		return filepath.Join(dir, "gryt-helper", "helper.sock")
	}
	return filepath.Join(home, ".cache", "gryt-helper", "helper.sock")
}

var errAlreadyRunning = errors.New("another helper is already running")

// A folder only we can enter, so nobody else can open the socket or put one there first.
func privateDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !info.IsDir() || !ok || int(st.Uid) != os.Getuid() {
		return fmt.Errorf("%s is not a folder of ours", dir)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return os.Chmod(dir, 0o700)
	}
	return nil
}

type privateListener struct {
	net.Listener
	path string
	ino  uint64
}

func listenPrivate(path string) (*privateListener, error) {
	if err := privateDir(filepath.Dir(path)); err != nil {
		return nil, err
	}
	if _, err := os.Lstat(path); err == nil {
		// Our own protocol, so connecting is how to tell a running helper from a stale file.
		if conn, err := net.DialTimeout("unix", path, time.Second); err == nil {
			conn.Close()
			return nil, errAlreadyRunning
		}
		_ = os.Remove(path)
	}
	temp := fmt.Sprintf("%s.%d", path, os.Getpid())
	_ = os.Remove(temp)
	l, err := net.Listen("unix", temp)
	if err != nil {
		return nil, err
	}
	l.(*net.UnixListener).SetUnlinkOnClose(false)
	defer os.Remove(temp)
	_ = os.Chmod(temp, 0o600)
	if err := os.Link(temp, path); err != nil {
		l.Close()
		return nil, errAlreadyRunning
	}
	var st syscall.Stat_t
	_ = syscall.Stat(path, &st)
	return &privateListener{Listener: l, path: path, ino: st.Ino}, nil
}

func (p *privateListener) Close() error {
	var st syscall.Stat_t
	if syscall.Stat(p.path, &st) == nil && st.Ino == p.ino {
		_ = os.Remove(p.path)
	}
	return p.Listener.Close()
}

func newPlatformSlots(dir string) slotPlatform {
	if dir == "" {
		dir = ipcDir()
	}
	return newUnixSlots(dir, platformListeners())
}
