# 22 — Cobrança pelo Banco Inter (boleto + Pix)

Fases entregues: **F1** (base) e **F2** (boleto + Pix no cartão). Próximas: F3 (Pix
avulso: cobv/cob, devolução), F4 (extrato e saldo na Gestão Financeira), F5 (lotes,
webhooks se houver servidor).

## Como o Inter autentica
- Conta PJ (Inter Empresas) com uma **integração** criada no Internet Banking
  (Soluções para sua empresa → Minhas integrações), com os escopos de cobrança e
  extrato. Ao criar, baixa-se **certificado (.crt) e chave (.key)**; vale 1 ano
  (renovação abre 90 dias antes, mantém Client ID/Secret).
- Toda chamada: **mTLS** com esse certificado + **token OAuth** (client
  credentials, 1 hora; limite de 5 tokens/minuto).
- Hosts: produção `cdpj.partners.bancointer.com.br`; sandbox
  `cdpj-sandbox.partners.uatinter.co`.

## Arquitetura
- O Chrome não apresenta certificado de arquivo: quem fala com o Inter é o
  **ConectCRM Fiscal 1.1** (Native Messaging), comandos `interSetup`,
  `interStatus`, `interClear`, `interCall`.
- Certificado, chave, Client Secret e tokens ficam em
  `%LOCALAPPDATA%\ConectCRM\Fiscal\inter-<ambiente>-*.bin`, protegidos pelo
  Windows (DPAPI, só o usuário). **Nada disso entra no banco do CRM nem no backup.**
- Token guardado por conjunto de escopos (`INTER_SCOPES`) e renovado sozinho
  (401 → token novo, uma vez).
- Na extensão (`chrome.storage.local`, `conectcrm-inter`): ambiente e padrões do
  boleto (multa %, juros % a.m., cancelamento automático 0–60 dias, mensagem).

## Telas
- **Configurações → Integrações → Banco Inter**: ambiente, Client ID/Secret,
  conta (opcional), arquivos .crt/.key, "Salvar e testar" (consulta o saldo),
  validade do certificado, padrões do boleto.
- **Cartão → Cobrança**: escolhe **InfinitePay** ou **Banco Inter** (lembra o
  último). No Inter: pagador (organização com CNPJ e endereço, ou contato com
  CPF; CEP preenche o endereço), vencimento, multa, juros, cancelamento, mensagem.

## Emissão (API Cobrança v3)
1. `POST /cobranca/v3/cobrancas` (seuNumero `C`+aammddhhmmss+2, 15 caracteres;
   `formasRecebimento: [BOLETO, PIX]`) → `codigoSolicitacao`.
2. Consulta até sair de `EM_PROCESSAMENTO` (linha digitável e Pix copia e cola).
3. Grava `payment_charge` (provider `inter`, migration 0042) e a nota no cartão
   (mesmo formato da InfinitePay, com linha digitável e Pix).
4. PDF (`GET …/pdf`) vai para o GED (tipo "Boleto"), ligado ao cartão.
5. Receita aberta na Gestão Financeira já preenchida (`requestId` = seuNumero).
- Produção pede digitar PRODUÇÃO (como a NFS-e).

## Situação e baixa
- Sem webhook (exigiria servidor público com mTLS): o service worker consulta os
  boletos em aberto **a cada 30 min**; no cartão, "Atualizar situação".
- `RECEBIDO`/`MARCADO_RECEBIDO` → paga (data e valor recebido) e `settleLaunch`
  na Gestão Financeira; `CANCELADO`/`EXPIRADO`/`FALHA_EMISSAO` → cancelada e
  `removeLaunch`; `ATRASADO` → nota "vencida".
- "Cancelar" cancela no Inter (`POST …/cancelar` com motivo). Boleto do Inter
  não tem "Marcar como paga" nem "Reabrir": a situação vem do Inter.
- Sandbox: "Simular pagamento" (`POST …/pagar`).
