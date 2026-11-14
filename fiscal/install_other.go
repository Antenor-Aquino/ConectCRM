//go:build !windows

package main

import (
	"errors"
	"fmt"
)

func install() (string, error)   { return "", errors.New("a instalação é só para Windows") }
func uninstall() (string, error) { return "", errors.New("a instalação é só para Windows") }
func report(msg string, err error) {
	if err != nil {
		fmt.Println("erro:", err)
		return
	}
	fmt.Println(msg)
}
