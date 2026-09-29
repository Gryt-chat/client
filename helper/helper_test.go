//go:build darwin || linux

package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"
)

// macOS caps a socket path at 104 bytes, and t.TempDir() there is long enough to hit it.
func shortDir(t *testing.T) string {
	dir, err := os.MkdirTemp("/tmp", "gh")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}

// A listener table the test controls, standing in for lsof or /proc/net/unix.
type fakeTable struct {
	mu    sync.Mutex
	names map[string]int
}

func (f *fakeTable) set(name string, pid int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.names[name] = pid
}

func (f *fakeTable) drop(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.names, name)
}

func (f *fakeTable) read() (map[string]int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]int{}
	for k, v := range f.names {
		out[k] = v
	}
	return out, nil
}

type harness struct {
	t       *testing.T
	ipc     string
	private string
	table   *fakeTable
	done    chan struct{}
	exited  chan error
}

func start(t *testing.T, before func(h *harness)) *harness {
	h := &harness{t: t, ipc: shortDir(t), table: &fakeTable{names: map[string]int{}}, done: make(chan struct{}), exited: make(chan error, 1)}
	h.private = filepath.Join(shortDir(t), "p", "helper.sock")
	if before != nil {
		before(h)
	}
	go func() { h.exited <- run(h.private, newUnixSlots(h.ipc, h.table.read), 20*time.Millisecond, h.done) }()
	t.Cleanup(h.stop)
	return h
}

func (h *harness) stop() {
	select {
	case <-h.done:
	default:
		close(h.done)
	}
	select {
	case <-h.exited:
	case <-time.After(2 * time.Second):
	}
}

func (h *harness) slot(n int) string { return filepath.Join(h.ipc, "discord-ipc-"+string(rune('0'+n))) }

type appConn struct {
	t    *testing.T
	conn net.Conn
	r    *bufio.Scanner
}

func (h *harness) app() *appConn {
	var conn net.Conn
	var err error
	for i := 0; i < 100; i++ {
		if conn, err = net.Dial("unix", h.private); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		h.t.Fatal(err)
	}
	h.t.Cleanup(func() { conn.Close() })
	return &appConn{t: h.t, conn: conn, r: bufio.NewScanner(conn)}
}

func (a *appConn) next() map[string]any {
	_ = a.conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if !a.r.Scan() {
		a.t.Fatalf("no message from the helper: %v", a.r.Err())
	}
	var msg map[string]any
	if err := json.Unmarshal(a.r.Bytes(), &msg); err != nil {
		a.t.Fatal(err)
	}
	return msg
}

// Reads until a message matches, since state lines can come before or after the hello.
func (a *appConn) until(match func(map[string]any) bool) map[string]any {
	for i := 0; i < 50; i++ {
		if msg := a.next(); match(msg) {
			return msg
		}
	}
	a.t.Fatal("never got the message")
	return nil
}

func holdingSlot(n int) func(map[string]any) bool {
	return func(m map[string]any) bool { return m["state"] == "holding" && m["slot"] == float64(n) }
}

type game struct {
	t    *testing.T
	conn net.Conn
}

func dialGame(t *testing.T, path string) *game {
	var conn net.Conn
	var err error
	for i := 0; i < 100; i++ {
		if conn, err = net.Dial("unix", path); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return &game{t: t, conn: conn}
}

func (g *game) send(op int32, body any) {
	if err := writeFrame(g.conn, op, body); err != nil {
		g.t.Fatal(err)
	}
}

func (g *game) read() (int32, map[string]any) {
	_ = g.conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	op, body, err := readFrame(g.conn)
	if err != nil {
		g.t.Fatal(err)
	}
	return op, body
}

func (g *game) handshake(clientID string) {
	g.send(opHandshake, map[string]any{"v": 1, "client_id": clientID})
	if _, body := g.read(); body["evt"] != "READY" {
		g.t.Fatalf("expected READY, got %v", body)
	}
}

func (g *game) setActivity(activity any) {
	g.send(opFrame, map[string]any{"cmd": "SET_ACTIVITY", "nonce": "n1", "args": map[string]any{"pid": 42, "activity": activity}})
	g.read()
}

func inode(t *testing.T, path string) uint64 {
	var st syscall.Stat_t
	if err := syscall.Stat(path, &st); err != nil {
		t.Fatal(err)
	}
	return st.Ino
}

// Another program's socket, bound the ordinary way.
func otherListener(t *testing.T, path string) net.Listener {
	l, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	return l
}

func TestFramesInPieces(t *testing.T) {
	var buf bytes.Buffer
	_ = writeFrame(&buf, opFrame, map[string]any{"cmd": "SET_ACTIVITY"})
	r, w := net.Pipe()
	go func() {
		for _, b := range buf.Bytes() {
			_, _ = w.Write([]byte{b})
		}
	}()
	op, body, err := readFrame(r)
	if err != nil || op != opFrame || body["cmd"] != "SET_ACTIVITY" {
		t.Fatalf("got %d %v %v", op, body, err)
	}
}

func TestBadFrames(t *testing.T) {
	for name, header := range map[string][]byte{
		"oversize":   {1, 0, 0, 0, 0, 0, 2, 0},
		"bad opcode": {9, 0, 0, 0, 2, 0, 0, 0},
		"negative":   {1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff},
	} {
		if _, _, err := readFrame(bytes.NewReader(header)); err != errBadFrame {
			t.Errorf("%s: got %v", name, err)
		}
	}
}

func TestGameToApp(t *testing.T) {
	h := start(t, nil)
	app := h.app()
	app.until(holdingSlot(0))

	g := dialGame(t, h.slot(0))
	g.handshake("1234")
	g.setActivity(map[string]any{"details": "Ranked", "state": "In queue"})
	msg := app.until(func(m map[string]any) bool { return m["type"] == "activity" })
	activity, _ := msg["activity"].(map[string]any)
	if msg["clientId"] != "1234" || activity["details"] != "Ranked" || msg["pid"] != float64(42) {
		t.Fatalf("got %v", msg)
	}

	// An app that connects later gets what is showing now.
	late := h.app()
	late.until(func(m map[string]any) bool { return m["type"] == "activity" && m["clientId"] == "1234" })

	g.conn.Close()
	msg = app.until(func(m map[string]any) bool { return m["type"] == "activity" })
	if msg["activity"] != nil {
		t.Fatalf("expected a clear when the game left, got %v", msg)
	}
}

func TestHandshakeRules(t *testing.T) {
	h := start(t, nil)
	h.app().until(holdingSlot(0))

	g := dialGame(t, h.slot(0))
	g.send(opFrame, map[string]any{"cmd": "SET_ACTIVITY"})
	if op, body := g.read(); op != opClose || body["code"] != float64(1003) {
		t.Fatalf("a command before the handshake: %d %v", op, body)
	}

	g = dialGame(t, h.slot(0))
	g.send(opHandshake, map[string]any{"v": 1, "client_id": "not a number"})
	if op, body := g.read(); op != opClose || body["code"] != float64(4000) {
		t.Fatalf("a bad client id: %d %v", op, body)
	}

	g = dialGame(t, h.slot(0))
	g.handshake("99")
	g.send(opFrame, map[string]any{"cmd": "AUTHORIZE", "nonce": "x"})
	if _, body := g.read(); body["evt"] != "ERROR" {
		t.Fatalf("an unknown command: %v", body)
	}
	g.send(opPing, map[string]any{"a": 1})
	if op, _ := g.read(); op != opPong {
		t.Fatal("no pong")
	}
}

func TestHeldSlotIsLeftAlone(t *testing.T) {
	var discord net.Listener
	var before uint64
	h := start(t, func(h *harness) {
		discord = otherListener(t, h.slot(0))
		h.table.set(h.slot(0), 0)
		before = inode(t, h.slot(0))
	})
	app := h.app()
	app.until(holdingSlot(1))

	if inode(t, h.slot(0)) != before {
		t.Fatal("the helper replaced a socket somebody else holds")
	}
	// A game on slot 0 reaches the other program, not the helper.
	accepted := make(chan struct{}, 1)
	go func() {
		if c, err := discord.Accept(); err == nil {
			accepted <- struct{}{}
			c.Close()
		}
	}()
	dialGame(t, h.slot(0))
	select {
	case <-accepted:
	case <-time.After(2 * time.Second):
		t.Fatal("the other program never got the game")
	}

	// A game already on slot 1 keeps its connection when the helper moves down to 0.
	g := dialGame(t, h.slot(1))
	g.handshake("5")
	discord.Close()
	h.table.drop(h.slot(0))
	app.until(holdingSlot(0))
	g.setActivity(map[string]any{"details": "still here"})
	if _, err := os.Lstat(h.slot(1)); !os.IsNotExist(err) {
		t.Fatal("slot 1 should be gone once the helper holds slot 0")
	}
}

func TestStaleFileIsReplaced(t *testing.T) {
	h := start(t, func(h *harness) {
		l := otherListener(t, h.slot(0))
		l.(*net.UnixListener).SetUnlinkOnClose(false)
		l.Close()
	})
	h.app().until(holdingSlot(0))
	dialGame(t, h.slot(0)).handshake("7")
}

func TestPlainFileIsLeftAlone(t *testing.T) {
	var content = []byte("not a socket")
	h := start(t, func(h *harness) {
		if err := os.WriteFile(h.slot(0), content, 0o600); err != nil {
			t.Fatal(err)
		}
	})
	h.app().until(holdingSlot(1))
	if got, _ := os.ReadFile(h.slot(0)); !bytes.Equal(got, content) {
		t.Fatal("the helper touched a file that isn't a socket")
	}
}

func TestUnknownListenerIsLeftAlone(t *testing.T) {
	h := &harness{t: t, ipc: shortDir(t)}
	otherListener(t, h.slot(0))
	failing := func() (map[string]int, error) { return nil, os.ErrPermission }
	if _, err := newUnixSlots(h.ipc, failing).Claim(0); err != errHeld {
		t.Fatalf("a failed lookup must count as held, got %v", err)
	}
}

func TestQuitRemovesOnlyOurFile(t *testing.T) {
	h := start(t, nil)
	app := h.app()
	app.until(holdingSlot(0))
	_, _ = app.conn.Write([]byte(`{"type":"quit"}` + "\n"))
	select {
	case err := <-h.exited:
		h.exited <- err
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("quit didn't stop the helper")
	}
	if _, err := os.Lstat(h.slot(0)); !os.IsNotExist(err) {
		t.Fatal("slot 0 left behind")
	}
	if _, err := os.Lstat(h.private); !os.IsNotExist(err) {
		t.Fatal("private socket left behind")
	}
}

func TestReleaseSparesAReplacement(t *testing.T) {
	dir := shortDir(t)
	u := newUnixSlots(dir, (&fakeTable{names: map[string]int{}}).read)
	claimed, err := u.Claim(0)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "discord-ipc-0")
	_ = os.Remove(path)
	otherListener(t, path)
	theirs := inode(t, path)
	if claimed.StillOurs() {
		t.Fatal("a replaced file still reads as ours")
	}
	claimed.Release()
	if inode(t, path) != theirs {
		t.Fatal("release removed somebody else's socket")
	}
}

func TestOneHelperAtATime(t *testing.T) {
	h := start(t, nil)
	h.app().until(holdingSlot(0))
	if _, err := listenPrivate(h.private); err != errAlreadyRunning {
		t.Fatalf("a second helper got %v", err)
	}
	info, _ := os.Stat(filepath.Dir(h.private))
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("private folder is %v", info.Mode().Perm())
	}
}

func TestGameCap(t *testing.T) {
	h := start(t, nil)
	h.app().until(holdingSlot(0))
	for i := 0; i < maxGames; i++ {
		dialGame(t, h.slot(0)).handshake("1")
	}
	extra := dialGame(t, h.slot(0))
	_ = extra.conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := extra.conn.Read(make([]byte, 1)); err == nil {
		t.Fatal("a connection past the cap was served")
	}
}

// The real lookup finds a listener it never connected to.
func TestPlatformLookupFindsListener(t *testing.T) {
	dir := shortDir(t)
	path := filepath.Join(dir, "discord-ipc-0")
	otherListener(t, path)
	table, err := platformListeners()()
	if err != nil {
		t.Fatal(err)
	}
	// Our own pid is skipped, so look for the path itself rather than through holderOf.
	resolved, _ := filepath.EvalSymlinks(dir)
	if _, ok := table[path]; !ok {
		if _, ok := table[filepath.Join(resolved, "discord-ipc-0")]; !ok {
			t.Fatalf("listener at %s not found", path)
		}
	}
}
