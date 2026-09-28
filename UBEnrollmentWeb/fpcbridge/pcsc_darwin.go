//go:build darwin

package main

// macOS PCSC.framework bindings via purego (no cgo, so it cross-compiles from Windows).
// On macOS SCARDCONTEXT/SCARDHANDLE/LONG are int32_t and DWORD is uint32_t.

import (
	"bytes"
	"unsafe"

	"github.com/ebitengine/purego"
)

type ctxHandle int32
type cardHandle int32

type ioRequest struct {
	protocol  uint32
	pciLength uint32
}

var (
	sCardEstablishContext func(scope uint32, r1, r2 unsafe.Pointer, ctx *int32) int32
	sCardReleaseContext   func(ctx int32) int32
	sCardListReaders      func(ctx int32, groups *byte, readers *byte, n *uint32) int32
	sCardConnect          func(ctx int32, reader *byte, share, protocols uint32, card *int32, active *uint32) int32
	sCardDisconnect       func(card int32, disposition uint32) int32
	sCardTransmit         func(card int32, sendPci uintptr, send *byte, sendLen uint32, recvPci uintptr, recv *byte, recvLen *uint32) int32
	sCardStatus           func(card int32, name *byte, nameLen *uint32, state, proto *uint32, atr *byte, atrLen *uint32) int32

	// Addresses of SCARD_IO_REQUEST structs: the framework's own (C memory) or the package-level fallbacks.
	pciT0 uintptr
	pciT1 uintptr
)

// Fallback SCARD_IO_REQUEST values if the framework's g_rgSCardT*Pci symbols can't be found.
var localPciT0, localPciT1 = ioRequest{scardProtocolT0, 8}, ioRequest{scardProtocolT1, 8}

func init() {
	lib, err := purego.Dlopen("/System/Library/Frameworks/PCSC.framework/PCSC", purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if err != nil {
		panic("cannot load PCSC.framework: " + err.Error())
	}
	purego.RegisterLibFunc(&sCardEstablishContext, lib, "SCardEstablishContext")
	purego.RegisterLibFunc(&sCardReleaseContext, lib, "SCardReleaseContext")
	purego.RegisterLibFunc(&sCardListReaders, lib, "SCardListReaders")
	purego.RegisterLibFunc(&sCardConnect, lib, "SCardConnect")
	purego.RegisterLibFunc(&sCardDisconnect, lib, "SCardDisconnect")
	purego.RegisterLibFunc(&sCardTransmit, lib, "SCardTransmit")
	purego.RegisterLibFunc(&sCardStatus, lib, "SCardStatus")

	// Package-level variables never move, so their addresses stay valid as uintptr.
	pciT0, pciT1 = uintptr(unsafe.Pointer(&localPciT0)), uintptr(unsafe.Pointer(&localPciT1))
	if p, err := purego.Dlsym(lib, "g_rgSCardT0Pci"); err == nil && p != 0 {
		pciT0 = p
	}
	if p, err := purego.Dlsym(lib, "g_rgSCardT1Pci"); err == nil && p != 0 {
		pciT1 = p
	}
}

func establishContext() (ctxHandle, int32) {
	var ctx int32
	r := sCardEstablishContext(scardScopeSystem, nil, nil, &ctx)
	return ctxHandle(ctx), r
}

func releaseContext(ctx ctxHandle) { sCardReleaseContext(int32(ctx)) }

func listReaders(ctx ctxHandle) ([]string, int32) {
	var n uint32
	if r := sCardListReaders(int32(ctx), nil, nil, &n); r != scardSuccess {
		return nil, r
	}
	if n == 0 {
		return []string{}, scardSuccess
	}
	buf := make([]byte, n)
	if r := sCardListReaders(int32(ctx), nil, &buf[0], &n); r != scardSuccess {
		return nil, r
	}

	// multi-string: "reader1\0reader2\0\0" (UTF-8)
	var readers []string
	for _, part := range bytes.Split(buf[:n], []byte{0}) {
		if len(part) > 0 {
			readers = append(readers, string(part))
		}
	}
	return readers, scardSuccess
}

func connect(ctx ctxHandle, reader string) (cardHandle, uint32, int32) {
	name := append([]byte(reader), 0)
	var card int32
	var proto uint32
	r := sCardConnect(int32(ctx), &name[0], scardShareShared, scardProtocolT0|scardProtocolT1, &card, &proto)
	return cardHandle(card), proto, r
}

func getATR(card cardHandle) []byte {
	name := make([]byte, 256)
	nameLen := uint32(len(name))
	var state, proto uint32
	atr := make([]byte, 64)
	atrLen := uint32(len(atr))
	if r := sCardStatus(int32(card), &name[0], &nameLen, &state, &proto, &atr[0], &atrLen); r != scardSuccess {
		return nil
	}
	return atr[:atrLen]
}

func transmit(card cardHandle, proto uint32, apdu []byte) ([]byte, int32) {
	if len(apdu) == 0 {
		return nil, int32(-2146435068) // 0x80100004 SCARD_E_INVALID_PARAMETER
	}
	pci := pciT0
	if proto == scardProtocolT1 {
		pci = pciT1
	}
	recv := make([]byte, 8192) // well within PC/SC limits on all macOS versions
	n := uint32(len(recv))
	r := sCardTransmit(int32(card), pci, &apdu[0], uint32(len(apdu)), 0, &recv[0], &n)
	if r != scardSuccess {
		return nil, r
	}
	return recv[:n], scardSuccess
}

func disconnect(card cardHandle, disposition uint32) { sCardDisconnect(int32(card), disposition) }
