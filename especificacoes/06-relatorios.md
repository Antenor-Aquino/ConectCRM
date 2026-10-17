# Especificação 06 — Relatórios

> Status: **implementado na Fase 10**.

## 1. Filtros (uma linha, valem para a tela inteira)

- **Período**: este mês, mês passado, últimos 3 meses, este ano, últimos 12
  meses ou personalizado (de/até). Sempre no fuso local.
- **Funil**: todos os funis comerciais (padrão) ou um funil específico, de
  qualquer tipo. Conversão e tempo por etapa pedem um funil escolhido.
- **Responsável** (administrador e gestor): todos, uma equipe ou um usuário.
  O vendedor vê só os próprios números, sem esse filtro.
- **Exportar Excel**: um .xlsx com uma aba por relatório.

Permissões: as mesmas do quadro (administrador vê tudo; gestor, a equipe;
vendedor, os seus; cartões sem responsável contam para todos).

### 1.1 Funil operacional ou de projeto

Com um funil operacional ou de projeto escolhido, o relatório usa os termos
do tipo (Resolvidos/Não resolvidos, Concluídos/Não concluídos; taxa de
resolução/conclusão; tempo médio até a resolução/conclusão; última etapa da
conversão "Resolvido"/"Concluído") e mostra **quantidades** em vez de R$.
Ficam de fora o que só faz sentido em vendas: ticket médio, previsão
ponderada, previsão por etapa e produtos vendidos (também no Excel). Sem
funil escolhido o relatório continua sendo dos funis comerciais, sem mudança.

## 2. Indicadores

| Indicador | Regra |
|---|---|
| Ganhos / Perdidos | Valor e quantidade fechados **no período** (data de fechamento) |
| Taxa de conversão | Ganhos ÷ (ganhos + perdidos) no período |
| Ticket médio | Valor ganho ÷ quantidade ganha |
| Ciclo médio | Dias da criação ao ganho |
| Em aberto | Cartões abertos **hoje** (não depende do período) |
| Previsão ponderada | Σ valor × probabilidade da etapa (Funil → Configurar etapas → Prob. %) |
| Criados no período | Cartões criados no período |
| Tarefas concluídas | Tarefas com data no período; também as atrasadas |

## 3. Relatórios

Cada gráfico tem **Ver tabela** com os mesmos números.

- **Ganhos e perdidos por mês**: valor fechado por mês (todos os meses do
  período aparecem, mesmo vazios).
- **Previsão por etapa**: abertos hoje, valor total × ponderado.
- **Conversão do funil**: dos cartões criados no período, quantos chegaram a
  cada etapa (conta a etapa mais avançada alcançada; ganho conta como tendo
  passado por todas) e o % em relação à etapa anterior.
- **Tempo médio por etapa**: dias das passagens concluídas no período (a
  passagem pela última etapa termina no fechamento); na tabela, também os
  abertos hoje em cada etapa e há quantos dias.
- **Motivos de perda**: quantidade e valor por motivo ("Sem motivo
  informado" quando não preenchido).
- **Produtos e serviços vendidos**: itens dos negócios ganhos no período
  (quantidade, total, negócios); gráfico com os 10 maiores.
- **Desempenho por responsável** e **por equipe** (tabelas): ganhos, valor,
  perdidos, conversão, abertos, valor em aberto, ponderado e tarefas feitas.
  Quem está em duas equipes conta nas duas.
- **Atividades por usuário**: concluídas × pendentes; tabela com atrasadas.

## 4. Visual

Mesmo padrão da gestão financeira (Chart.js, cartões TailAdmin), claro e
escuro. Cores validadas para daltonismo: azul e laranja nas comparações
(ganhos × perdidos, em aberto × ponderado, concluídas × pendentes), uma cor só
nos gráficos de uma série; verde e vermelho só nos indicadores, sempre com
ícone e texto. Ao passar o mouse, o valor exato.

## 5. Ambiente de Teste

Os dados de exemplo trazem 6 meses de histórico (18 negócios ganhos e
perdidos, com etapas percorridas, motivos, itens e tarefas) para os relatórios
já aparecerem completos.
