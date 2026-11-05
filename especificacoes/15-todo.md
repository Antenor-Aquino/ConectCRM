# Especificação 15 — To Do (lista pessoal de afazeres)

Benchmark: Microsoft To Do. **Separado das Atividades** (decisão do produto):
o To Do é a lista pessoal e rápida, sem horário nem cliente obrigatórios; as
Atividades continuam sendo os compromissos com cliente. Cada usuário vê só as
próprias listas e tarefas.

## Fases

| Fase | Entrega | Versão |
|---|---|---|
| 1. Base | Banco, menu, Minhas listas, adicionar rápido, concluir, estrela, Concluída, painel de detalhes, listas inteligentes | 0.2.84 |
| 2. Meu Dia | Adicionar a Meu Dia, zera à meia-noite, sugestões; **atividades do CRM de hoje dentro do Meu Dia** (decidido: sim) | 0.2.85 |
| 3. Lembretes e repetição | Lembrete (som e janela de aviso), Repetir, contador no menu | 0.2.86 |
| 4. Organização | Grade (tabela), ordenar, arrastar, grupos de listas, busca geral, data no texto | 0.2.87 |
| 5. Integração | Vínculo com cartão/contato, transformar em atividade, anexos (GED), atribuído a mim, "+ To Do" no popup, Copiloto | 0.2.88 |

## Fase 1 (0.2.84)

- **Menu principal:** item **To Do**, entre Atividades e Contatos.
- **Listas inteligentes:** Importante (estrela), Planejado (com vencimento,
  agrupado em Atrasadas / Hoje / Amanhã / Esta semana / Depois), Todas
  (abertas de todas as listas) e Tarefas (sem lista). Contador de pendentes.
- **Minhas listas:** criar ("Nova lista" + Enter), renomear, cor e excluir
  ("…" da lista). Excluir leva as tarefas junto para a lixeira e restaurar
  traz tudo de volta.
- **Tarefa:** "Adicionar uma tarefa" + Enter (fica no topo; criada em
  Importante já vem com estrela, em Planejado com vencimento hoje); círculo
  para concluir; estrela; linha mostra lista (nas inteligentes), etapas
  "1 de 2", vencimento (vermelho se atrasada) e ícone de observações.
- **Concluída (n):** seção recolhível no fim da lista (lembra se está aberta);
  nas listas inteligentes, as concluídas não aparecem (como no Microsoft To Do),
  exceto em "Tarefas".
- **Painel de detalhes** (clique na tarefa): título, concluir, estrela,
  **etapas** (adicionar, marcar, renomear, remover), data de vencimento,
  **mover para outra lista**, observações; rodapé com criação/conclusão e
  excluir (lixeira). Salva ao sair de cada campo.
- Pesquisa dentro da lista aberta.
- Banco: `todo_list`, `todo_task` (`list_id` nulo = Tarefas; `my_day` já
  previsto para a fase 2) e `todo_step` (migração 0027); `db/todo.ts`.

## Menu principal que se ajusta à tela (0.2.84)

Com o item novo, o menu não cabia em telas comuns. Agora os itens que não
cabem vão para **"Mais"** (na mesma ordem) e o "+" fica sempre à vista; a
pesquisa geral vira só a lupa abaixo de 1920 px (abre no clique ou Ctrl+K).
Em 1745 px cabem todos os itens.

## Fase 2 — Meu Dia (0.2.85)

- **Meu Dia** é a primeira lista inteligente e a tela que abre por padrão,
  com a data por extenso no cabeçalho. Tarefa criada nela entra em Meu Dia.
- Vale **só para hoje**: `my_day` guarda a data (AAAA-MM-DD); à meia-noite a
  lista começa vazia de novo, sem apagar nada (a tarefa continua na lista dela).
  As concluídas de hoje aparecem em "Concluída".
- **Adicionar a Meu Dia** / "Adicionada a Meu Dia" no painel de detalhes; nas
  outras listas a linha mostra a marca "☀ Meu Dia".
- **Sugestões** (botão com a lâmpada): "De dias anteriores" (estavam em Meu Dia
  e não foram concluídas), "Vencem hoje ou atrasadas" e "Importantes"; o "+"
  põe a tarefa em Meu Dia. Cada tarefa aparece em um só grupo.
- **Atividades do CRM hoje**: abaixo das tarefas, as atividades do usuário que
  são do dia (mesmo critério do filtro "Hoje" de Atividades), com horário, tipo
  e vínculo; dá para concluir/reabrir ali e o clique abre a atividade. Seção
  recolhível (lembra o estado). As atividades continuam no módulo Atividades —
  o To Do só as mostra.
- RPC novo `todo.suggestions`; contador `meudia` em `todo.lists`.

## Fase 3 — Lembretes, repetir e contador (0.2.86)

- **Lembrar-me** (painel de detalhes): atalhos "Mais tarde hoje" (+3 h),
  "Amanhã (09:00)", "Próxima semana (seg., 09:00)" ou data e hora livres.
  Na hora, o Chrome avisa (balão + janela de aviso do CRM, com o som escolhido
  em Notificações) com **Concluir**, **Adiar 10 min**, **Abrir** (abre o To Do
  na tarefa) e OK; também entra no sino. Avisa uma vez; mudar o lembrete ou
  adiar volta a valer. Tarefa concluída ou excluída não avisa. Com o Chrome
  fechado na hora, avisa ao abrir (com "lembrete de dd/mm hh:mm").
- **Repetir:** Diariamente, Dias da semana, Semanalmente, Mensalmente,
  Anualmente ou Personalizado (a cada N dias/semanas/meses/anos; na semana,
  escolhe os dias). Sem vencimento, passa a vencer hoje. Ao **concluir**, cria a
  próxima na mesma lista (título, observações, estrela e etapas desmarcadas;
  lembrete na mesma hora do novo dia) e a concluída deixa de repetir — reabrir
  não duplica. Mês com dia 31 cai no último dia do mês; atrasada gera a próxima
  a partir de hoje, nunca outra atrasada.
- Atalhos de vencimento: Hoje, Amanhã, Próx. semana.
- Linha da tarefa: sino com o horário do lembrete e ícone de repetir.
- **Contador no menu "To Do":** tarefas abertas no Meu Dia de hoje, vencidas
  ou que vencem hoje e com lembrete que já chegou (cada uma conta uma vez).
- Banco: `remind_at`, `reminded_at`, `recurrence` em `todo_task` (migração
  0028); RPC `todo.dueReminders` (service worker, a cada minuto), `todo.snooze`,
  `todo.badge`; regras em `lib/todo.ts` (`nextDue`, `nextOccurrence`).

## Fase 4 — Organização (0.2.87)

- **Grupos de listas** (como no Microsoft To Do): "Novo grupo" no menu
  lateral (a lista aberta já entra nele); o título do grupo recolhe/abre
  (lembra o estado; recolhido mostra "n listas"); "…" do grupo: Renomear e
  **Desagrupar listas** (as listas ficam soltas no lugar do grupo; nada vai
  para a lixeira). No "…" da lista: **Grupo** (mover para um grupo ou "Sem
  grupo").
- **Arrastar no menu:** lista sobre outra lista = vai para antes dela (entra
  no grupo dela, se tiver); lista sobre o título de um grupo = entra no fim
  do grupo; "Soltar aqui (fora de grupo)" = sai do grupo e vai para o fim.
  Grupos também se arrastam.
- **Arrastar tarefas:** sobre outra tarefa = ordem manual; sobre uma lista do
  menu = muda de lista; sobre Meu Dia, Importante, Planejado (vence hoje) ou
  Tarefas (sem lista) = aplica isso.
- **Ordenar** (por lista; lembra a escolha): Importância, Data de vencimento
  (sem data no fim), Ordem alfabética, Data de criação; a faixa "Ordenado
  por…" inverte a ordem (↑/↓) e o X volta à ordem manual. Com ordenação
  ativa ou pesquisando, arrastar entre tarefas fica desligado.
- Banco: `todo_group` e `todo_list.group_id` (migração 0029); RPC
  `todo.groupCreate/groupRename/groupDelete`, `todo.arrange`,
  `todo.taskReorder`; `todo.lists` devolve também `groups`.
