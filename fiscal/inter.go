// Banco Inter (spec 22): o Inter exige, em toda chamada, o certificado da
// integração (mTLS) e um token OAuth (client credentials, vale 1 hora; o Inter
// só deixa gerar 5 por minuto). Certificado, chave e Client Secret ficam só
// neste computador, protegidos pelo Windows (DPAPI) — nunca no banco do CRM.
package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var interBase = map[string]string{
	"producao": "https://cdpj.partners.bancointer.com.br",
	"sandbox":  "https://cdpj-sandbox.partners.uatinter.co",
}

func interURL(env string) (string, error) {
	if v := os.Getenv("CONECTCRM_FISCAL_INTER_" + env); v != "" {
		return v, nil
	}
	b, ok := interBase[env]
	if !ok {
		return "", fmt.Errorf("ambiente do Inter desconhecido: %q", env)
	}
	return b, nil
}

type interConfig struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	Account      string `json:"account"`
	CertPEM      string `json:"certPem"`
	KeyPEM       string `json:"keyPem"`
}

type interToken struct {
	Token   string    `json:"token"`
	Expires time.Time `json:"expires"`
}

// InterInfo vai para a extensão (sem segredos).
type InterInfo struct {
	Configured bool   `json:"configured"`
	ClientID   string `json:"clientId,omitempty"`
	Account    string `json:"account,omitempty"`
	Subject    string `json:"subject,omitempty"`
	NotAfter   string `json:"notAfter,omitempty"`
}

// InterResult é a resposta HTTP do Inter devolvida à extensão.
type InterResult struct {
	HTTPStatus int    `json:"httpStatus"`
	Body       string `json:"body"`
}

func interFile(env, kind string) string {
	return filepath.Join(dataDir(), fmt.Sprintf("inter-%s-%s.bin", env, kind))
}

func saveSealed(path string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	sealed, err := protect(b)
	if err != nil {
		return fmt.Errorf("não foi possível proteger os dados do Inter: %w", err)
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	return os.WriteFile(path, sealed, 0o600)
}

func loadSealed(path string, v any) error {
	sealed, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	b, err := unprotect(sealed)
	if err != nil {
		return fmt.Errorf("não foi possível abrir os dados do Inter neste usuário do Windows: %w", err)
	}
	return json.Unmarshal(b, v)
}

func loadInter(env string) (*interConfig, error) {
	var c interConfig
	if err := loadSealed(interFile(env, "config"), &c); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("o Banco Inter (%s) ainda não foi configurado neste computador: Configurações → Integrações → Banco Inter", envLabel(env))
		}
		return nil, err
	}
	return &c, nil
}

func envLabel(env string) string {
	if env == "producao" {
		return "produção"
	}
	return env
}

func keyPair(c *interConfig) (tls.Certificate, *x509.Certificate, error) {
	pair, err := tls.X509KeyPair([]byte(c.CertPEM), []byte(c.KeyPEM))
	if err != nil {
		return tls.Certificate{}, nil, fmt.Errorf("certificado e chave do Inter não combinam ou estão em formato inválido (use os arquivos .crt e .key baixados no Internet Banking): %w", err)
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	pair.Leaf = leaf
	return pair, leaf, nil
}

func infoOfInter(c *interConfig) InterInfo {
	i := InterInfo{Configured: true, ClientID: c.ClientID, Account: c.Account}
	if _, leaf, err := keyPair(c); err == nil {
		i.Subject = leaf.Subject.CommonName
		i.NotAfter = leaf.NotAfter.UTC().Format("2006-01-02T15:04:05Z")
	}
	return i
}

// interSetup grava (ou atualiza) a configuração. Campos vazios mantêm o que já
// estava guardado (trocar só o Client Secret, por exemplo).
func interSetup(env string, in interConfig) (InterInfo, error) {
	if _, err := interURL(env); err != nil {
		return InterInfo{}, err
	}
	cur, _ := loadInter(env)
	if cur == nil {
		cur = &interConfig{}
	}
	keep := func(v, old string) string {
		if strings.TrimSpace(v) == "" {
			return old
		}
		return strings.TrimSpace(v)
	}
	c := interConfig{
		ClientID:     keep(in.ClientID, cur.ClientID),
		ClientSecret: keep(in.ClientSecret, cur.ClientSecret),
		Account:      strings.TrimSpace(in.Account), // vazio = conta principal
		CertPEM:      keep(in.CertPEM, cur.CertPEM),
		KeyPEM:       keep(in.KeyPEM, cur.KeyPEM),
	}
	c.Account = strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, c.Account)
	if c.ClientID == "" || c.ClientSecret == "" {
		return InterInfo{}, errors.New("informe o Client ID e o Client Secret da integração")
	}
	if c.CertPEM == "" || c.KeyPEM == "" {
		return InterInfo{}, errors.New("escolha o certificado (.crt) e a chave (.key) da integração")
	}
	if !strings.Contains(c.CertPEM, "BEGIN CERTIFICATE") {
		return InterInfo{}, errors.New("o arquivo do certificado não parece um .crt (PEM)")
	}
	if blk, _ := pem.Decode([]byte(c.KeyPEM)); blk == nil || !strings.Contains(blk.Type, "PRIVATE KEY") {
		return InterInfo{}, errors.New("o arquivo da chave não parece um .key (PEM)")
	}
	if _, _, err := keyPair(&c); err != nil {
		return InterInfo{}, err
	}
	if err := saveSealed(interFile(env, "config"), c); err != nil {
		return InterInfo{}, err
	}
	_ = os.Remove(interFile(env, "token"))
	return infoOfInter(&c), nil
}

func interStatus(env string) InterInfo {
	c, err := loadInter(env)
	if err != nil {
		return InterInfo{}
	}
	return infoOfInter(c)
}

func interClear(env string) {
	_ = os.Remove(interFile(env, "config"))
	_ = os.Remove(interFile(env, "token"))
}

func interClient(c *interConfig) (*http.Client, error) {
	pair, _, err := keyPair(c)
	if err != nil {
		return nil, err
	}
	cfg := &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{pair}, RootCAs: rootsForTest()}
	return &http.Client{Timeout: 60 * time.Second, Transport: &http.Transport{TLSClientConfig: cfg, Proxy: http.ProxyFromEnvironment}}, nil
}

// Tokens guardados por conjunto de escopos (o Inter limita a 5 gerações por minuto).
func interToken_(env string, c *interConfig, hc *http.Client, scopes string, fresh bool) (string, error) {
	tokens := map[string]interToken{}
	_ = loadSealed(interFile(env, "token"), &tokens)
	if t, ok := tokens[scopes]; ok && !fresh && time.Now().Before(t.Expires) {
		return t.Token, nil
	}
	base, err := interURL(env)
	if err != nil {
		return "", err
	}
	form := url.Values{"client_id": {c.ClientID}, "client_secret": {c.ClientSecret}, "grant_type": {"client_credentials"}, "scope": {scopes}}
	res, err := hc.PostForm(base+"/oauth/v2/token", form)
	if err != nil {
		return "", fmt.Errorf("sem conexão com o Inter: %w", err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != 200 {
		return "", fmt.Errorf("o Inter recusou o token (HTTP %d): %s", res.StatusCode, interErrorText(b))
	}
	var tr struct {
		AccessToken string  `json:"access_token"`
		ExpiresIn   float64 `json:"expires_in"`
	}
	if err := json.Unmarshal(b, &tr); err != nil || tr.AccessToken == "" {
		return "", errors.New("o Inter não devolveu o token")
	}
	life := time.Duration(tr.ExpiresIn) * time.Second
	if life <= 0 {
		life = time.Hour
	}
	tokens[scopes] = interToken{Token: tr.AccessToken, Expires: time.Now().Add(life - 2*time.Minute)}
	_ = saveSealed(interFile(env, "token"), tokens)
	return tr.AccessToken, nil
}

func interErrorText(b []byte) string {
	var o map[string]any
	if json.Unmarshal(b, &o) == nil {
		for _, k := range []string{"detail", "title", "error_description", "message", "error"} {
			if s, ok := o[k].(string); ok && s != "" {
				return s
			}
		}
	}
	s := strings.TrimSpace(string(b))
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}

// interCall faz uma chamada à API (path a partir do host, ex. "/cobranca/v3/cobrancas").
func interCall(env, method, path, query, body, scopes string) (*InterResult, error) {
	c, err := loadInter(env)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(path, "/") || strings.Contains(path, "..") || strings.HasPrefix(path, "/oauth") {
		return nil, fmt.Errorf("caminho inválido: %q", path)
	}
	if strings.TrimSpace(scopes) == "" {
		return nil, errors.New("informe os escopos da chamada")
	}
	base, err := interURL(env)
	if err != nil {
		return nil, err
	}
	hc, err := interClient(c)
	if err != nil {
		return nil, err
	}
	u := base + path
	if query != "" {
		u += "?" + strings.TrimPrefix(query, "?")
	}
	if method == "" {
		method = http.MethodGet
	}
	for attempt := 0; ; attempt++ {
		tok, err := interToken_(env, c, hc, scopes, attempt > 0)
		if err != nil {
			return nil, err
		}
		var rb io.Reader
		if body != "" {
			rb = strings.NewReader(body)
		}
		req, err := http.NewRequest(method, u, rb)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Accept", "application/json")
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if c.Account != "" {
			req.Header.Set("x-conta-corrente", c.Account)
		}
		res, err := hc.Do(req)
		if err != nil {
			return nil, fmt.Errorf("sem conexão com o Inter: %w", err)
		}
		b, _ := io.ReadAll(io.LimitReader(res.Body, maxOut))
		res.Body.Close()
		// Token recusado (expirou antes da hora ou foi revogado): um novo, uma vez.
		if res.StatusCode == http.StatusUnauthorized && attempt == 0 {
			continue
		}
		if len(b) > maxOut-4096 {
			return nil, errors.New("resposta do Inter grande demais")
		}
		return &InterResult{HTTPStatus: res.StatusCode, Body: string(b)}, nil
	}
}
