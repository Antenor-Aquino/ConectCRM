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

## Celular preenchido (0.2.100)
- Ao conectar ou atualizar os links, o CRM lê as perguntas personalizadas de
  cada link (`custom_questions`) e acha a de telefone: tipo `phone_number` ou
  nome com telefone/celular/WhatsApp.
- O Calendly preenche essas perguntas pela ordem (`a1`, `a2`…). O celular do
  lead vai nesse parâmetro, no formato `+55…` (o número sem DDI ganha o 55).
- Na tela de Integrações, o link que preenche o celular mostra
  "· preenche o celular".
- Contas conectadas antes desta versão são atualizadas sozinhas na próxima
  leitura.

## Fluxo: agendar primeiro no Calendly (0.2.101)
- O bloco **Agendar pelo Calendly** fica logo abaixo de "Responsável". Ele tem
  o toggle, o seletor do link (e da conta) e o botão **Abrir Calendly**.
- "Abrir Calendly" abre o link com nome, e-mail e celular do lead e
  `utm_term` = chave provisória (`d-…`).
  - Se o link ainda não tiver a posição do celular (conta conectada antes da
    0.2.100), ela é descoberta na hora.
  - O botão do cartão faz o mesmo ao abrir a janela.
- A janela procura o agendamento por essa chave a cada 5 s, e ao voltar para
  a aba, por até 30 min. Quando acha, preenche:
  - o início e a duração;
  - o link da reunião (Meet/Zoom/Teams). É ele que vai no lembrete do contato
    pelo WhatsApp (`{link}`);
  - o título, se estiver vazio.
- O botão volta a ser só **Salvar**:
  - se o agendamento já foi achado, a atividade fica ligada ao evento
    (`calendly.link`);
  - se não, a chave fica guardada (`conectcrm-calendly-drafts`) e a leitura
    em segundo plano liga a atividade quando o lead marcar.
- A leitura em segundo plano deixa para depois os agendamentos com chave
  provisória ainda não salva, por até 30 min, para não duplicar com a janela
  aberta.
- O link da reunião que o Calendly gera depois é completado na leitura.
- **Excluir** uma atividade ligada ao Calendly, na janela ou na lista:
  - o CRM pergunta e cancela o evento no Calendly pela API
    (`POST /scheduled_events/{uuid}/cancellation`), e o convidado recebe o
    aviso;
  - se o Calendly recusar, avisa que o evento precisa ser cancelado lá.
