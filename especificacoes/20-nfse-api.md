# 20 — NFS-e pela API do Emissor Nacional (plano B)

## Objetivo
Emitir, consultar e cancelar a NFS-e direto do cartão, sem abrir o portal. As
duas empresas entram: 28.288.572/0001-37 (certificado A1) e 68.153.622/0001-93
(certificado A3, token). O assistente do portal (spec 19, fase 3) continua como
alternativa.

## Por que existe um programa auxiliar
- A API Sefin Nacional exige conexão autenticada com o certificado ICP-Brasil
  da empresa (com o CNPJ no certificado).
- Também exige o XML da DPS **assinado** com a chave do certificado.
- Uma extensão do Chrome não apresenta certificado numa conexão e não acessa a
  chave do token A3.
- Por isso o **ConectCRM Fiscal**, um programa pequeno no Windows, faz essas
  duas coisas. Ele fala com a extensão pelo Native Messaging do Chrome.

## Arquitetura
```
Cartão → NfseDialog → (extensão) monta a DPS em XML (lib/nfse/dps.ts)
       → chrome.runtime.sendNativeMessage("com.conectcrm.fiscal", {...})
       → ConectCRM Fiscal (Windows):
            1. acha o certificado no repositório do Windows (A1 instalado ou token A3);
            2. assina infDPS (XMLDSig);
            3. compacta (gzip + base64);
            4. POST /nfse com o certificado na conexão;
            5. devolve o XML da NFS-e, a chave e o número, ou os erros da Receita.
       → extensão grava a nota no cartão (nfse.markIssued) e o XML no GED
```

## Detalhes técnicos confirmados
Fontes: manual da API (gov.br), Anexo I v1.01, esquemas XSD v1.01 e a
biblioteca aberta gildonei/nfse-nacional.

**Endereços**
- Produção: `https://sefin.nfse.gov.br/sefinnacional`.
- Produção restrita: `https://sefin.producaorestrita.nfse.gov.br/SefinNacional`.

**Serviços**
- `POST /nfse`: JSON `{ "dpsXmlGZipB64": … }`, com resposta síncrona.
- `GET /nfse/{chave}`: consulta.
- `POST /nfse/{chave}/eventos`: JSON `{ "pedidoRegistroEventoXmlGZipB64": … }`;
  é usado no cancelamento.

**Assinatura**
- Formato XMLDSig enveloped, dentro de `DPS`, logo após `infDPS`, com
  `Reference URI="#<Id>"`.
- Transforms: enveloped-signature e C14N 1.0
  (`http://www.w3.org/TR/2001/REC-xml-c14n-20010315`).
- Algoritmos: `rsa-sha1` na assinatura e `sha1` no digest.
- **Sem prefixo de namespace** (regra E1228).

**Certificado**
- Deve ser ICP-Brasil versão 3, com uso "Autenticação Cliente" e o CNPJ
  (OID 2.16.76.1.3.3). As regras de rejeição vão de E1200 a E1209.

**DPS**
- Versão 1.01, `xmlns="http://www.sped.fazenda.gov.br/nfse"`.
- Id da DPS (45 posições): "DPS" + município emissor (7) + tipo de inscrição
  (1 = CPF, 2 = CNPJ) + CNPJ (14) + série (5) + número (15).
- Série: de 00001 a 49999 para aplicativo próprio (regra E0010). O número é
  sequencial por empresa e série, e o CRM guarda o próximo.

**Regras do Simples ME/EPP** (`opSimpNac = 3`)
- `regApTribSN` é obrigatório (E0166); o padrão é 1, tributos federais e
  municipal pelo Simples.
- `regEspTrib = 0` (E0175).
- `indTotTrib` é proibido (E0712). A empresa informa a **alíquota do Simples
  Nacional** (`pTotTribSN`), que é um campo novo do cadastro da empresa.

**Outras regras**
- Inscrição municipal: obrigatória se a empresa tiver cadastro complementar no
  município, e proibida se não tiver (regras 198 e 200).
- Município emissor (`cLocEmi`): o município do endereço do CNPJ.

**PDF da nota (DANFSe):** a API de PDF do ADN foi suspensa em 03/08/2026
(NT 008). O DANFSe passa a ser gerado no próprio CRM, a partir do XML da NFS-e.

## Entregas
| Etapa | O que entrega |
|---|---|
| **B1** | Cadastro fiscal da API: alíquota do Simples, regime de apuração, alíquota do ISS (opcional), série e próximo número da DPS. Montagem do XML da DPS na extensão (`lib/nfse/dps.ts`) validada contra o XSD oficial nos testes. |
| **B2** | ConectCRM Fiscal (Go, executável único para Windows): lista certificados, assina, envia, consulta e cancela. Instala sozinho para o usuário (sem administrador), registra o Native Messaging só para a extensão do ConectCRM e funciona em produção restrita e em produção. |
| **B3** | Extensão: em cada empresa, escolha do certificado entre os listados pelo programa; botão "Emitir" na janela da nota; erros da Receita na janela; nota emitida no cartão com o XML no GED. |
| **B4** | Cancelamento pelo cartão (evento) e DANFSe em PDF gerado a partir do XML. (feito, 0.2.111) |
| **B5** | Teste real em produção restrita com os dois certificados; depois, produção. |

## Segurança
- O certificado e o PIN nunca passam pelo ConectCRM.
- No A3, o PIN é pedido pela janela do próprio driver do token, no Windows.
- O programa só aceita mensagens da extensão do ConectCRM (`allowed_origins`
  do Native Messaging) e só fala com os endereços oficiais da Sefin Nacional.
- O programa não guarda nada além de um registro de chamadas, sem dados de
  certificado.

## B1 — cadastro fiscal da API e XML da DPS (0.2.109)

**Empresa emissora** (migration `0036_nfse_api.sql`)
- `simples_rate`: alíquota do Simples Nacional, em %.
- `simples_regime`: `regApTribSN`, padrão 1.
- `iss_rate`: alíquota do ISS, em %, opcional; vira `pAliq`.
- `dps_series`: padrão "1".
- `dps_next`: próximo número da DPS.
- `cert_thumbprint`: certificado escolhido; preenchido na B3.

**Número da DPS reservado no rascunho:** `nfse_draft.dps_series` e `dps_number`
ficam no rascunho. Reenviar a mesma nota usa o mesmo número; uma nota nova
pega o próximo.

**`lib/nfse/dps.ts`**
- `buildDpsXml(rascunho, { ambiente, dhEmi, série, número })` gera o XML sem
  assinatura, na ordem do XSD, com os valores no formato `0.00` e o texto
  escapado.
- O teste valida o resultado com o `xmllint` contra `DPS_v1.01.xsd`
  (`tests/fixtures/nfse-xsd`).

**Pendência nova para ME/EPP:** "Informe a alíquota do Simples Nacional da
empresa".

## B2 — ConectCRM Fiscal (programa auxiliar, versão 1.0.0)
**Código:** pasta `fiscal/`, em Go. Gera um executável único para Windows 64
bits que depende só das bibliotecas do próprio Windows (CRYPT32, ncrypt,
ADVAPI32, KERNEL32, msvcrt). Detalhes de uso e desenvolvimento estão em
`fiscal/README.md`.

**Certificados**
- Lê o repositório "Pessoal" do usuário, onde ficam o A1 instalado e o token A3.
- Assina pelo CNG e, nos tokens antigos, pelo CryptoAPI. Os dois aceitam SHA-1.
- O PIN do A3 é pedido pelo driver do token.

**Assinatura**
- O digest é calculado sobre o `infDPS` com o namespace herdado de `DPS`
  declarado, como o C14N inclusivo exige.
- `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` vai logo depois do
  elemento assinado, com o certificado em `KeyInfo`.

**Conexão:** TLS 1.2, assinando com RSA PKCS#1, que os tokens suportam. O
certificado e a cadeia do Windows vão na conexão.

**Instalação**
- Sem administrador: a pasta `%LOCALAPPDATA%\ConectCRM\Fiscal`, o manifesto
  `com.conectcrm.fiscal.json` e as chaves `HKCU` do Chrome e do Edge.
- `allowed_origins` só tem a extensão do ConectCRM.
- `--uninstall` remove; `--quiet` instala sem janela.

**Verificação**
- Os testes em Go (`go test`) conferem:
  - o CNPJ lido do certificado e-CNPJ;
  - a assinatura da DPS gerada pela extensão, **validada pelo xmlsec1**, que
    recusa o XML adulterado;
  - a conversa Native Messaging (ping, listCerts, sign e erros);
  - a emissão contra um servidor que **exige certificado na conexão**: o XML
    chega assinado, em gzip e base64, e a resposta devolve chave e XML da
    NFS-e.
- No Windows simulado (Wine), o executável respondeu `ping` e `listCerts`,
  recusou a emissão sem certificado e a instalação gravou o manifesto e o
  registro.

**Falta testar no Windows real:** o certificado A1 instalado, o token A3 (PIN)
e a conexão com a Sefin. Isso entra na B3 e na B5.

## B3 — emitir pelo cartão, sem portal (0.2.110; ConectCRM Fiscal 1.0.1)
**Permissão:** `nativeMessaging` no manifesto. O cliente do programa fica em
`lib/nfse/fiscal.ts`: `fiscalVersion`, `listFiscalCerts`, `emitViaFiscal`,
`sefinErrors` e `nfseNumberFromXml`. Se o programa não estiver instalado, a
mensagem é amigável.

**Configurações → Nota fiscal**
- Mostra a situação do programa: "ConectCRM Fiscal x instalado" ou "não
  instalado: emissão pelo portal".
- Em cada empresa:
  - **Certificado digital**, numa lista que vem do programa (A1 instalados e
    tokens conectados) com o titular, o CNPJ e a data de vencimento. O botão
    "Atualizar" lê de novo depois de conectar o token.
  - Avisos de CNPJ diferente do da empresa e de certificado vencido.
- A lista de empresas mostra se cada uma "Emite pela API" ou "Emite pelo
  portal", e se falta a alíquota do Simples.

**Janela da nota**
- Com certificado escolhido, o botão principal é **Emitir NFS-e** (API) e
  "Pelo portal" fica como alternativa. Sem certificado, continua só o portal.
- Ao clicar em Emitir NFS-e:
  1. confirma o valor, o cliente, a empresa e o ambiente;
  2. reserva o número da DPS (`nfse.reserveDps`);
  3. monta o XML (`buildDpsXml`) e envia ao ConectCRM Fiscal, que assina e
     manda à Sefin;
  4. enquanto envia, aparece "Enviando à Receita… (A3: PIN na janela do
     Windows)".
- **Aceita:** grava número, chave e **XML da NFS-e** no cartão
  (`nfse_draft.nfse_xml`, migration `0037_nfse_xml.sql`), deixa uma nota no
  histórico ("emitida pela API… (ConectCRM Fiscal)") e oferece **Baixar XML da
  NFS-e**.
- **Recusada:** a caixa "A Receita recusou a nota" lista código e descrição de
  cada erro. Corrigido o problema, "Emitir NFS-e" reenvia com o mesmo número
  de DPS.

**ConectCRM Fiscal 1.0.1:** só o teste de ponta a ponta mudou.
`CONECTCRM_FISCAL_CA` indica a autoridade certificadora da Sefin simulada; em
uso normal valem as do Windows.

**Teste de ponta a ponta** (Chrome + o programa real + Sefin simulada que exige
certificado na conexão; o registro do Native Messaging é feito no perfil de
teste)
- Configurações mostra "ConectCRM Fiscal 1.0.1 instalado" e lista o
  certificado e-CNPJ de teste com o CNPJ certo.
- 1ª emissão: recusada (E0712), com o erro mostrado na janela.
- 2ª emissão: aceita. Número 126 e chave no cartão, XML baixado e nota no
  histórico.
- As duas tentativas chegaram com o mesmo Id de DPS e a assinatura conferida
  pelo xmlsec1 (OK, referência 1/1). Uma cópia adulterada dá FAIL.

## B4 — cancelamento e DANFSe em PDF (0.2.111; ConectCRM Fiscal sem mudança)

**Cancelamento pelo cartão.** Na janela "Nota fiscal", nota emitida ganha
"Cancelar NFS-e":

- Nota emitida pela API (XML guardado e empresa com certificado): motivo
  (1 Erro na emissão, 2 Serviço não prestado, 9 Outros) e descrição de 15 a 255
  caracteres. `lib/nfse/evento.ts` monta o pedido `pedRegEvento` v1.01 com o
  evento `e101101` (Id = "PRE" + chave + "101101", `dhEvento` no horário de
  Brasília, `CNPJAutor` = CNPJ da empresa emissora), validado no XSD oficial
  nos testes. O ConectCRM Fiscal (comando `event`, já existente) assina
  `infPedReg` e envia `POST /nfse/{chave}/eventos`. Recusa da Receita (ex.:
  prazo do município excedido) aparece na tela; a nota continua valendo.
- Nota emitida pelo portal: o cancelamento é feito no Emissor Nacional; o CRM
  só registra ("Já cancelei no portal").
- Migration 0038: `canceled_at`, `cancel_code`, `cancel_reason`,
  `cancel_event_xml` (resposta da Sefin, ou o pedido assinado) em `nfse_draft`.
  RPC `nfse.markCanceled` (idempotente; exige a chave da nota do cartão) deixa
  nota no histórico do cartão com o motivo.
- "Preparar nova nota" (RPC `nfse.reopen`, só depois de cancelar): a nota
  cancelada sai do rascunho atual mas fica guardada no banco; o novo rascunho
  reaproveita empresa e textos e recebe um número de DPS novo ao emitir.

**DANFSe (PDF).** A API de DANFSe do ADN foi suspensa (NT 008, 03/08/2026);
`lib/nfse/danfse.ts` gera o PDF no navegador a partir do XML da NFS-e
(pdf-lib + qrcode-generator), seguindo a NT 008 v1.02:

- A4 retrato, uma página; grade de 4 colunas do item 2.4.5; linhas de 0,5 pt,
  borda da página de 1 pt; cinza 5% no cabeçalho, títulos de bloco, "Emitente"
  e "Valor Líquido + IBS/CBS"; rótulos 6/7 pt negrito, conteúdo 7 pt.
- Cabeçalho com a logomarca oficial (`public/nfse-logo.png`), "DANFSe v2.0",
  município / ambiente gerador / tipo de ambiente; produção restrita →
  "NFS-e SEM VALIDADE JURÍDICA" em vermelho.
- QR Code (≥ 1,52 cm, em X 17,48 / Y 1,67) para
  `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=…`, com o texto de 3 linhas.
- Blocos: identificação, prestador (dados do `emit` + Simples/regime da DPS),
  tomador, destinatário/intermediário (supressão "NÃO IDENTIFICADO NA NFS-e"),
  serviço, ISSQN (ou "OPERAÇÃO NÃO SUJEITA AO ISSQN"), federal (PIS/COFINS de
  apuração própria até competência 2026), IBS/CBS (só quando a nota traz o
  grupo), totais e informações complementares (pedido, observação, xOutInf,
  substituída, obra/evento e totais aproximados da Lei 12.741 — no Simples,
  "Simples Nacional: x%"). Campo vazio = "-"; texto longo é cortado com "...".
- Nota cancelada: marca d'água diagonal "CANCELADA" (cinza K35).
- Botão "Baixar DANFSe (PDF)" na janela da nota (arquivo `DANFSe-NFS-e-<nº>.pdf`).

**Verificado:** testes (XSD do evento, banco, leitura do XML, PDF lido com
pdf.js, QR Code decodificado) e Chrome com o programa Fiscal real registrado
como Native Messaging e Sefin simulada exigindo certificado: emitir → baixar
DANFSe → cancelamento recusado (E0840) → cancelado (evento assinado, conferido
com xmlsec1) → DANFSe com "CANCELADA" → preparar nova nota.
**Falta (B5):** cancelamento real em produção restrita com A1 e A3.

## B5 — preparação do teste real (0.2.112; ConectCRM Fiscal 1.0.2)

O teste real (A1 e token A3 contra a Sefin de produção restrita) é feito pelo
dono do projeto no Windows, seguindo o roteiro entregue em PDF
(`Roteiro-teste-B5-NFSe.pdf`). Para deixá-lo seguro e diagnosticável:

- **Testar conexão com a Receita** (Configurações → Nota fiscal → empresa →
  certificado): consulta pela API uma NFS-e que não existe (chave com o
  município e CNPJ da empresa e número 0) usando o certificado escolhido.
  Confere programa instalado, certificado/PIN e a conexão mTLS sem emitir
  nada. 2xx/4xx (exceto 401) = certificado aceito; 401 = certificado recusado;
  5xx = Receita fora; erro de conexão = TLS/rede (`classifyProbe`,
  `testSefinConnection` em `lib/nfse/fiscal.ts`).
- **ConectCRM Fiscal 1.0.2**: o `fiscal.log` passa a registrar o status HTTP e
  os códigos de erro da Sefin (ex.: `emit producao_restrita: HTTP 400 E0712`),
  sem dados da nota, PIN ou chave.
- Verificado no Chrome com o programa real e Sefin simulada (consulta com
  certificado do cliente na conexão).

**Pendente (depende do teste no Windows):** resultado com A1 e A3, ajustes
pelos códigos de erro reais, e só então liberar Produção.

**Primeiro resultado real (produção, só o teste de conexão, A1):** a Sefin
respondeu com `tls: no renegotiation`. O servidor (IIS) abre o TLS 1.2 sem
pedir o certificado e só o pede numa renegociação, que o Go recusa por padrão.
**ConectCRM Fiscal 1.0.3** aceita a renegociação (`tls.RenegotiateFreelyAsClient`).
Reproduzido com um servidor de testes que renegocia pedindo o certificado:
a 1.0.2 falha com o mesmo erro e a 1.0.3 conecta e envia o certificado.
O programa passa a ser entregue dentro de .zip (o download direto de .exe é
bloqueado pelo navegador/app).


**Segundo resultado real (emissão):** `falha ao assinar: failed to sign digest:
SECURITY_STATUS -2146893779` (0x8009002D, NTE_INTERNAL_ERROR) — o provedor da
chave recusou a assinatura RSA/SHA-1 pelo caminho normal do CNG (típico de
certificado A1 importado num provedor antigo do Windows ou de driver de token).
**ConectCRM Fiscal 1.0.4**: se o CNG recusar, tenta (1) CNG com o DigestInfo
montado pelo programa e (2) CryptoAPI, reabrindo a chave pelo certificado; o
`fiscal.log` registra qual caminho assinou. Só compila e testa em Windows real
(não há como reproduzir o provedor do cliente aqui).

**Terceiro resultado real:** com a 1.0.4 a extensão mostrou "não está
instalado" — na verdade o Chrome avisou que o programa fechou sozinho ("Native
host has exited") durante a assinatura (o driver/provedor da chave derrubou o
processo numa das tentativas). **ConectCRM Fiscal 1.0.5 / extensão 0.2.113**:
CryptoAPI passa a ser a 1ª reserva (mais compatível com provedores antigos e
tokens); cada tentativa é registrada no `fiscal.log` antes de rodar; pane em Go
vira erro com a pilha no log; a extensão distingue "não instalado" de "fechou
sozinho"; o instalador renomeia o programa antigo se ele estiver em uso.

**Quarto resultado real (token A3, CLAUDIA):** o `fiscal.log` mostrou que o
token assina SHA-256 (o teste de conexão passou: HTTP 404 E2401) mas recusa
SHA-1 por todos os caminhos (CNG: 0x8009002D; CryptoAPI também recusou); a
tentativa de CNG sem identificar o hash derrubou o driver. Os testes rodaram
em **produção** (nenhuma nota saiu).
**ConectCRM Fiscal 1.0.6 / extensão 0.2.114:** se a assinatura SHA-1 falhar,
a DPS/evento é assinada com **RSA-SHA256** (`xmldsig-more#rsa-sha256`, digest
`xmlenc#sha256`) — o `xmldsig-core-schema` do leiaute 1.01 não fixa mais o
algoritmo (o 1.00 fixava SHA-1); a tentativa que derrubava o driver foi
retirada. Na extensão, emitir ou cancelar em produção exige digitar
"PRODUÇÃO", e a janela da nota mostra um aviso vermelho quando o ambiente é
produção. Falta confirmar na Receita (produção restrita) que a assinatura
SHA-256 é aceita.

**Quinto resultado real (token A3, produção restrita):** SHA-256 também
recusado (0x8009002D) na assinatura do XML — mas o mesmo token assina
SHA-256 no TLS do teste de conexão. Diferença: o XML era assinado antes de
qualquer conexão, na thread principal. **ConectCRM Fiscal 1.0.7:** emissão e
cancelamento primeiro abrem a conexão com certificado (GET de uma chave
inexistente — o token pede o PIN e abre a sessão), depois assinam o XML numa
thread própria do sistema e enviam pela mesma conexão; o log registra a
abertura da sessão e o tempo da assinatura.

**Sexto resultado real (token A3, produção restrita): assinatura aceita.** A
Receita recusou por esquema (E1235: `infDPS` não aceita `cLocEmi` logo após
`tpEmit`; esperava `cMotivoEmisTI`/`finNFSe`). A produção restrita já usa o
leiaute da reforma tributária (NT 009, anexo VI v1.04.01; esquemas
`esquemas_prod_restrita_20261020.zip`, mesmos nomes de arquivo v1.01, conteúdo
novo). **Extensão 0.2.115:** DPS com `finNFSe` = 0 (NFS-e regular) após
`tpEmit` e `cNBS` antes de `xDescServ` (agora o último de `cServ`); os XSD dos
testes foram trocados pelos de 20/10/2026 (DPS e pedido de cancelamento
validados); o DANFSe lê `finNFSe` de `infDPS`.
**Atenção para 2027:** para optantes do Simples, o grupo `IBSCBS` da DPS passa
a ser obrigatório em 2027, e há regra prevista para `regApIBSCBSSN` no
`regTrib` — tarefa a fazer antes de janeiro (ainda não está no XSD atual).

**Sétimo resultado real (token A3, produção restrita):** E0039 — "o município
emissor informado na DPS deve estar parametrizado para utilizar os emissores
públicos nacionais". O XML passou no esquema e a assinatura foi aceita; a
recusa é cadastral: Petrolina (2611101) não está parametrizada no ambiente de
produção restrita. Não há o que corrigir no CRM. Próximo passo depende do
dono: confirmar se a empresa já emite pelo Emissor Nacional em produção (o
município estaria parametrizado lá) e fazer a primeira nota real pelo CRM, ou
testar com a outra empresa se o município dela estiver parametrizado.
