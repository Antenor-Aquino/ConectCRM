# 18 — Integração com o Calendly (0.2.98)

## Objetivo
O contato escolhe o horário da reunião pelo link do Calendly e a reunião entra
sozinha no cartão certo do CRM, sem digitar nada.

## Conexão (Configurações → Integrações → Calendly)
- Uma ou mais contas, inclusive gratuitas, por **token de acesso pessoal**
  (Calendly: Integrações → API e webhooks → Tokens de acesso pessoal).
- O token fica só neste computador (`chrome.storage.local`, chave
  `conectcrm-calendly`). Não vai no backup do banco. Na exportação de
  configurações sem credenciais ele sai em branco. Na importação, o que esta
  instalação já tem é mantido.
- Permissão `https://api.calendly.com/*` pedida ao conectar
  (`optional_host_permissions`).
- Por conta: o link padrão (tipo de evento) enviado aos contatos e o botão
  "Atualizar links".
- Com mais de uma conta, cada funil pode usar uma conta. Sem escolha, vale a
  primeira.

## Link de agendamento (cartão)
- O botão "Link de agendamento" abre uma janela para escolher a conta e o link.
- A mensagem vem pronta, com o link já preenchido:
  - `name` e `email` do contato principal;
  - `utm_source=conectcrm` e `utm_content=<id do cartão>`.
- A mensagem pode ser copiada ou enviada pelo WhatsApp Web, com o telefone do
  contato.

## Agendamentos → atividades
- Sem webhook (recurso pago): o service worker lê os agendamentos a cada
  5 minutos, com o Chrome aberto. O botão "Sincronizar agora" faz a leitura na
  hora.
- Leitura: eventos de 2 dias atrás em diante. Só os eventos com `updated_at`
  novo buscam os convidados.
- Cada agendamento vira uma atividade do primeiro tipo "reunião":
  - título "Evento — Convidado";
  - descrição com as respostas do formulário;
  - link da videochamada;
  - duração.
- Vínculo: `external_ref` (provider `calendly`, entity `activity`,
  external_id = URI do evento). Repetir a leitura não duplica.
- Em que cartão a atividade entra:
  - o cartão do `utm_content`;
  - senão, o único negócio aberto do contato achado pelo e-mail;
  - senão, a atividade fica só no contato.
- Contato:
  - se não houver contato com o e-mail do convidado, ele é cadastrado;
  - o telefone (SMS ou pergunta com "telefone/WhatsApp") completa o cadastro
    sem telefone.
- Remarcado: o horário é atualizado.
- Cancelado ou remarcado no Calendly: a atividade antiga fica concluída, com
  "Cancelada: " ou "Remarcada: " no título.
- Atividade excluída no CRM não volta.
- Conflito de horário não é verificado (a agenda compartilhada já mostra).
- Cada novidade gera uma notificação do Chrome e uma entrada no sino.

## Testes
- `extension/tests/calendly.test.ts`: importação, sem duplicar,
  contato/negócio, remarcação, cancelamento, link e conversão.

## Agendar pela atividade (0.2.99)
- O bloco "Adicionar à agenda" (Google Agenda/Outlook direto) saiu da janela da
  atividade. O agendamento passa a ser pelo Calendly.
- No lugar dele entram:
  - o toggle **Agendar pelo Calendly**;
  - o seletor do link, e também da conta, quando houver mais de uma. A conta
    sugerida é a do funil do cartão.
- Com o toggle ligado, o botão vira "Salvar e abrir o Calendly":
  1. a atividade é salva;
  2. o Calendly abre com o nome e o e-mail do lead (o contato da atividade ou o
     do cartão), mais `utm_content=<cartão>` e `utm_term=<atividade>`.
- O agendamento com `utm_term` atualiza essa mesma atividade, sem criar outra:
  - recebe o horário, a duração e o link da videochamada;
  - a descrição fica com o texto da atividade e as respostas do formulário.
  Cancelar ou remarcar segue as regras de cima.
- O toggle não aparece em atividade que já veio do Calendly, nem quando não há
  conta do Calendly conectada.
