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
	"net/http"
	"net/url"
	"os"
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
		RootCAs:      testRoots,
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
			ChaveAcesso                   string `json:"chaveAcesso"`
			NfseXmlGZipB64                string `json:"nfseXmlGZipB64"`
			EventoXmlGZipB64              string `json:"eventoXmlGZipB64"`
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
	signer, err := id.Signer()
	if err != nil {
		return nil, "", err
	}
	signed, err := signElement(dpsXML, "infDPS", signer, id.Certificate())
	if err != nil {
		return nil, "", err
	}
	payload, err := gzipB64(signed)
	if err != nil {
		return nil, "", err
	}
	c, err := httpClient(id)
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
	signer, err := id.Signer()
	if err != nil {
		return nil, "", err
	}
	signed, err := signElement(eventXML, "infPedReg", signer, id.Certificate())
	if err != nil {
		return nil, "", err
	}
	payload, err := gzipB64(signed)
	if err != nil {
		return nil, "", err
	}
	c, err := httpClient(id)
	if err != nil {
		return nil, "", err
	}
	r, err := doJSON(c, http.MethodPost, base+"/nfse/"+url.PathEscape(key)+"/eventos", map[string]string{"pedidoRegistroEventoXmlGZipB64": payload})
	return r, signed, err
}
