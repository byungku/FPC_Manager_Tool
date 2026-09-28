package main

// Minimal RFC 6455 WebSocket server side (text messages, ping/pong, close).
// Kept dependency-free on purpose; the bridge only exchanges small JSON messages.

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
)

const (
	wsGUID       = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	wsMaxMessage = 1 << 20

	opContinuation = 0x0
	opText         = 0x1
	opBinary       = 0x2
	opClose        = 0x8
	opPing         = 0x9
	opPong         = 0xA
)

type wsConn struct {
	conn net.Conn
	r    *bufio.Reader
	wmu  sync.Mutex
}

func headerHasToken(h http.Header, name, token string) bool {
	for _, v := range h.Values(name) {
		for _, t := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(t), token) {
				return true
			}
		}
	}
	return false
}

func upgradeWebSocket(w http.ResponseWriter, r *http.Request) (*wsConn, error) {
	if r.Method != http.MethodGet || !headerHasToken(r.Header, "Connection", "upgrade") ||
		!headerHasToken(r.Header, "Upgrade", "websocket") {
		return nil, errors.New("WebSocket required")
	}
	if r.Header.Get("Sec-WebSocket-Version") != "13" {
		return nil, errors.New("unsupported WebSocket version")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("missing Sec-WebSocket-Key")
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("hijacking not supported")
	}
	conn, brw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}

	sum := sha1.Sum([]byte(key + wsGUID))
	accept := base64.StdEncoding.EncodeToString(sum[:])
	brw.WriteString("HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n")
	if err := brw.Flush(); err != nil {
		conn.Close()
		return nil, err
	}
	return &wsConn{conn: conn, r: brw.Reader}, nil
}

func (c *wsConn) Close() error { return c.conn.Close() }

// ReadMessage returns the next complete text/binary message, answering pings and closes.
func (c *wsConn) ReadMessage() ([]byte, error) {
	var msg []byte
	inMessage := false

	for {
		var hdr [2]byte
		if _, err := io.ReadFull(c.r, hdr[:]); err != nil {
			return nil, err
		}
		fin := hdr[0]&0x80 != 0
		op := hdr[0] & 0x0F
		masked := hdr[1]&0x80 != 0
		n := uint64(hdr[1] & 0x7F)

		switch n {
		case 126:
			var ext [2]byte
			if _, err := io.ReadFull(c.r, ext[:]); err != nil {
				return nil, err
			}
			n = uint64(binary.BigEndian.Uint16(ext[:]))
		case 127:
			var ext [8]byte
			if _, err := io.ReadFull(c.r, ext[:]); err != nil {
				return nil, err
			}
			n = binary.BigEndian.Uint64(ext[:])
		}
		if n > wsMaxMessage || uint64(len(msg))+n > wsMaxMessage {
			c.writeFrame(opClose, []byte{0x03, 0xF1}) // 1009 message too big
			return nil, errors.New("message too big")
		}
		if !masked {
			return nil, errors.New("client frame not masked")
		}

		var mask [4]byte
		if _, err := io.ReadFull(c.r, mask[:]); err != nil {
			return nil, err
		}
		payload := make([]byte, n)
		if _, err := io.ReadFull(c.r, payload); err != nil {
			return nil, err
		}
		for i := range payload {
			payload[i] ^= mask[i%4]
		}

		switch op {
		case opClose:
			c.writeFrame(opClose, payload[:min(len(payload), 2)])
			return nil, io.EOF
		case opPing:
			c.writeFrame(opPong, payload)
			continue
		case opPong:
			continue
		case opText, opBinary:
			if inMessage {
				return nil, errors.New("unexpected new message")
			}
			inMessage = true
			msg = append(msg[:0], payload...)
		case opContinuation:
			if !inMessage {
				return nil, errors.New("unexpected continuation")
			}
			msg = append(msg, payload...)
		default:
			return nil, errors.New("unknown opcode")
		}

		if fin {
			return msg, nil
		}
	}
}

func (c *wsConn) WriteText(data []byte) error { return c.writeFrame(opText, data) }

func (c *wsConn) writeFrame(op byte, data []byte) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()

	hdr := []byte{0x80 | op}
	switch n := len(data); {
	case n < 126:
		hdr = append(hdr, byte(n))
	case n <= 0xFFFF:
		hdr = append(hdr, 126, byte(n>>8), byte(n))
	default:
		var ext [8]byte
		binary.BigEndian.PutUint64(ext[:], uint64(n))
		hdr = append(append(hdr, 127), ext[:]...)
	}
	if _, err := c.conn.Write(append(hdr, data...)); err != nil {
		return err
	}
	return nil
}
