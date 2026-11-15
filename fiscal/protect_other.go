//go:build !windows

// Fora do Windows (só testes): sem DPAPI, o arquivo fica como está (permissão 0600).
package main

func protect(plain []byte) ([]byte, error)    { return append([]byte(nil), plain...), nil }
func unprotect(sealed []byte) ([]byte, error) { return append([]byte(nil), sealed...), nil }
