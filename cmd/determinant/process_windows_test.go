//go:build windows

package main

import "os/exec"

func configureProcessGroup(command *exec.Cmd) {}

func terminateCommand(command *exec.Cmd) {
	if command.Process == nil {
		return
	}
	_ = command.Process.Kill()
	_, _ = command.Process.Wait()
}
