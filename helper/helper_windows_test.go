package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
)

func TestPipeHeldByAnotherIsLeftAlone(t *testing.T) {
	prefix := fmt.Sprintf(`\\.\pipe\gryt-test-%d-`, os.Getpid())
	theirs, err := winio.ListenPipe(prefix+"discord-ipc-0", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer theirs.Close()

	slots := newPlatformSlots(prefix)
	if _, err := slots.Claim(0); !errors.Is(err, errHeld) {
		t.Fatalf("claimed a pipe somebody else has: %v", err)
	}
	claimed, err := slots.Claim(1)
	if err != nil {
		t.Fatal(err)
	}
	claimed.Release()
}

func TestGameToAppOverPipes(t *testing.T) {
	prefix := fmt.Sprintf(`\\.\pipe\gryt-test-%d-`, os.Getpid())
	private := prefix + "private"
	done := make(chan struct{})
	exited := make(chan error, 1)
	go func() { exited <- run(private, newPlatformSlots(prefix), 20*time.Millisecond, done) }()
	defer func() { close(done); <-exited }()

	for i := 0; i < 100; i++ {
		if c, err := winio.DialPipe(private, nil); err == nil {
			c.Close()
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := listenPrivate(private); !errors.Is(err, errAlreadyRunning) {
		t.Fatalf("a second helper got %v", err)
	}
	app, err := winio.DialPipe(private, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	lines := bufio.NewScanner(app)

	var game interface {
		Write([]byte) (int, error)
		Read([]byte) (int, error)
		Close() error
	}
	for i := 0; i < 100; i++ {
		if game, err = winio.DialPipe(prefix+"discord-ipc-0", nil); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	defer game.Close()
	_ = writeFrame(game, opHandshake, map[string]any{"v": 1, "client_id": "77"})
	if _, body, err := readFrame(game); err != nil || body["evt"] != "READY" {
		t.Fatalf("handshake: %v %v", body, err)
	}
	_ = writeFrame(game, opFrame, map[string]any{"cmd": "SET_ACTIVITY", "args": map[string]any{"activity": map[string]any{"details": "x"}}})
	for lines.Scan() {
		var msg map[string]any
		_ = json.Unmarshal(lines.Bytes(), &msg)
		if msg["type"] == "activity" && msg["clientId"] == "77" {
			return
		}
	}
	t.Fatal("the app never got the activity")
}
