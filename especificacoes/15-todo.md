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
