// Cliente da API Sefin Nacional (NFS-e). A conexão usa o certificado da empresa
// (autenticação de cliente, TLS 1.2 com RSA PKCS#1, que tokens A3 suportam).
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strings"
	"time"
)

var sefinBase = map[string]string{
	"producao":          "https://sefin.nfse.gov.br/sefinnacional",
	"producao_restrita": "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
}

// Nos testes, a URL da Sefin pode apontar para um servidor local.
func baseURL(env string) (string, error) {
	if v := os.Getenv("CONECTCRM_FISCAL_SEFIN_" + env); v != "" {
		return v, nil
	}
	b, ok := sefinBase[env]
	if !ok {
		return "", fmt.Errorf("ambiente desconhecido: %q", env)
	}
	return b, nil
}

var testRoots *x509.CertPool // só nos testes

// rootsForTest: nos testes de ponta a ponta, CONECTCRM_FISCAL_CA aponta o
// certificado (PEM) da Sefin simulada. Em uso normal fica vazio e valem as
// autoridades confiáveis do Windows.
func rootsForTest() *x509.CertPool {
	if testRoots != nil {
		return testRoots
	}
	p := os.Getenv("CONECTCRM_FISCAL_CA")
	if p == "" {
		return nil
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(b)
	return pool
}

func httpClient(id Identity) (*http.Client, error) {
	signer, err := id.Signer()
	if err != nil {
		return nil, fmt.Errorf("não foi possível usar a chave do certificado: %w", err)
	}
	chain := [][]byte{id.Certificate().Raw}
	for _, c := range id.Chain() {
		if !c.Equal(id.Certificate()) {
			chain = append(chain, c.Raw)
		}
	}
	cert := tls.Certificate{
		Certificate:                  chain,
		PrivateKey:                   signer,
		Leaf:                         id.Certificate(),
		SupportedSignatureAlgorithms: []tls.SignatureScheme{tls.PKCS1WithSHA256, tls.PKCS1WithSHA384, tls.PKCS1WithSHA512, tls.PKCS1WithSHA1},
	}
	cfg := &tls.Config{
		MinVersion:   tls.VersionTLS12,
		MaxVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{cert},
		RootCAs:      rootsForTest(),
		// A Sefin Nacional (IIS) abre a conexão sem pedir o certificado e só o
		// pede depois, renegociando o TLS 1.2. Sem isto: "tls: no renegotiation".
		Renegotiation: tls.RenegotiateFreelyAsClient,
	}
	return &http.Client{Timeout: 90 * time.Second, Transport: &http.Transport{TLSClientConfig: cfg, Proxy: http.ProxyFromEnvironment}}, nil
}

func gzipB64(s string) (string, error) {
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if _, err := zw.Write([]byte(s)); err != nil {
		return "", err
	}
	if err := zw.Close(); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func gunzipB64(s string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return "", err
	}
	zr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	b, err := io.ReadAll(zr)
	return string(b), err
}

// SefinResult é a resposta devolvida à extensão.
type SefinResult struct {
	HTTPStatus int             `json:"httpStatus"`
	Body       json.RawMessage `json:"body,omitempty"`
	Text       string          `json:"text,omitempty"`
	AccessKey  string          `json:"accessKey,omitempty"`
	NfseXML    string          `json:"nfseXml,omitempty"`
	EventXML   string          `json:"eventXml,omitempty"`
}

func doJSON(c *http.Client, method, u string, payload any) (*SefinResult, error) {
	var body io.Reader
	if payload != nil {
		b, _ := json.Marshal(payload)
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, u, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sem conexão com a Sefin Nacional: %w", err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	out := &SefinResult{HTTPStatus: res.StatusCode}
	if json.Valid(b) {
		out.Body = b
		var r struct {
			ChaveAcesso      string `json:"chaveAcesso"`
			NfseXmlGZipB64   string `json:"nfseXmlGZipB64"`
			EventoXmlGZipB64 string `json:"eventoXmlGZipB64"`
		}
		_ = json.Unmarshal(b, &r)
		out.AccessKey = r.ChaveAcesso
		if r.NfseXmlGZipB64 != "" {
			out.NfseXML, _ = gunzipB64(r.NfseXmlGZipB64)
		}
		if r.EventoXmlGZipB64 != "" {
			out.EventXML, _ = gunzipB64(r.EventoXmlGZipB64)
		}
	} else {
		out.Text = string(b)
	}
	return out, nil
}

// emitDPS assina a DPS, compacta e envia (POST /nfse).
func emitDPS(id Identity, env, dpsXML string) (*SefinResult, string, error) {
	base, err := baseURL(env)
	if err != nil {
		return nil, "", err
	}
	c, err := httpClient(id)
	if err != nil {
		return nil, "", err
	}
	signed, err := signAfterSession(c, base, id, dpsXML, "infDPS")
	if err != nil {
		return nil, "", err
	}
	payload, err := gzipB64(signed)
	if err != nil {
		return nil, "", err
	}
	r, err := doJSON(c, http.MethodPost, base+"/nfse", map[string]string{"dpsXmlGZipB64": payload})
	return r, signed, err
}

// queryNFSe consulta pela chave (GET /nfse/{chave}).
func queryNFSe(id Identity, env, key string) (*SefinResult, error) {
	base, err := baseURL(env)
	if err != nil {
		return nil, err
	}
	c, err := httpClient(id)
	if err != nil {
		return nil, err
	}
	return doJSON(c, http.MethodGet, base+"/nfse/"+url.PathEscape(key), nil)
}

// sendEvent assina o pedido de evento (infPedReg) e envia (POST /nfse/{chave}/eventos).
func sendEvent(id Identity, env, key, eventXML string) (*SefinResult, string, error) {
	base, err := baseURL(env)
	if err != nil {
		return nil, "", err
	}
	c, err := httpClient(id)
	if err != nil {
		return nil, "", err
	}
	signed, err := signAfterSession(c, base, id, eventXML, "infPedReg")
	if err != nil {
		return nil, "", err
	}
	payload, err := gzipB64(signed)
	if err != nil {
		return nil, "", err
	}
	r, err := doJSON(c, http.MethodPost, base+"/nfse/"+url.PathEscape(key)+"/eventos", map[string]string{"pedidoRegistroEventoXmlGZipB64": payload})
	return r, signed, err
}

// signAfterSession assina o XML do jeito que funcionou com o token A3 no teste
// de conexão: primeiro abre a conexão com certificado (é aqui que o token pede o
// PIN e abre a sessão), depois assina numa thread própria do sistema. Assinar
// antes de qualquer conexão, na thread principal, foi recusado por um token
// (NTE_INTERNAL_ERROR 0x8009002D) que assinava normalmente na conexão.
func signAfterSession(c *http.Client, base string, id Identity, xml, tag string) (string, error) {
	t0 := time.Now()
	r, err := doJSON(c, http.MethodGet, base+"/nfse/"+strings.Repeat("0", 50), nil)
	if err != nil {
		return "", err
	}
	log.Printf("sessão com a Sefin aberta (HTTP %d, %v)", r.HTTPStatus, time.Since(t0).Round(time.Millisecond))
	signer, err := id.Signer()
	if err != nil {
		return "", err
	}
	type result struct {
		xml string
		err error
	}
	ch := make(chan result, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer func() {
			if p := recover(); p != nil {
				ch <- result{err: fmt.Errorf("erro interno ao assinar: %v", p)}
			}
		}()
		t1 := time.Now()
		out, err := signElement(xml, tag, signer, id.Certificate())
		log.Printf("assinatura de %s: %v (%v)", tag, map[bool]string{true: "ok", false: "falhou"}[err == nil], time.Since(t1).Round(time.Millisecond))
		ch <- result{out, err}
	}()
	res := <-ch
	return res.xml, res.err
}
