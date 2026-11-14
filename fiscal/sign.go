// Assinatura XMLDSig da DPS (infDPS) e do pedido de evento (infPedReg), como a
// Sefin Nacional exige: enveloped + C14N 1.0, sem prefixo de namespace,
// <Signature> logo depois do elemento assinado. Algoritmo: RSA-SHA1 (o usual);
// se o certificado recusar SHA-1 (tokens A3 que só assinam SHA-256), RSA-SHA256
// — o xmldsig-core-schema do leiaute 1.01 não fixa mais o algoritmo (o 1.00 fixava SHA-1).
package main

import (
	"crypto"
	"crypto/x509"
	"fmt"
	"log"
	"strings"

	"github.com/beevik/etree"
	dsig "github.com/russellhaering/goxmldsig"
)

// inScopeDefaultNS devolve o xmlns padrão em vigor no elemento (declarado nele ou num ancestral).
func inScopeDefaultNS(el *etree.Element) string {
	for e := el; e != nil; e = e.Parent() {
		for _, a := range e.Attr {
			if a.Space == "" && a.Key == "xmlns" {
				return a.Value
			}
		}
	}
	return ""
}

// signElement assina o primeiro elemento `tag` do XML e devolve o XML com a assinatura.
func signElement(xml string, tag string, signer crypto.Signer, cert *x509.Certificate) (string, error) {
	out, err := signElementHash(xml, tag, signer, cert, crypto.SHA1)
	if err == nil || !strings.HasPrefix(err.Error(), "falha ao assinar") {
		return out, err
	}
	log.Printf("assinatura: SHA-1 recusado pelo certificado (%v); assinando com SHA-256", err)
	out2, err2 := signElementHash(xml, tag, signer, cert, crypto.SHA256)
	if err2 != nil {
		return "", fmt.Errorf("%v | com SHA-256: %v", err, err2)
	}
	return out2, nil
}

// signElementHash assina com o hash dado (SHA-1 ou SHA-256).
func signElementHash(xml string, tag string, signer crypto.Signer, cert *x509.Certificate, hash crypto.Hash) (string, error) {
	doc := etree.NewDocument()
	doc.WriteSettings.CanonicalEndTags = true
	if err := doc.ReadFromString(xml); err != nil {
		return "", fmt.Errorf("XML inválido: %w", err)
	}
	el := doc.FindElement("//" + tag)
	if el == nil {
		return "", fmt.Errorf("elemento %s não encontrado no XML", tag)
	}
	if el.SelectAttrValue("Id", "") == "" {
		return "", fmt.Errorf("elemento %s sem atributo Id", tag)
	}
	parent := el.Parent()
	if parent == nil {
		return "", fmt.Errorf("elemento %s precisa estar dentro de outro (DPS/pedRegEvento)", tag)
	}
	for _, s := range parent.ChildElements() {
		if s.Tag == "Signature" {
			return "", fmt.Errorf("o XML já está assinado")
		}
	}

	// O digest é do elemento como o verificador o enxerga (C14N inclusivo): com o
	// namespace herdado do pai declarado nele. Assina-se uma cópia com o xmlns.
	cp := el.Copy()
	if ns := inScopeDefaultNS(el); ns != "" && cp.SelectAttr("xmlns") == nil {
		cp.CreateAttr("xmlns", ns)
	}

	ctx, err := dsig.NewSigningContext(signer, [][]byte{cert.Raw})
	if err != nil {
		return "", err
	}
	ctx.Hash = hash
	ctx.Canonicalizer = dsig.MakeC14N10RecCanonicalizer()
	ctx.Prefix = ""
	ctx.IdAttribute = "Id"
	method := dsig.RSASHA1SignatureMethod
	if hash == crypto.SHA256 {
		method = dsig.RSASHA256SignatureMethod
	}
	if err := ctx.SetSignatureMethod(method); err != nil {
		return "", err
	}
	sig, err := ctx.ConstructSignature(cp, true)
	if err != nil {
		return "", fmt.Errorf("falha ao assinar: %w", err)
	}
	parent.InsertChildAt(el.Index()+1, sig)
	out, err := doc.WriteToString()
	if err != nil {
		return "", err
	}
	return out, nil
}
