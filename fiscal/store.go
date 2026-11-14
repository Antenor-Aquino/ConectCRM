// Certificados disponíveis para assinar e para a conexão com a Sefin.
package main

import (
	"crypto"
	"crypto/sha1"
	"crypto/x509"
	"encoding/asn1"
	"encoding/hex"
	"regexp"
	"strings"
)

// Identity é um certificado com acesso à chave privada (arquivo A1 instalado ou token A3).
type Identity interface {
	Certificate() *x509.Certificate
	Chain() []*x509.Certificate
	Signer() (crypto.Signer, error)
	Close()
}

// CertInfo vai para a extensão (lista de certificados para escolher).
type CertInfo struct {
	Thumbprint string `json:"thumbprint"`
	Subject    string `json:"subject"`
	Issuer     string `json:"issuer"`
	CNPJ       string `json:"cnpj"`
	CPF        string `json:"cpf"`
	NotBefore  string `json:"notBefore"`
	NotAfter   string `json:"notAfter"`
}

func thumbprint(c *x509.Certificate) string {
	s := sha1.Sum(c.Raw)
	return strings.ToUpper(hex.EncodeToString(s[:]))
}

var (
	oidSAN      = asn1.ObjectIdentifier{2, 5, 29, 17}
	oidICPCNPJ  = asn1.ObjectIdentifier{2, 16, 76, 1, 3, 3}
	oidICPPF    = asn1.ObjectIdentifier{2, 16, 76, 1, 3, 1}
	digitsRe    = regexp.MustCompile(`\d+`)
	cnInlineDoc = regexp.MustCompile(`:(\d{14}|\d{11})$`)
)

// docsFromCert lê CNPJ (e-CNPJ, OID 2.16.76.1.3.3) e CPF (OID 2.16.76.1.3.1, posições 9-19)
// do Subject Alternative Name do certificado ICP-Brasil; se faltar, tenta o fim do CN ("NOME:CNPJ").
func docsFromCert(c *x509.Certificate) (cnpj, cpf string) {
	for _, ext := range c.Extensions {
		if !ext.Id.Equal(oidSAN) {
			continue
		}
		var seq asn1.RawValue
		if _, err := asn1.Unmarshal(ext.Value, &seq); err != nil {
			continue
		}
		rest := seq.Bytes
		for len(rest) > 0 {
			var gn asn1.RawValue
			var err error
			rest, err = asn1.Unmarshal(rest, &gn)
			if err != nil || gn.Tag != 0 { // otherName
				continue
			}
			var oid asn1.ObjectIdentifier
			inner, err := asn1.Unmarshal(gn.Bytes, &oid)
			if err != nil {
				continue
			}
			var wrapped asn1.RawValue // [0] EXPLICIT valor
			if _, err := asn1.Unmarshal(inner, &wrapped); err != nil {
				continue
			}
			var val asn1.RawValue
			if _, err := asn1.Unmarshal(wrapped.Bytes, &val); err != nil {
				continue
			}
			d := strings.Join(digitsRe.FindAllString(string(val.Bytes), -1), "")
			switch {
			case oid.Equal(oidICPCNPJ) && len(d) >= 14:
				cnpj = d[:14]
			case oid.Equal(oidICPPF) && len(d) >= 19:
				cpf = d[8:19]
			}
		}
	}
	if cnpj == "" {
		if m := cnInlineDoc.FindStringSubmatch(c.Subject.CommonName); m != nil && len(m[1]) == 14 {
			cnpj = m[1]
		}
	}
	return
}

func infoOf(c *x509.Certificate) CertInfo {
	cnpj, cpf := docsFromCert(c)
	return CertInfo{
		Thumbprint: thumbprint(c),
		Subject:    c.Subject.CommonName,
		Issuer:     c.Issuer.CommonName,
		CNPJ:       cnpj,
		CPF:        cpf,
		NotBefore:  c.NotBefore.UTC().Format("2006-01-02T15:04:05Z"),
		NotAfter:   c.NotAfter.UTC().Format("2006-01-02T15:04:05Z"),
	}
}
