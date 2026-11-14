# Especificação 02 — Atividades

> Status: **em detalhamento**. Tela de referência: modal "Nova atividade"
> (tipo, responsável, quando com duração e lembrete).

## 1. Modal de atividade

Modal largo em **duas colunas**, botão ✕ no canto.

**Coluna esquerda**
- Círculo de **concluir** (marca/desmarca a atividade como feita) + campo
  **Nome da atividade** (título grande, obrigatório).
- Atividade nova: o nome já vem com o **tipo** escolhido ("Reunião ") para o
  usuário completar ou trocar. Mudar o tipo troca só esse começo (o que foi
  digitado depois continua); se o nome foi reescrito, não muda. Ao editar
  uma atividade existente o nome nunca é alterado.
- **Add descrição...** — texto longo logo abaixo, sem borda. Links
  (http/https, www., e-mail) ficam clicáveis e abrem em outra aba; clicar fora
  de um link volta a editar (0.2.44). O mesmo vale para a descrição de
  tickets e projetos.
- **Documentos**: "Anexar documentos" (vários) — viram documentos do GED com
  nome e classificação, vinculados à atividade, ao cartão, ao contato e à
  organização (spec 08). Numa atividade nova os arquivos aguardam e a janela
  Novo documento abre ao salvar.

**Coluna direita**

| Campo | Regra |
|---|---|
| **Tipo** | Lista com ícone e busca (com botão de limpar). Padrão: **Tarefa** |
| **Responsável** | Avatar + nome. O usuário atual aparece como **"Antenor (Você)"**; os demais com o tipo: "Maria (vendedor)". Padrão: o usuário atual |
| **Início** | Texto por extenso: **"16 de outubro às 18:25"**. Padrão: o momento do cadastro; pode ser alterado e pode ser futuro. Abre o painel da seção 2 |
| **Finalização** (opcional) | Data/hora de entrega. Vazio = "Sem finalização (opcional)"; ao clicar, sugere o mesmo dia, 5 min depois do início (0.2.80; perto da meia-noite, 23:59). Nunca antes do início. Sem finalização, fica atrasada quando o início é de um dia que já passou |
| **Vinculado a** (opcional) | Busca um **negócio, ticket ou etapa de projeto**. Pode ficar vazio (atividade avulsa). Com vínculo, a atividade herda contato e organização do cartão |
| **Tags** | Tags próprias de atividade (Configurações → Tags → Atividade) |
| **Campos personalizados** | Os criados em Configurações → Campos personalizados → Atividade |

**Rodapé:** **Salvar** (principal) · **Cancelar**.

## 2. Painel "Quando"

- Calendário mensal com título **"Out 2026"** e setas ‹ › (mês anterior /
  próximo), dias Dom–Sáb, dia selecionado em círculo azul, dias de outros
  meses em cinza.
- **Hora:** campo `hh:mm`.
- **Duração:** número em **min** (padrão 5).
- **Lembretes** (campo próprio, desde a 0.2.39): vários por atividade, cada um
  com a antecedência (min, horas ou dias) e os canais (Chrome, e-mail,
  WhatsApp). Atividade nova vem com os lembretes padrão do usuário. Regras em
  [`10-notificacoes.md`](10-notificacoes.md).
- Também aceita digitar direto no campo "Quando".

## 3. Tipos de atividade

Padrão (com ícone): **Ligar, Reunião, Agendamento, Tarefa, Prazo final, Almoço,
E-mail**.

- Cadastro em **Configurações → Tipos de atividade** (nome, ícone, ativo,
  ordem) para incluir/renomear tipos.
- Tipo **Reunião** (e **Agendamento**): opção de criar o evento no Google
  Agenda / Outlook com Meet/Teams e convidados — reaproveitando o
  agendamento do wa-pipedrive.

## 4. Vínculos

- Criada a partir de um negócio/ticket, contato ou organização: já nasce
  vinculada a ele (e herda contato/organização do negócio).
- Criada pelo botão "+" ou pelo menu Atividades: campo **Vinculado a** opcional.
- No cartão do Kanban, as atividades do item alimentam o contador de
  concluídas/total e o **indicador de atividades** (vermelho = atrasada,
  verde = hoje, cinza = futura, amarelo = nenhuma; spec 01, 6.0.1).
- Nomenclatura: **atividade** é o termo geral (menu, formulários, histórico);
  **Tarefa** é um dos tipos de atividade.

## 5. Lista de atividades (menu Atividades)

- Grupos: **Atrasadas**, **Em andamento** (pendentes iniciadas antes de
  hoje) e depois por dia de início.
- Cada linha mostra: tags, tipo, **funil › cartão** (clicável: abre o cartão
  no seu funil), **contato** e **organização** (clicáveis: abrem o cadastro),
  anexos (clique baixa o arquivo).
- À direita, o prazo: "faltam N dias", "falta 1 dia", "vence hoje",
  "atrasada há N dias"; sem finalização: "começa em N dias", "iniciada hoje ·
  sem prazo" e, de um dia que já passou, "atrasada há N dias (sem
  finalização)"; concluídas: "concluída no prazo" ou "com N dias de
  atraso". Abaixo, "Início dd/mm hh:mm" e "Fim dd/mm hh:mm · N dias" (duração
  total da atividade).
- **Atrasada** (regra única: contadores, filtros, cartão, relatórios e
  Copiloto) = pendente com a finalização já passada ou, sem finalização, com
  o início num dia anterior a hoje.
- Contadores: **atrasadas** (regra acima); **hoje** e
  **próximos 7 dias** = início ou finalização no período.
- Período: Hoje, Amanhã, Esta semana, Este mês, Todas e **Personalizado**
  (de/até, dias inteiros; começa no mês atual; "até" antes de "de" ajusta o
  outro lado). Vale para a lista; o calendário navega por mês.
- Filtros por período (hoje, amanhã, esta semana, atrasadas, personalizado),
  tipo, responsável e visão *Geral / Minhas / Minha equipe*.
- Concluir direto na lista; atrasadas em destaque.
- Visão em calendário (dia/semana/mês).
- Base: painel de atividades do wa-pipedrive.

## 6. Decisões

- T1: campo "Vinculado a" opcional (negócio, ticket ou projeto).
- T3: o antigo "Quando" virou **Início** (coluna `due_at`) e a nova coluna
  `end_at` é a **Finalização**. Na atualização, atividades antigas cuja data foi
  escolhida (diferente do momento do cadastro) passam a ter essa data como
  finalização; as criadas "agora" ficam sem finalização.
- T2: seletor do SLA e seletor da atividade coexistem, cada um como no mockup.
- Permissão: administrador vê todas as atividades; gestor, as da equipe;
  vendedor, as suas (atividades sem responsável aparecem para todos).
- Lembretes: ver [`10-notificacoes.md`](10-notificacoes.md).
- Agenda: tipos marcados como "Reunião" podem criar o evento no Google Agenda
  ou Outlook, com convidados, link do Meet/Teams e horários livres do dia.

## Atividades recorrentes (0.2.67)

Campo **Repetir** no formulário: Não repete, Diária, Dias úteis (segunda a
sexta), Semanal (a cada N semanas, nos dias marcados), Mensal (no mesmo dia —
dia 31 cai no último dia dos meses menores — ou "na 2ª terça"/"na última
sexta"), Anual (29/02 cai em 28/02 nos anos comuns) e A cada X dias (com "só
dias úteis"). **Termina**: Nunca, Em uma data ou Após N vezes. Opção
**Repetir só depois de concluir a atual**: a próxima é criada ao concluir,
contando da conclusão, na hora do início. A frase da regra aparece embaixo
("Toda semana: segunda e quarta às 09:00, sem data final").

- **Modelo**: a série (`activity_series`) guarda a regra (`lib/recurrence.ts`)
  e o modelo da atividade (tipo, título, descrição, duração, finalização
  relativa, lembretes, responsável, vínculos, campos e tags). As ocorrências
  são atividades normais (`series_id`, `series_index`), criadas para os
  próximos **60 dias**; a rotina das notificações completa a janela (no
  máximo a cada 3 h). Sem data final a série segue indefinidamente sem encher o
  banco. Início no passado: as ocorrências começam hoje.
- **Alterar** uma ocorrência: pergunta **Só esta**, **Esta e as próximas** ou
  **Todas** (mudando a regra, só as duas últimas). Só campos: as pendentes
  mudam no lugar (notas e documentos ficam); mudando data/hora ou regra, as
  pendentes são refeitas. "Esta e as próximas" no meio divide a série. As
  concluídas ficam como histórico.
- **Excluir**: Só esta (não volta mais), Esta e as próximas (a série acaba
  antes desta) ou Todas (pendentes e a série). Tudo pela lixeira; restaurar
  devolve.
- **Encerrar série…**: dá data final a uma série; as pendentes depois dela
  saem.
- Atividade comum que passa a repetir vira a 1ª ocorrência da série.
- Ícone ↻ nas listas (atividades, cartão, contato/organização). Em reuniões
  recorrentes o evento não é criado no Google Agenda/Outlook.

## Duplicar e excluir pela lista (0.2.75; telas: 0.2.76)

- **Duplicar** abre uma atividade **nova** ("Nova atividade (cópia)") preenchida
  com tudo o que está salvo na origem: nome, tipo, responsável, início,
  finalização, duração, descrição, lembretes, tags, campos personalizados,
  convidados, link da reunião, vínculo (cartão, ou contato e organização) e o
  lembrete para o contato por WhatsApp (como novo, a enviar). O usuário ajusta
  o que quiser e salva; nada é gravado antes disso.
  - Não vão junto: a recorrência (a cópia é avulsa; dá para ligar em Repetir),
    os anexos, a situação concluída e o histórico de avisos enviados.
  - Onde: nas listas de atividades — do cartão, da tela principal de
    Atividades (modo Lista) e das fichas de contato e de organização — e no
    rodapé da janela "Editar atividade" (a cópia parte do que está salvo).
    Componente único: `dashboard/tasks/TaskRowActions.tsx`.
- **Lixeira** nas mesmas listas: pede confirmação e manda para a
  lixeira, com o aviso "Restaurar / Ver lixeira" (spec 11). Atividade
  recorrente pergunta o alcance (só esta, esta e as próximas, toda a série).

## Vincular a atividade a um contato (0.2.78; cadastro pelo nome: 0.2.79)

- **Vinculado a** busca cartões (negócio, ticket, etapa de projeto) **e
  contatos**; cada item mostra se é cartão ou "Contato".
- Contato que não existe: **Cadastrar contato "…"** cria na hora (com o aviso
  de nome parecido já cadastrado) e já deixa a atividade vinculada a ele.
- Vinculada a um contato, a atividade grava o contato e a organização
  principal dele (aparece nas fichas dos dois); o lembrete pelo WhatsApp usa
  esse contato. Vinculada a um cartão, continua herdando contato e
  organização do cartão.
- Aberta na ficha do contato, já vem vinculada a ele. Na edição, a atividade
  sem cartão mostra o contato no campo; tirar o vínculo tira o contato.
- **Completar o cadastro sem sair da atividade (0.2.79):** o nome do contato
  no campo é um link que abre "Editar contato" por cima da atividade (celular,
  e-mail, organização…). Contato sem celular: o lembrete pelo WhatsApp mostra
  "Cadastrar o celular de …", que abre o mesmo cadastro. Ao salvar, os dados
  já valem na atividade aberta: o nome no campo, o celular em "Para" (o
  lembrete fica disponível) e o e-mail como convidado da reunião.


## Grupos recolhíveis e filtro Hoje (0.2.82)

- Na tela de Atividades (modo Lista), clicar no nome do grupo (Atrasadas, Em
  andamento, Hoje, Amanhã, "Qui, 06/11"…) **recolhe ou mostra** as atividades
  dele, como uma cortina; a seta indica o estado e a contagem continua
  visível. A escolha fica lembrada neste computador.
- **Hoje** e **Amanhã** trazem só as atividades do dia — que começam ou
  terminam nele —, sem as atrasadas nem as em andamento de dias anteriores
  (mesma regra do cartão "Para hoje"; filtro `dayOnly`). Semana, mês, todas e
  personalizado continuam mostrando também o que está em aberto no período.

## Agenda Unificada e "Adicionar à agenda" (0.2.96)

- **Atalho "Agenda Unificada"** no cabeçalho do cartão: abre (ou foca) a
  extensão Agenda Unificada (`chrome-extension://kliknamdgccgfoglbehcjmlpmdojcamm/dashboard.html`),
  que mostra juntas as agendas do Google e do Outlook.
- **"Adicionar à agenda"** (chave logo abaixo dos Lembretes) em **qualquer
  atividade** (antes, só em reuniões): escolhe Google Agenda ou Outlook e a
  **agenda** — a principal, as próprias e as **compartilhadas com permissão de
  edição** (lembra a última escolhida). Ao salvar, o evento é criado nessa
  agenda e aparece na Agenda Unificada. Reuniões continuam com convidados,
  link do Meet/Teams e horários livres; nelas a chave já vem ligada quando a
  conta está conectada. Atividades recorrentes não criam evento.
- Google Agenda só funciona com o Client ID do Google configurado no
  manifesto (`oauth2.client_id`); sem ele, a tela avisa. O Outlook já está
  configurado.
- Código: `lib/calendar.ts` (`listCalendars`, `calendarId` em
  `createCalendarEvent`), `lib/unifiedAgenda.ts`, `TaskModal.tsx`.
