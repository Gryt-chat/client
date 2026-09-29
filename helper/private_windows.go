package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"os"
	"strings"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

// Named after the account, since pipe names are shared by every user on the machine.
// electron/presenceHelper.ts works out the same name.
func privatePath() string {
	account := strings.ToLower(os.Getenv("USERDOMAIN") + `\` + os.Getenv("USERNAME"))
	sum := sha256.Sum256([]byte(account))
	return `\\.\pipe\gryt-helper-` + hex.EncodeToString(sum[:8])
}

var errAlreadyRunning = errors.New("another helper is already running, or something else has its pipe")

type privateListener struct{ net.Listener }

// Only this account and SYSTEM may open it. FILE_CREATE also means a pipe somebody made first is never joined.
func listenPrivate(path string) (*privateListener, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, err
	}
	sddl := "D:P(A;;GA;;;" + user.User.Sid.String() + ")(A;;GA;;;SY)"
	l, err := winio.ListenPipe(path, &winio.PipeConfig{SecurityDescriptor: sddl})
	if err != nil {
		return nil, errors.Join(errAlreadyRunning, err)
	}
	return &privateListener{Listener: l}, nil
}
