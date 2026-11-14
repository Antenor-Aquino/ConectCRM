//go:build windows

// Instalação só para o usuário atual (sem administrador): copia o programa para
// %LOCALAPPDATA%\ConectCRM\Fiscal, grava o manifesto do Native Messaging e o
// registra no Chrome e no Edge (HKCU). Só a extensão do ConectCRM pode usá-lo.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

var regKeys = []string{
	`Software\Google\Chrome\NativeMessagingHosts\` + hostName,
	`Software\Microsoft\Edge\NativeMessagingHosts\` + hostName,
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".novo"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	// Sobras de atualizações anteriores (versões que estavam em uso).
	if old, _ := filepath.Glob(dst + ".antigo*"); len(old) > 0 {
		for _, f := range old {
			_ = os.Remove(f)
		}
	}
	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		// Em uso pelo Chrome: o Windows não deixa apagar, mas deixa renomear.
		if err := os.Rename(dst, fmt.Sprintf("%s.antigo-%d", dst, time.Now().Unix())); err != nil {
			return fmt.Errorf("o programa antigo está em uso: feche o Chrome e instale de novo (%v)", err)
		}
	}
	return os.Rename(tmp, dst)
}

func install() (string, error) {
	dir := dataDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe := filepath.Join(dir, "ConectCRMFiscal.exe")
	if abs, _ := filepath.Abs(self); !sameFile(abs, exe) {
		if err := copyFile(self, exe); err != nil {
			return "", fmt.Errorf("não foi possível copiar o programa (feche o Chrome e tente de novo): %w", err)
		}
	}
	manifest := map[string]any{
		"name":            hostName,
		"description":     "ConectCRM Fiscal: assinatura e envio da NFS-e",
		"path":            exe,
		"type":            "stdio",
		"allowed_origins": []string{extOrigin},
	}
	mpath := filepath.Join(dir, hostName+".json")
	b, _ := json.MarshalIndent(manifest, "", "  ")
	if err := os.WriteFile(mpath, b, 0o600); err != nil {
		return "", err
	}
	for _, k := range regKeys {
		key, _, err := registry.CreateKey(registry.CURRENT_USER, k, registry.SET_VALUE)
		if err != nil {
			return "", err
		}
		err = key.SetStringValue("", mpath)
		key.Close()
		if err != nil {
			return "", err
		}
	}
	return "ConectCRM Fiscal " + version + " instalado.\n\nReabra o ConectCRM no Chrome. Em Configurações → Nota fiscal escolha o certificado de cada empresa.", nil
}

func uninstall() (string, error) {
	for _, k := range regKeys {
		_ = registry.DeleteKey(registry.CURRENT_USER, k)
	}
	_ = os.Remove(filepath.Join(dataDir(), hostName+".json"))
	return "ConectCRM Fiscal removido. (A pasta " + dataDir() + " pode ser apagada.)", nil
}

func sameFile(a, b string) bool {
	sa, err1 := os.Stat(a)
	sb, err2 := os.Stat(b)
	return err1 == nil && err2 == nil && os.SameFile(sa, sb)
}

func report(msg string, err error) {
	title := "ConectCRM Fiscal"
	flags := uintptr(0x40) // MB_ICONINFORMATION
	if err != nil {
		msg = "Não foi possível concluir:\n\n" + err.Error()
		flags = 0x10 // MB_ICONERROR
	}
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(msg)
	box.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
}
