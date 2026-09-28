package main

// Platform-independent PC/SC session logic. The raw calls live in
// pcsc_windows.go (winscard.dll) and pcsc_darwin.go (PCSC.framework).

import (
	"errors"
	"fmt"
)

const (
	scardScopeSystem  = 2
	scardShareShared  = 2
	scardProtocolT0   = 1
	scardProtocolT1   = 2
	scardLeaveCard    = 0
	scardUnpowerCard  = 2
	recvBufferSize    = 65538
	scardSuccess      = 0
	errNoService      = int32(-2146435043) // 0x8010001D
	errServiceStopped = int32(-2146435042) // 0x8010001E
	errNoReaders      = int32(-2146435026) // 0x8010002E
	errInvalidHandle  = int32(-2146435069) // 0x80100003
)

var scardErrorNames = map[uint32]string{
	0x80100001: "SCARD_F_INTERNAL_ERROR",
	0x80100002: "SCARD_E_CANCELLED",
	0x80100003: "SCARD_E_INVALID_HANDLE",
	0x80100004: "SCARD_E_INVALID_PARAMETER",
	0x80100008: "SCARD_E_INSUFFICIENT_BUFFER",
	0x80100009: "SCARD_E_UNKNOWN_READER",
	0x8010000A: "SCARD_E_TIMEOUT",
	0x8010000B: "SCARD_E_SHARING_VIOLATION",
	0x8010000C: "SCARD_E_NO_SMARTCARD",
	0x8010000F: "SCARD_E_PROTO_MISMATCH",
	0x80100016: "SCARD_E_NOT_TRANSACTED",
	0x80100017: "SCARD_E_READER_UNAVAILABLE",
	0x8010001D: "SCARD_E_NO_SERVICE",
	0x8010001E: "SCARD_E_SERVICE_STOPPED",
	0x8010002E: "SCARD_E_NO_READERS_AVAILABLE",
	0x80100065: "SCARD_W_UNSUPPORTED_CARD",
	0x80100066: "SCARD_W_UNRESPONSIVE_CARD",
	0x80100067: "SCARD_W_UNPOWERED_CARD",
	0x80100068: "SCARD_W_RESET_CARD",
	0x80100069: "SCARD_W_REMOVED_CARD",
}

type scardError struct {
	fn   string
	code int32
}

func (e *scardError) Error() string {
	name, ok := scardErrorNames[uint32(e.code)]
	if !ok {
		name = "SCARD_ERROR"
	}
	return fmt.Sprintf("%s failed: %s (0x%08X)", e.fn, name, uint32(e.code))
}

// One PC/SC context + (at most) one card handle per WebSocket client.
type cardSession struct {
	ctx     ctxHandle
	card    cardHandle
	proto   uint32
	hasCtx  bool
	hasCard bool
}

func newCardSession() *cardSession { return &cardSession{} }

func (s *cardSession) ensureContext() error {
	if s.hasCtx {
		return nil
	}
	ctx, rc := establishContext()
	if rc != scardSuccess {
		return &scardError{"SCardEstablishContext", rc}
	}
	s.ctx, s.hasCtx = ctx, true
	return nil
}

func (s *cardSession) resetContext() {
	s.disconnectCard(scardLeaveCard)
	if s.hasCtx {
		releaseContext(s.ctx)
		s.hasCtx = false
	}
}

func (s *cardSession) ListReaders() ([]string, error) {
	for attempt := 0; ; attempt++ {
		if err := s.ensureContext(); err != nil {
			return nil, err
		}
		readers, rc := listReaders(s.ctx)
		switch {
		case rc == scardSuccess:
			return readers, nil
		case rc == errNoReaders:
			return []string{}, nil
		case (rc == errServiceStopped || rc == errNoService || rc == errInvalidHandle) && attempt == 0:
			// Smart card service restarted (e.g. last reader unplugged) - get a fresh context.
			s.resetContext()
		default:
			return nil, &scardError{"SCardListReaders", rc}
		}
	}
}

func (s *cardSession) Connect(reader string) ([]byte, string, error) {
	if err := s.ensureContext(); err != nil {
		return nil, "", err
	}
	s.disconnectCard(scardUnpowerCard)

	card, proto, rc := connect(s.ctx, reader)
	if rc != scardSuccess {
		return nil, "", &scardError{"SCardConnect", rc}
	}
	s.card, s.proto, s.hasCard = card, proto, true

	name := fmt.Sprint(proto)
	switch proto {
	case scardProtocolT0:
		name = "T0"
	case scardProtocolT1:
		name = "T1"
	}
	return getATR(card), name, nil
}

func (s *cardSession) Transmit(apdu []byte) ([]byte, error) {
	if !s.hasCard {
		return nil, errors.New("Card not connected")
	}
	rapdu, rc := transmit(s.card, s.proto, apdu)
	if rc != scardSuccess {
		return nil, &scardError{"SCardTransmit", rc}
	}
	return rapdu, nil
}

func (s *cardSession) Disconnect() { s.disconnectCard(scardUnpowerCard) }

func (s *cardSession) disconnectCard(disposition uint32) {
	if s.hasCard {
		disconnect(s.card, disposition)
		s.hasCard = false
	}
}

func (s *cardSession) Close() {
	s.disconnectCard(scardUnpowerCard)
	s.resetContext()
}
