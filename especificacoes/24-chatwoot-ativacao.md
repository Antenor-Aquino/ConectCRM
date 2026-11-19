# 24 — Ativação Powercubus no Chatwoot

Porte do pacote `chatwoot-ativacao` (memorial de 19/11/2026) para dentro do ConectCRM.

## Onde fica
- **Configurações → Integrações → Chatwoot**: endereço (padrão `https://suporte.powercubus.com.br`),
  token (Perfil → Access Token; só neste computador, `chrome.storage.local`, fora do backup),
  conta (1), inbox de e-mail (16), agente (6), etiqueta (`conta-mg-ativacao`), assunto,
  funis em que o botão aparece (vazio = todos os comerciais), "Salvar e testar" (perfil + inbox)
  e "Criar os campos".
- **Cartão → Ativação Chatwoot**: janela com os 13 dados da nota privada, já preenchidos,
  com a origem de cada um; prévia da nota; aviso de ticket anterior (pede confirmação).

## De onde vem cada dado
| Campo | Origem |
|---|---|
| e-mail do cliente, nome do responsável | contato principal |
| usuário | campo `{{usuario_powercubus}}`; vazio = e-mail do contato principal |
| qtd de turmas, plano, fim da vigência, e-mail financeiro | campos `{{qtd_turmas}}`, `{{plano}}`, `{{fim_vigencia}}`, `{{email_financeiro}}` |
| data de vencimento do boleto | campo `{{vencimento_boleto}}`; vazio = vencimento da última cobrança (não cancelada) do cartão |
| valor | valor do cartão |
| razão social, CNPJ, CEP, endereço | organização **pagadora** (sem pagador, a principal) |
| nome da escola | organização principal |

Os 6 campos são criados (negócio, só nos funis escolhidos) pelo botão das Configurações.
O que for alterado na janela pode ser salvo de volta nesses campos do cartão.

## Envio (`src/lib/chatwoot.ts`)
Mesma sequência do módulo: busca o contato pelo e-mail exato (cria se não houver) →
conversa na inbox de e-mail **sem mensagem inicial** (não dispara e-mail) → nota privada →
etiqueta → link. Falha depois de criar a conversa: o erro traz o link e o ticket é registrado
mesmo assim (para não duplicar).

## Depois de abrir
- `chatwoot_ticket` (migration 0046): conversa, link e quem abriu; aviso se o cartão já abriu um.
- Nota no cartão com o link e os dados.
- Atividade "Acompanhar ativação no Chatwoot" para daqui a 2 dias (9h), do usuário que abriu.

## Permissões
`optional_host_permissions`: `https://suporte.powercubus.com.br/*` (pedida no 1º uso).
Outro endereço de Chatwoot exige incluir o host no manifesto.
