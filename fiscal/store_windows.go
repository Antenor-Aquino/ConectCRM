//go:build windows

// Repositório "Pessoal" do Windows (usuário atual): certificados A1 instalados e
// tokens A3 (o driver do token aparece aqui; o PIN é pedido pela janela do driver).
package main

import (
	"crypto"
	"crypto/x509"

	"github.com/github/smimesign/certstore"
)

type winIdentity struct {
	id    certstore.Identity
	cert  *x509.Certificate
	chain []*x509.Certificate
}

func (w *winIdentity) Certificate() *x509.Certificate { return w.cert }
func (w *winIdentity) Chain() []*x509.Certificate      { return w.chain }
func (w *winIdentity) Signer() (crypto.Signer, error)  { return w.id.Signer() }
func (w *winIdentity) Close()                          { w.id.Close() }

func openIdentities() ([]Identity, func(), error) {
	store, err := certstore.Open()
	if err != nil {
		return nil, func() {}, err
	}
	ids, err := store.Identities()
	if err != nil {
		store.Close()
		return nil, func() {}, err
	}
	var out []Identity
	for _, id := range ids {
		c, err := id.Certificate()
		if err != nil {
			id.Close()
			continue
		}
		chain, _ := id.CertificateChain()
		out = append(out, &winIdentity{id: id, cert: c, chain: chain})
	}
	return out, func() {
		for _, i := range out {
			i.Close()
		}
		store.Close()
	}, nil
}

