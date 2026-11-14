// Assinatura XMLDSig da DPS (infDPS) e do pedido de evento (infPedReg), como a
// Sefin Nacional exige: enveloped + C14N 1.0, RSA-SHA1, digest SHA1, sem prefixo
// de namespace, <Signature> logo depois do elemento assinado.
package main

import (
	"crypto"
	"crypto/x509"
	"fmt"

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
	ctx.Hash = crypto.SHA1
	ctx.Canonicalizer = dsig.MakeC14N10RecCanonicalizer()
	ctx.Prefix = ""
	ctx.IdAttribute = "Id"
	if err := ctx.SetSignatureMethod(dsig.RSASHA1SignatureMethod); err != nil {
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
