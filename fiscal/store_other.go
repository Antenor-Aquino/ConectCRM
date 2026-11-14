//go:build !windows

// Fora do Windows (testes): certificado e chave em PEM, indicados por
// CONECTCRM_FISCAL_CERT e CONECTCRM_FISCAL_KEY.
package main

import (
	"crypto"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"os"
)

type fileIdentity struct {
	cert *x509.Certificate
	key  crypto.Signer
}

func (f *fileIdentity) Certificate() *x509.Certificate { return f.cert }
func (f *fileIdentity) Chain() []*x509.Certificate      { return []*x509.Certificate{f.cert} }
func (f *fileIdentity) Signer() (crypto.Signer, error)  { return f.key, nil }
func (f *fileIdentity) Close()                          {}

func openIdentities() ([]Identity, func(), error) {
	cp, kp := os.Getenv("CONECTCRM_FISCAL_CERT"), os.Getenv("CONECTCRM_FISCAL_KEY")
	if cp == "" || kp == "" {
		return nil, func() {}, nil
	}
	cb, err := os.ReadFile(cp)
	if err != nil {
		return nil, func() {}, err
	}
	kb, err := os.ReadFile(kp)
	if err != nil {
		return nil, func() {}, err
	}
	cblk, _ := pem.Decode(cb)
	kblk, _ := pem.Decode(kb)
	if cblk == nil || kblk == nil {
		return nil, func() {}, errors.New("PEM inválido")
	}
	cert, err := x509.ParseCertificate(cblk.Bytes)
	if err != nil {
		return nil, func() {}, err
	}
	k, err := x509.ParsePKCS8PrivateKey(kblk.Bytes)
	if err != nil {
		if k2, err2 := x509.ParsePKCS1PrivateKey(kblk.Bytes); err2 == nil {
			k = k2
		} else {
			return nil, func() {}, err
		}
	}
	return []Identity{&fileIdentity{cert: cert, key: k.(crypto.Signer)}}, func() {}, nil
}
