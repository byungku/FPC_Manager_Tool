//go:build windows

package main

import (
	"bufio"
	"os"
	"os/exec"
)

func openBrowser(url string) error {
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// Keep a double-clicked console window open long enough to read a startup error.
func waitForEnterOnWindows() {
	logger.Println("Press Enter to close.")
	bufio.NewReader(os.Stdin).ReadString('\n')
}
