package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func interTestPair(t *testing.T) (certPEM, keyPEM string) {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(7),
		Subject:      pkix.Name{CommonName: "integracao-inter"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, _ := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	kb, _ := x509.MarshalPKCS8PrivateKey(key)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: kb}))
}

// Inter simulado: exige certificado de cliente, emite tokens e responde a API.
func fakeInter(t *testing.T) (srv *httptest.Server, tokens *int32, rejectNext *atomic.Bool) {
	t.Helper()
	tokens = new(int32)
	rejectNext = new(atomic.Bool)
	srv = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(r.TLS.PeerCertificates) == 0 || r.TLS.PeerCertificates[0].Subject.CommonName != "integracao-inter" {
			w.WriteHeader(403)
			return
		}
		switch r.URL.Path {
		case "/oauth/v2/token":
			_ = r.ParseForm()
			if r.Form.Get("client_secret") != "segredo" || r.Form.Get("grant_type") != "client_credentials" {
				w.WriteHeader(401)
				_, _ = w.Write([]byte(`{"title":"credenciais inválidas"}`))
				return
			}
			n := atomic.AddInt32(tokens, 1)
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "tok" + string(rune('0'+n)), "expires_in": 3600, "scope": r.Form.Get("scope")})
		case "/banking/v2/saldo":
			if rejectNext.Swap(false) {
				w.WriteHeader(401)
				return
			}
			if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer tok") {
				w.WriteHeader(401)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"disponivel": 123.45, "conta": r.Header.Get("x-conta-corrente"), "q": r.URL.RawQuery})
		case "/cobranca/v3/cobrancas":
			var in map[string]any
			_ = json.NewDecoder(r.Body).Decode(&in)
			w.WriteHeader(200)
			_ = json.NewEncoder(w).Encode(map[string]any{"codigoSolicitacao": "abc-123", "seuNumero": in["seuNumero"]})
		default:
			w.WriteHeader(404)
		}
	}))
	srv.TLS = &tls.Config{ClientAuth: tls.RequireAnyClientCert}
	srv.StartTLS()
	t.Cleanup(srv.Close)
	ca := filepath.Join(t.TempDir(), "ca.pem")
	_ = os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw}), 0o600)
	t.Setenv("CONECTCRM_FISCAL_CA", ca)
	testRoots = nil
	t.Setenv("CONECTCRM_FISCAL_INTER_sandbox", srv.URL)
	t.Setenv("CONECTCRM_FISCAL_DATA", t.TempDir())
	return
}

func TestInterSetupValida(t *testing.T) {
	fakeInter(t)
	cert, key := interTestPair(t)
	if _, err := interSetup("sandbox", interConfig{ClientID: "id", ClientSecret: "segredo", CertPEM: cert}); err == nil {
		t.Fatal("aceitou sem a chave")
	}
	_, otherKey := interTestPair(t)
	if _, err := interSetup("sandbox", interConfig{ClientID: "id", ClientSecret: "segredo", CertPEM: cert, KeyPEM: otherKey}); err == nil || !strings.Contains(err.Error(), "não combinam") {
		t.Fatalf("chave de outro certificado: %v", err)
	}
	if _, err := interSetup("outro", interConfig{}); err == nil {
		t.Fatal("ambiente desconhecido aceito")
	}
	info, err := interSetup("sandbox", interConfig{ClientID: "id", ClientSecret: "segredo", Account: "12.345-6", CertPEM: cert, KeyPEM: key})
	if err != nil {
		t.Fatal(err)
	}
	if !info.Configured || info.Subject != "integracao-inter" || info.Account != "123456" || info.NotAfter == "" {
		t.Fatalf("info: %+v", info)
	}
	// Atualizar só o Client ID mantém certificado e segredo.
	if _, err := interSetup("sandbox", interConfig{ClientID: "id2", Account: "123456"}); err != nil {
		t.Fatal(err)
	}
	if s := interStatus("sandbox"); s.ClientID != "id2" || s.Subject != "integracao-inter" {
		t.Fatalf("status: %+v", s)
	}
	// O segredo não vai para a extensão.
	b, _ := json.Marshal(interStatus("sandbox"))
	if strings.Contains(string(b), "segredo") || strings.Contains(string(b), "PRIVATE") {
		t.Fatal("status vazou segredo")
	}
	interClear("sandbox")
	if interStatus("sandbox").Configured {
		t.Fatal("não limpou")
	}
}

func TestInterCallTokenEmCacheERenova(t *testing.T) {
	_, tokens, rejectNext := fakeInter(t)
	cert, key := interTestPair(t)
	if _, err := interSetup("sandbox", interConfig{ClientID: "id", ClientSecret: "segredo", Account: "999", CertPEM: cert, KeyPEM: key}); err != nil {
		t.Fatal(err)
	}
	r, err := interCall("sandbox", "GET", "/banking/v2/saldo", "dataSaldo=2026-11-15", "", "extrato.read")
	if err != nil || r.HTTPStatus != 200 {
		t.Fatalf("saldo: %v %+v", err, r)
	}
	if !strings.Contains(r.Body, `"conta":"999"`) || !strings.Contains(r.Body, "dataSaldo=2026-11-15") {
		t.Fatalf("corpo: %s", r.Body)
	}
	if _, err := interCall("sandbox", "GET", "/banking/v2/saldo", "", "", "extrato.read"); err != nil {
		t.Fatal(err)
	}
	if *tokens != 1 {
		t.Fatalf("token deveria ser reaproveitado: %d", *tokens)
	}
	// 401 da API: um token novo e repete.
	rejectNext.Store(true)
	r, err = interCall("sandbox", "GET", "/banking/v2/saldo", "", "", "extrato.read")
	if err != nil || r.HTTPStatus != 200 || *tokens != 2 {
		t.Fatalf("renovação: %v %+v tokens=%d", err, r, *tokens)
	}
	r, err = interCall("sandbox", "POST", "/cobranca/v3/cobrancas", "", `{"seuNumero":"C1"}`, "boleto-cobranca.write")
	if err != nil || !strings.Contains(r.Body, "abc-123") {
		t.Fatalf("emitir: %v %+v", err, r)
	}
	if _, err := interCall("sandbox", "GET", "/oauth/v2/token", "", "", "x"); err == nil {
		t.Fatal("caminho do token não pode ser chamado direto")
	}
}

func TestInterSegredoErrado(t *testing.T) {
	fakeInter(t)
	cert, key := interTestPair(t)
	_, _ = interSetup("sandbox", interConfig{ClientID: "id", ClientSecret: "errado", CertPEM: cert, KeyPEM: key})
	_, err := interCall("sandbox", "GET", "/banking/v2/saldo", "", "", "extrato.read")
	if err == nil || !strings.Contains(err.Error(), "credenciais inválidas") {
		t.Fatalf("esperava erro de credenciais: %v", err)
	}
}

func TestInterSemConfiguracao(t *testing.T) {
	fakeInter(t)
	r := handle(request{ID: "1", Cmd: "interCall", Env: "sandbox", Path: "/banking/v2/saldo", Scopes: "extrato.read"})
	if r.OK || !strings.Contains(r.Error, "ainda não foi configurado") {
		t.Fatalf("%+v", r)
	}
	r = handle(request{ID: "2", Cmd: "interStatus", Env: "sandbox"})
	if !r.OK || r.Inter == nil || r.Inter.Configured {
		t.Fatalf("%+v", r)
	}
}
