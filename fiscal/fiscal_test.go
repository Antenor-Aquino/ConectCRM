package main

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Certificado de teste no formato ICP-Brasil e-CNPJ: CNPJ no SAN (otherName 2.16.76.1.3.3).
func testCert(t *testing.T) (*x509.Certificate, *rsa.PrivateKey, string, string) {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	val, _ := asn1.Marshal(asn1.RawValue{Tag: asn1.TagPrintableString, Class: asn1.ClassUniversal, Bytes: []byte("68153622000193")})
	other, _ := asn1.Marshal(struct {
		ID  asn1.ObjectIdentifier
		Val asn1.RawValue `asn1:"explicit,tag:0"`
	}{oidICPCNPJ, asn1.RawValue{FullBytes: val}})
	other[0] = 0xA0 // [0] otherName (implícito, construído)
	san, _ := asn1.Marshal(asn1.RawValue{Tag: asn1.TagSequence, Class: asn1.ClassUniversal, IsCompound: true, Bytes: other})
	tpl := &x509.Certificate{
		SerialNumber:    big.NewInt(1),
		Subject:         pkix.Name{CommonName: "CLAUDIA TECNOLOGIA LIMITADA:68153622000193"},
		NotBefore:       time.Now().Add(-time.Hour),
		NotAfter:        time.Now().Add(24 * time.Hour),
		KeyUsage:        x509.KeyUsageDigitalSignature,
		ExtKeyUsage:     []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		ExtraExtensions: []pkix.Extension{{Id: oidSAN, Value: san}},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	c, _ := x509.ParseCertificate(der)
	dir := t.TempDir()
	cp, kp := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	_ = os.WriteFile(cp, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600)
	kb, _ := x509.MarshalPKCS8PrivateKey(key)
	_ = os.WriteFile(kp, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: kb}), 0o600)
	t.Setenv("CONECTCRM_FISCAL_CERT", cp)
	t.Setenv("CONECTCRM_FISCAL_KEY", kp)
	return c, key, cp, kp
}

func TestCNPJDoCertificado(t *testing.T) {
	c, _, _, _ := testCert(t)
	info := infoOf(c)
	if info.CNPJ != "68153622000193" {
		t.Fatalf("CNPJ = %q", info.CNPJ)
	}
	if len(info.Thumbprint) != 40 {
		t.Fatalf("thumbprint = %q", info.Thumbprint)
	}
}

func TestAssinaturaConferidaPeloXmlsec1(t *testing.T) {
	c, key, cp, _ := testCert(t)
	dps, _ := os.ReadFile("testdata/dps.xml")
	signed, err := signElement(string(dps), "infDPS", key, c)
	if err != nil {
		t.Fatal(err)
	}
	for _, must := range []string{
		`</infDPS><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">`,
		`<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"`,
		`<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"`,
		`<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"`,
		`<Reference URI="#DPS`,
		`<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"`,
		`</Signature></DPS>`,
	} {
		if !strings.Contains(signed, must) {
			t.Fatalf("faltou %s em\n%s", must, signed)
		}
	}
	if strings.Contains(signed, "<ds:") || strings.Contains(signed, "<infDPS xmlns") {
		t.Fatal("prefixo de namespace ou xmlns repetido no infDPS")
	}
	if _, err := exec.LookPath("xmlsec1"); err != nil {
		t.Skip("xmlsec1 não instalado")
	}
	f := filepath.Join(t.TempDir(), "assinado.xml")
	_ = os.WriteFile(f, []byte(signed), 0o600)
	out, err := exec.Command("xmlsec1", "--verify", "--insecure", "--id-attr:Id", "http://www.sped.fazenda.gov.br/nfse:infDPS", "--pubkey-cert-pem", cp, f).CombinedOutput()
	if err != nil || !strings.Contains(string(out), "OK") {
		t.Fatalf("xmlsec1 recusou a assinatura: %v\n%s", err, out)
	}
	// Alterar o conteúdo depois de assinado precisa invalidar a assinatura.
	_ = os.WriteFile(f, []byte(strings.Replace(signed, "<vServ>52.00</vServ>", "<vServ>99.00</vServ>", 1)), 0o600)
	if out, err := exec.Command("xmlsec1", "--verify", "--insecure", "--id-attr:Id", "http://www.sped.fazenda.gov.br/nfse:infDPS", "--pubkey-cert-pem", cp, f).CombinedOutput(); err == nil {
		t.Fatalf("xmlsec1 aceitou um XML adulterado:\n%s", out)
	}
}

func roundtrip(t *testing.T, reqs ...request) []response {
	t.Helper()
	var in bytes.Buffer
	for _, r := range reqs {
		if err := writeMessage(&in, r); err != nil {
			t.Fatal(err)
		}
	}
	var out bytes.Buffer
	if err := serve(&in, &out); err != nil {
		t.Fatal(err)
	}
	var res []response
	for {
		b, err := readMessage(&out)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		var r response
		_ = json.Unmarshal(b, &r)
		res = append(res, r)
	}
	return res
}

func TestNativeMessaging(t *testing.T) {
	c, _, _, _ := testCert(t)
	dps, _ := os.ReadFile("testdata/dps.xml")
	res := roundtrip(t,
		request{ID: "1", Cmd: "ping"},
		request{ID: "2", Cmd: "listCerts"},
		request{ID: "3", Cmd: "sign", Thumbprint: thumbprint(c), XML: string(dps)},
		request{ID: "4", Cmd: "sign", Thumbprint: "0000", XML: string(dps)},
		request{ID: "5", Cmd: "qualquer"},
	)
	if len(res) != 5 || res[0].Version != version || !res[0].OK {
		t.Fatalf("ping: %+v", res)
	}
	if len(res[1].Certs) != 1 || res[1].Certs[0].CNPJ != "68153622000193" {
		t.Fatalf("listCerts: %+v", res[1])
	}
	if !res[2].OK || !strings.Contains(res[2].Signed, "<SignatureValue>") {
		t.Fatalf("sign: %+v", res[2])
	}
	if res[3].OK || !strings.Contains(res[3].Error, "certificado não encontrado") {
		t.Fatalf("certificado inexistente: %+v", res[3])
	}
	if res[4].OK || !strings.Contains(res[4].Error, "comando desconhecido") {
		t.Fatalf("comando inválido: %+v", res[4])
	}
}

func TestEmissaoComCertificadoNaConexao(t *testing.T) {
	c, _, _, _ := testCert(t)
	pool := x509.NewCertPool()
	pool.AddCert(c)
	var got struct {
		path, cn, xml string
	}
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(r.TLS.PeerCertificates) == 0 {
			http.Error(w, "sem certificado", 401)
			return
		}
		got.path, got.cn = r.URL.Path, r.TLS.PeerCertificates[0].Subject.CommonName
		var body struct {
			Dps string `json:"dpsXmlGZipB64"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		got.xml, _ = gunzipB64(body.Dps)
		nfse, _ := gzipB64(`<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS123"><nNFSe>126</nNFSe></infNFSe></NFSe>`)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"tipoAmbiente":2,"chaveAcesso":"31062002228288572000137000000000001261100000000001","nfseXmlGZipB64":"` + nfse + `"}`))
	}))
	srv.TLS = &tls.Config{ClientAuth: tls.RequireAnyClientCert, MaxVersion: tls.VersionTLS12}
	srv.StartTLS()
	defer srv.Close()
	testRoots = x509.NewCertPool()
	testRoots.AddCert(srv.Certificate())
	defer func() { testRoots = nil }()
	t.Setenv("CONECTCRM_FISCAL_SEFIN_producao_restrita", srv.URL+"/SefinNacional")

	dps, _ := os.ReadFile("testdata/dps.xml")
	res := roundtrip(t, request{ID: "1", Cmd: "emit", Env: "producao_restrita", Thumbprint: thumbprint(c), XML: string(dps)})
	r := res[0]
	if !r.OK || r.Result == nil || r.Result.HTTPStatus != 201 {
		t.Fatalf("emit: %+v", r)
	}
	if got.path != "/SefinNacional/nfse" || !strings.HasPrefix(got.cn, "CLAUDIA TECNOLOGIA") {
		t.Fatalf("servidor recebeu %s de %q", got.path, got.cn)
	}
	if !strings.Contains(got.xml, "<SignatureValue>") || !strings.HasPrefix(got.xml, "<?xml") {
		t.Fatalf("XML recebido pela Sefin não está assinado: %.200s", got.xml)
	}
	if r.Result.AccessKey != "31062002228288572000137000000000001261100000000001" || !strings.Contains(r.Result.NfseXML, "<nNFSe>126</nNFSe>") {
		t.Fatalf("resposta: %+v", r.Result)
	}
}

func TestErrorCodes(t *testing.T) {
	got := errorCodes([]byte(`{"erros":[{"Codigo":"E0712","Descricao":"x"},{"codigo":"E1235"}]}`))
	if len(got) != 2 || got[0] != "E0712" || got[1] != "E1235" {
		t.Fatalf("códigos: %v", got)
	}
}
