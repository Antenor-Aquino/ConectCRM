// ConectCRM Fiscal (spec 20): programa auxiliar do ConectCRM no Windows.
// Assina a DPS / pedidos de evento com o certificado da empresa (A1 ou token A3)
// e conversa com a API Sefin Nacional da NFS-e. Fala com a extensão pelo Native
// Messaging do Chrome (só a extensão do ConectCRM pode chamá-lo).
//
// Uso:
//   ConectCRMFiscal.exe              → instala (ou reinstala) para o usuário atual
//   ConectCRMFiscal.exe --uninstall  → remove
//   --quiet                          → sem a janela de aviso (instalação automática)
//   (o Chrome o abre sozinho, com a origem da extensão como argumento)
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	version   = "1.0.0"
	hostName  = "com.conectcrm.fiscal"
	extOrigin = "chrome-extension://fabjbdmhpofceejnkeffkkiomoeifedj/"
)

type request struct {
	ID          string `json:"id"`
	Cmd         string `json:"cmd"`
	Env         string `json:"env"`
	Thumbprint  string `json:"thumbprint"`
	XML         string `json:"xml"`
	Element     string `json:"element"`
	AccessKey   string `json:"accessKey"`
}

type response struct {
	ID      string       `json:"id"`
	OK      bool         `json:"ok"`
	Error   string       `json:"error,omitempty"`
	Version string       `json:"version,omitempty"`
	Certs   []CertInfo   `json:"certs,omitempty"` // sem certificados: o campo some (a extensão trata como lista vazia)
	Signed  string       `json:"signed,omitempty"`
	Result  *SefinResult `json:"result,omitempty"`
}

func dataDir() string {
	base, err := os.UserCacheDir() // Windows: %LOCALAPPDATA%
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "ConectCRM", "Fiscal")
}

func withIdentity(thumb string, fn func(Identity) error) error {
	ids, closeAll, err := openIdentities()
	if err != nil {
		return fmt.Errorf("não foi possível abrir os certificados do Windows: %w", err)
	}
	defer closeAll()
	t := strings.ToUpper(strings.ReplaceAll(thumb, " ", ""))
	for _, id := range ids {
		if thumbprint(id.Certificate()) == t {
			return fn(id)
		}
	}
	return fmt.Errorf("certificado não encontrado neste computador (se for A3, conecte o token)")
}

func handle(req request) response {
	res := response{ID: req.ID}
	fail := func(err error) response {
		res.Error = err.Error()
		log.Printf("%s: erro: %v", req.Cmd, err)
		return res
	}
	log.Printf("%s %s", req.Cmd, req.Env)
	switch req.Cmd {
	case "ping":
		res.Version = version
	case "listCerts":
		ids, closeAll, err := openIdentities()
		if err != nil {
			return fail(err)
		}
		defer closeAll()
		res.Certs = []CertInfo{}
		for _, id := range ids {
			res.Certs = append(res.Certs, infoOf(id.Certificate()))
		}
	case "sign": // conferência / diagnóstico: só assina, não envia
		err := withIdentity(req.Thumbprint, func(id Identity) error {
			s, err := id.Signer()
			if err != nil {
				return err
			}
			el := req.Element
			if el == "" {
				el = "infDPS"
			}
			res.Signed, err = signElement(req.XML, el, s, id.Certificate())
			return err
		})
		if err != nil {
			return fail(err)
		}
	case "emit":
		err := withIdentity(req.Thumbprint, func(id Identity) error {
			r, signed, err := emitDPS(id, req.Env, req.XML)
			res.Result, res.Signed = r, signed
			return err
		})
		if err != nil {
			return fail(err)
		}
	case "query":
		err := withIdentity(req.Thumbprint, func(id Identity) error {
			r, err := queryNFSe(id, req.Env, req.AccessKey)
			res.Result = r
			return err
		})
		if err != nil {
			return fail(err)
		}
	case "event":
		err := withIdentity(req.Thumbprint, func(id Identity) error {
			r, signed, err := sendEvent(id, req.Env, req.AccessKey, req.XML)
			res.Result, res.Signed = r, signed
			return err
		})
		if err != nil {
			return fail(err)
		}
	default:
		return fail(fmt.Errorf("comando desconhecido: %q", req.Cmd))
	}
	res.OK = true
	return res
}

// serve atende a extensão até o Chrome fechar a conexão.
func serve(in io.Reader, out io.Writer) error {
	for {
		b, err := readMessage(in)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		var req request
		if err := json.Unmarshal(b, &req); err != nil {
			_ = writeMessage(out, response{Error: "mensagem inválida"})
			continue
		}
		if err := writeMessage(out, handle(req)); err != nil {
			return err
		}
	}
}

func main() {
	_ = os.MkdirAll(dataDir(), 0o700)
	if f, err := os.OpenFile(filepath.Join(dataDir(), "fiscal.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
		log.SetOutput(f)
	} else {
		log.SetOutput(io.Discard)
	}
	args := os.Args[1:]
	if len(args) > 0 && strings.HasPrefix(args[0], "chrome-extension://") {
		if err := serve(os.Stdin, os.Stdout); err != nil {
			log.Printf("conexão encerrada: %v", err)
		}
		return
	}
	quiet := false
	for _, a := range args {
		if a == "--quiet" {
			quiet = true
		}
	}
	show := func(msg string, err error) {
		if quiet {
			if err != nil {
				log.Printf("instalação: erro: %v", err)
				os.Exit(1)
			}
			log.Printf("instalação: %s", strings.SplitN(msg, "\n", 2)[0])
			return
		}
		report(msg, err)
	}
	switch {
	case len(args) > 0 && args[0] == "--version":
		fmt.Println("ConectCRM Fiscal", version, runtime.GOOS)
	case len(args) > 0 && args[0] == "--uninstall":
		show(uninstall())
	default:
		show(install())
	}
}
