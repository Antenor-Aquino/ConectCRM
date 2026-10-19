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
- **Add descrição...** — texto longo logo abaixo, sem borda.
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
| **Finalização** (opcional) | Data/hora de entrega. Vazio = "Sem finalização (opcional)"; ao abrir, sugere o dia seguinte ao início às 18:00. Nunca antes do início. Sem finalização, fica atrasada quando o início é de um dia que já passou |
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
