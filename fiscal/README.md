# ConectCRM Fiscal

Programa auxiliar do ConectCRM para o Windows. Ele emite a NFS-e pela API do
Emissor Nacional (Sefin Nacional) sem abrir o portal. Especificação:
`especificacoes/20-nfse-api.md`.

## O que ele faz
- Lista os certificados do Windows: A1 instalado e token A3. O CNPJ é lido do
  certificado ICP-Brasil (OID 2.16.76.1.3.3).
- Assina a DPS (`infDPS`) e o pedido de evento (`infPedReg`) no padrão XMLDSig:
  RSA-SHA1, C14N, enveloped, sem prefixo de namespace.
- Envia à Sefin com o certificado na conexão (TLS 1.2) e devolve à extensão a
  resposta, a chave de acesso e o XML da NFS-e.
- Conversa com a extensão pelo **Native Messaging** do Chrome
  (`com.conectcrm.fiscal`). Só a extensão do ConectCRM
  (`fabjbdmhpofceejnkeffkkiomoeifedj`) pode chamá-lo.

## Comandos (JSON)
| cmd | parâmetros | resposta |
|---|---|---|
| `ping` | | `version` |
| `listCerts` | | `certs[]` (thumbprint, subject, issuer, cnpj, cpf, notBefore, notAfter) |
| `sign` | `thumbprint`, `xml`, `element` (padrão `infDPS`) | `signed` |
| `emit` | `env` (`producao` / `producao_restrita`), `thumbprint`, `xml` (DPS sem assinatura) | `result` (httpStatus, body, accessKey, nfseXml), `signed` |
| `query` | `env`, `thumbprint`, `accessKey` | `result` |
| `event` | `env`, `thumbprint`, `accessKey`, `xml` (pedRegEvento sem assinatura) | `result`, `signed` |

## Instalação (usuário)
1. Dois cliques em `ConectCRMFiscal.exe`. Não precisa de administrador.
2. O programa se copia para `%LOCALAPPDATA%\ConectCRM\Fiscal`, grava o
   manifesto e o registra no Chrome e no Edge (`HKCU`).
3. Para remover: `ConectCRMFiscal.exe --uninstall`.
4. Para instalar sem a janela de aviso: `--quiet`.

O Windows pode avisar "O Windows protegeu o computador", porque o programa
ainda não tem assinatura de código: clique em **Mais informações → Executar
assim mesmo**.

O registro de uso fica em `%LOCALAPPDATA%\ConectCRM\Fiscal\fiscal.log`, sem
dados do certificado.

## Desenvolvimento
- `./build.sh` roda `go vet`, os testes e gera `dist/ConectCRMFiscal.exe`.
- Os testes rodam no Linux, com um certificado de teste no formato e-CNPJ e um
  servidor que exige certificado na conexão. A assinatura é conferida pelo
  `xmlsec1` quando instalado.
- `third_party/smimesign` é uma cópia da biblioteca `github/smimesign/certstore`
  (licença MIT) com um ajuste para compilar no mingw-w64 atual: a conversão de
  ponteiro no `LocalFree`.
