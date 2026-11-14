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
| **B4** | Cancelamento pelo cartão (evento) e DANFSe em PDF gerado a partir do XML. |
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
