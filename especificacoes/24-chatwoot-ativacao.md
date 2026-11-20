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
| e-mail do usuário PowerCubus | campo `{{email_usuario_powercubus}}`; vazio = e-mail do contato principal |
| qtd de turmas, plano, fim da vigência, e-mail financeiro | campos `{{qtd_turmas}}`, `{{plano}}`, `{{fim_vigencia}}`, `{{email_financeiro}}` |
| data de vencimento do boleto | campo `{{vencimento_boleto}}`; vazio = vencimento da última cobrança (não cancelada) do cartão |
| valor | valor do cartão |
| razão social, CNPJ, CEP, endereço | organização **pagadora** (sem pagador, a principal) |
| nome da escola | organização principal |

Os 7 campos são criados (negócio, só nos funis escolhidos) pelo botão das Configurações.
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

## Tickets já abertos e cancelamento (0.2.142)
- Ao abrir a janela, o CRM consulta no Chatwoot a situação real de cada conversa do cartão
  (`GET /conversations/{id}`): Aberta, Pendente, Adiada, Resolvida ou Apagada (404), com o responsável.
- Cada conversa é uma linha com o link e, se não estiver resolvida/apagada, **Cancelar ticket**:
  observação obrigatória (mín. 3 letras) → nota privada "Ticket cancelado / Observação / Cancelado por"
  → devolve a conversa ao **dono do token** (`GET /profile`; `reassignTo` opcional no código)
  → resolve (`toggle_status`). Nada é apagado; o cliente não recebe e-mail (CSAT desligado na inbox 16).
- No CRM: `chatwoot_ticket.canceled_at` / `cancel_note` (migration 0047) e nota no cartão.
- O aviso amarelo e a caixa "Abrir outro ticket mesmo assim" só aparecem com ticket **em andamento**;
  com tudo encerrado, abrir um novo fica livre. Sem consulta ao Chatwoot, vale o registro do CRM.

## Anexos (0.2.143)
- Documentos do cartão (GED) podem ir para o ticket: contrato assinado, aviso de convocação etc.
- Ao abrir o ticket: seção "Anexos" na janela; os escolhidos vão numa **nota privada** logo depois da
  nota de ativação e da etiqueta (`POST /conversations/{id}/messages` em multipart: `content`,
  `message_type=outgoing`, `private=true`, `attachments[]`).
- Depois: "Enviar documentos" em cada conversa em andamento, com comentário opcional.
- Limite de 40 MB por arquivo (padrão do Chatwoot). Ler o arquivo conta como download na auditoria do documento.
- No cartão: a nota do ticket lista os anexos; envio posterior gera nota própria.
- Falha nos anexos ao abrir: a conversa já existe, o erro traz o link e o ticket fica registrado.

## Responder ao cliente por e-mail (0.2.144)
- Em cada conversa em andamento: **Responder ao cliente**. A mensagem é **pública**
  (`private: false`) na conversa da inbox de e-mail; o Chatwoot envia por e-mail ao contato,
  pelo endereço da inbox, com o assunto da conversa. Anexos do cartão vão no e-mail (multipart).
- Modelos (`src/lib/chatwootReplies.ts`), editáveis antes de enviar:
  1. Plataforma ativada + boleto e nota fiscal;
  2. Plataforma ativada;
  3. Envio do boleto e da nota fiscal;
  4. Texto livre.
  Variáveis: {primeiro_nome} {nome_responsavel} {nome_escola} {razao_social} {usuario}
  {email_usuario} {plano} {qtd_turmas} {fim_vigencia} {valor} {vencimento_boleto} {email_financeiro}.
- Avisa variável sem valor no cartão ou escrita errada; modelos com boleto/nota lembram de marcar os anexos.
- Confirmação antes de enviar (vai para fora e não dá para desfazer). Nota no cartão com o texto e os anexos.

## Conferir pagamento do boleto (0.2.145)
- Ao abrir o ticket com "Data de Vencimento do Boleto" válida (dd/mm/aaaa), o CRM cria também a
  atividade **"Conferir pagamento do boleto"** no cartão, **um dia após o vencimento, às 9h**,
  do usuário que abriu, com vencimento, valor, escola, pagador e o link do ticket na descrição.
- A janela avisa antes de abrir em que dia a atividade vai ficar.

## Rotina para tickets já abertos (0.2.146)
- Configurações → Integrações → Chatwoot → "Tickets já abertos: conferir pagamento do boleto".
- "Verificar tickets" mostra o plano por cartão (último ticket não cancelado): Criar para dd/mm,
  Já tem a atividade, Sem vencimento do boleto ou Cobrança já paga. "Criar N atividades" (administrador) executa.
- Vencimento: o da nota do ticket ("Data de Vencimento do Boleto"), senão o campo do cartão ou a última
  cobrança. Atividade um dia após o vencimento, às 9h, para quem abriu o ticket. Não repete.
