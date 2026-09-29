package main

// The Discord Rich Presence protocol, the part a game uses: a handshake, then
// SET_ACTIVITY. Mirrors electron/discordIpc.ts, which the app uses without the helper.

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"regexp"
	"sync/atomic"
)

const (
	opHandshake = 0
	opFrame     = 1
	opClose     = 2
	opPing      = 3
	opPong      = 4

	// An activity is a few hundred bytes. Past this a peer isn't a game talking to Discord.
	maxFrameBytes = 64 * 1024
)

var clientIDPattern = regexp.MustCompile(`^\d{1,32}$`)

// The READY Discord sends, with a user who is nobody in particular.
var readyFrame = map[string]any{
	"cmd":   "DISPATCH",
	"evt":   "READY",
	"nonce": nil,
	"data": map[string]any{
		"v":      1,
		"config": map[string]any{"cdn_host": "cdn.discordapp.com", "api_endpoint": "//discord.com/api", "environment": "production"},
		"user":   map[string]any{"id": "0", "username": "gryt", "discriminator": "0", "global_name": "Gryt", "avatar": nil, "bot": false, "flags": 0, "premium_type": 0},
	},
}

func writeFrame(w io.Writer, op int32, body any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	header := make([]byte, 8)
	binary.LittleEndian.PutUint32(header[0:4], uint32(op))
	binary.LittleEndian.PutUint32(header[4:8], uint32(len(payload)))
	_, err = w.Write(append(header, payload...))
	return err
}

var errBadFrame = errors.New("bad frame")

func readFrame(r io.Reader) (int32, map[string]any, error) {
	header := make([]byte, 8)
	if _, err := io.ReadFull(r, header); err != nil {
		return 0, nil, err
	}
	op := int32(binary.LittleEndian.Uint32(header[0:4]))
	size := int32(binary.LittleEndian.Uint32(header[4:8]))
	if op < opHandshake || op > opPong || size < 0 || size > maxFrameBytes {
		return 0, nil, errBadFrame
	}
	payload := make([]byte, size)
	if _, err := io.ReadFull(r, payload); err != nil {
		return 0, nil, err
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		// A PING can carry any JSON. Only an object is something we act on.
		return op, nil, nil
	}
	return op, body, nil
}

var connectionSeq atomic.Int64

// Serves one game until it hangs up. Every activity, and the clear when it leaves, goes to the hub.
func serveGame(conn net.Conn, hub *Hub) {
	defer conn.Close()
	id := connectionSeq.Add(1)
	clientID := ""
	var lastPid *float64
	hadActivity := false

	report := func(activity map[string]any) {
		if clientID == "" || (activity == nil && !hadActivity) {
			return
		}
		hadActivity = activity != nil
		hub.Activity(ActivityEvent{Connection: id, ClientID: clientID, Pid: lastPid, Activity: activity})
	}
	defer func() { report(nil) }()

	closeWith := func(code int, message string) {
		_ = writeFrame(conn, opClose, map[string]any{"code": code, "message": message})
	}

	for {
		op, body, err := readFrame(conn)
		if err != nil {
			if errors.Is(err, errBadFrame) {
				closeWith(1003, "Bad frame")
			}
			return
		}
		switch op {
		case opHandshake:
			if clientID != "" {
				closeWith(1003, "Already shook hands")
				return
			}
			if v, ok := body["v"].(float64); ok && v != 1 {
				closeWith(4004, "Invalid version")
				return
			}
			id, _ := body["client_id"].(string)
			if !clientIDPattern.MatchString(id) {
				closeWith(4000, "Invalid client id")
				return
			}
			clientID = id
			if writeFrame(conn, opFrame, readyFrame) != nil {
				return
			}
		case opPing:
			_ = writeFrame(conn, opPong, body)
		case opClose:
			return
		case opFrame:
			if body == nil {
				continue
			}
			if clientID == "" {
				closeWith(1003, "Handshake first")
				return
			}
			cmd, _ := body["cmd"].(string)
			nonce := body["nonce"]
			args, _ := body["args"].(map[string]any)
			switch cmd {
			case "SET_ACTIVITY":
				if pid, ok := args["pid"].(float64); ok {
					lastPid = &pid
				}
				activity, _ := args["activity"].(map[string]any)
				report(activity)
				var data any
				if activity != nil {
					echo := map[string]any{}
					for k, v := range activity {
						echo[k] = v
					}
					echo["name"], echo["application_id"], echo["type"] = "", clientID, 0
					data = echo
				}
				_ = writeFrame(conn, opFrame, map[string]any{"cmd": cmd, "evt": nil, "nonce": nonce, "data": data})
			case "SUBSCRIBE", "UNSUBSCRIBE":
				_ = writeFrame(conn, opFrame, map[string]any{"cmd": cmd, "evt": nil, "nonce": nonce, "data": map[string]any{"evt": body["evt"]}})
			default:
				_ = writeFrame(conn, opFrame, map[string]any{"cmd": cmd, "evt": "ERROR", "nonce": nonce, "data": map[string]any{"code": 4002, "message": "Not supported by Gryt"}})
			}
		}
	}
}
