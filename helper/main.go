// gryt-helper holds the Discord Rich Presence socket for the Gryt app, starting at login
// once somebody turns it on. It only takes a slot nobody else holds (GRYT-1605).
package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

var version = "dev"

func main() {
	ipcDirFlag := flag.String("ipc-dir", "", "where to put the discord-ipc sockets (tests)")
	privateFlag := flag.String("private", "", "the socket or pipe the app connects to (tests)")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	log.SetFlags(log.LstdFlags)
	log.SetPrefix("gryt-helper: ")

	private := *privateFlag
	if private == "" {
		private = privatePath()
	}
	if err := run(private, newPlatformSlots(*ipcDirFlag), 3*time.Second, nil); err != nil {
		if errors.Is(err, errAlreadyRunning) {
			log.Print(err)
			return
		}
		log.Fatal(err)
	}
}

// Runs until a signal, an app says quit, or a test closes done.
func run(private string, platform slotPlatform, every time.Duration, done <-chan struct{}) error {
	l, err := listenPrivate(private)
	if err != nil {
		return err
	}

	stop := make(chan struct{})
	var once sync.Once
	quit := func() { once.Do(func() { close(stop) }) }

	hub := NewHub(quit)
	slots := NewSlots(platform, hub, every)
	go slots.Run(stop)
	go func() {
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			go hub.ServeApp(conn)
		}
	}()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	select {
	case <-stop:
	case <-signals:
	case <-done:
	}
	quit()
	slots.Stop()
	l.Close()
	return nil
}
