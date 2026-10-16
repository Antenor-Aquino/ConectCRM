# Especificação 02 — Tarefas

> Status: **em detalhamento**. Tela de referência: modal "Nova tarefa"
> (tipo, responsável, quando com duração e lembrete).

## 1. Modal de tarefa

Modal largo em **duas colunas**, botão ✕ no canto.

**Coluna esquerda**
- Círculo de **concluir** (marca/desmarca a tarefa como feita) + campo
  **Nome da tarefa** (título grande, obrigatório).
- **Add descrição...** — texto longo logo abaixo, sem borda.

**Coluna direita**

| Campo | Regra |
|---|---|
| **Tipo** | Lista com ícone e busca (com botão de limpar). Padrão: **Tarefa** |
| **Responsável** | Avatar + nome. O usuário atual aparece como **"Antenor (Você)"**; os demais com o tipo: "Maria (vendedor)". Padrão: o usuário atual |
| **Quando** | Texto por extenso: **"16 de outubro às 18:25"**. Padrão: agora. Abre o painel da seção 2 |

**Rodapé:** **Salvar** (principal) · **Cancelar**.

## 2. Painel "Quando"

- Calendário mensal com título **"Out 2026"** e setas ‹ › (mês anterior /
  próximo), dias Dom–Sáb, dia selecionado em círculo azul, dias de outros
  meses em cinza.
- **Hora:** campo `hh:mm`.
- **Duração:** número em **min** (padrão 5).
- **Lembrete** (?): número em **min antes** (padrão 5) — dispara notificação
  do Chrome (via `chrome.alarms`) mesmo com o CRM fechado.
- Também aceita digitar direto no campo "Quando".

## 3. Tipos de tarefa

Padrão (com ícone): **Ligar, Reunião, Agendamento, Tarefa, Deadline, Almoço,
E-mail**.

- Cadastro em **Configurações → Tipos de tarefa** (nome, ícone, ativo,
  ordem) para incluir/renomear tipos.
- Tipo **Reunião** (e **Agendamento**): opção de criar o evento no Google
  Agenda / Outlook com Meet/Teams e convidados — reaproveitando o
  agendamento do wa-pipedrive.

## 4. Vínculos

- Criada a partir de um negócio/ticket, contato ou organização: já nasce
  vinculada a ele (e herda contato/organização do negócio).
- Criada pelo botão "+": ver pendência T1.
- No cartão do Kanban, as tarefas do item alimentam o contador de
  concluídas/total (indicadores definidos mais à frente).

## 5. Lista de tarefas (menu Tarefas)

- Filtros por período (hoje, amanhã, esta semana, atrasadas, personalizado),
  tipo, responsável e visão *Geral / Minhas / Minha equipe*.
- Concluir direto na lista; atrasadas em destaque.
- Visão em calendário (dia/semana/mês).
- Base: painel de atividades do wa-pipedrive.

## 6. Pendências

- **T1:** a tarefa criada pelo "+" precisa de um campo para vincular a
  negócio/ticket/contato/organização? (O modal enviado não mostra esse
  campo.) Proposta: um campo "Vinculado a" com busca, abaixo de "Quando".
- **T2:** o seletor de data do **SLA** (colunas de hora/minuto, botões
  Agora/OK) é diferente do "Quando" da tarefa. Manter os dois como nos
  mockups ou padronizar num só?
