//go:build windows

package main

// winscard.dll bindings (Unicode API). Handles are pointer-sized on Windows.

import (
	"syscall"
	"unsafe"
)

type ctxHandle uintptr
type cardHandle uintptr

var (
	winscard                  = syscall.NewLazyDLL("winscard.dll")
	procSCardEstablishContext = winscard.NewProc("SCardEstablishContext")
	procSCardReleaseContext   = winscard.NewProc("SCardReleaseContext")
	procSCardListReadersW     = winscard.NewProc("SCardListReadersW")
	procSCardConnectW         = winscard.NewProc("SCardConnectW")
	procSCardDisconnect       = winscard.NewProc("SCardDisconnect")
	procSCardTransmit         = winscard.NewProc("SCardTransmit")
	procSCardGetAttrib        = winscard.NewProc("SCardGetAttrib")
)

const scardAttrATRString = 0x00090303

// SCARD_IO_REQUEST { DWORD dwProtocol; DWORD cbPciLength; }
type ioRequest struct {
	protocol  uint32
	pciLength uint32
}

var (
	pciT0 = ioRequest{scardProtocolT0, 8}
	pciT1 = ioRequest{scardProtocolT1, 8}
)

func rc(r uintptr) int32 { return int32(uint32(r)) }

func establishContext() (ctxHandle, int32) {
	var ctx uintptr
	r, _, _ := procSCardEstablishContext.Call(scardScopeSystem, 0, 0, uintptr(unsafe.Pointer(&ctx)))
	return ctxHandle(ctx), rc(r)
}

func releaseContext(ctx ctxHandle) {
	procSCardReleaseContext.Call(uintptr(ctx))
}

func listReaders(ctx ctxHandle) ([]string, int32) {
	var n uint32
	r, _, _ := procSCardListReadersW.Call(uintptr(ctx), 0, 0, uintptr(unsafe.Pointer(&n)))
	if rc(r) != scardSuccess {
		return nil, rc(r)
	}
	buf := make([]uint16, n)
	r, _, _ = procSCardListReadersW.Call(uintptr(ctx), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n)))
	if rc(r) != scardSuccess {
		return nil, rc(r)
	}

	// multi-string: "reader1\0reader2\0\0"
	var readers []string
	start := 0
	for i := 0; i < int(n); i++ {
		if buf[i] == 0 {
			if i > start {
				readers = append(readers, syscall.UTF16ToString(buf[start:i]))
			}
			start = i + 1
		}
	}
	return readers, scardSuccess
}

func connect(ctx ctxHandle, reader string) (cardHandle, uint32, int32) {
	name, err := syscall.UTF16PtrFromString(reader)
	if err != nil {
		return 0, 0, int32(-2146435068) // 0x80100004 SCARD_E_INVALID_PARAMETER
	}
	var card uintptr
	var proto uint32
	r, _, _ := procSCardConnectW.Call(uintptr(ctx), uintptr(unsafe.Pointer(name)),
		scardShareShared, scardProtocolT0|scardProtocolT1,
		uintptr(unsafe.Pointer(&card)), uintptr(unsafe.Pointer(&proto)))
	return cardHandle(card), proto, rc(r)
}

func getATR(card cardHandle) []byte {
	atr := make([]byte, 64)
	n := uint32(len(atr))
	r, _, _ := procSCardGetAttrib.Call(uintptr(card), scardAttrATRString,
		uintptr(unsafe.Pointer(&atr[0])), uintptr(unsafe.Pointer(&n)))
	if rc(r) != scardSuccess {
		return nil
	}
	return atr[:n]
}

func transmit(card cardHandle, proto uint32, apdu []byte) ([]byte, int32) {
	if len(apdu) == 0 {
		return nil, int32(-2146435068) // SCARD_E_INVALID_PARAMETER
	}
	pci := &pciT0
	if proto == scardProtocolT1 {
		pci = &pciT1
	}
	recv := make([]byte, recvBufferSize)
	n := uint32(len(recv))
	r, _, _ := procSCardTransmit.Call(uintptr(card), uintptr(unsafe.Pointer(pci)),
		uintptr(unsafe.Pointer(&apdu[0])), uintptr(len(apdu)), 0,
		uintptr(unsafe.Pointer(&recv[0])), uintptr(unsafe.Pointer(&n)))
	if rc(r) != scardSuccess {
		return nil, rc(r)
	}
	return recv[:n], scardSuccess
}

func disconnect(card cardHandle, disposition uint32) {
	procSCardDisconnect.Call(uintptr(card), uintptr(disposition))
}
