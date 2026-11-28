# 26 — Status "Pendente" do cartão (0.2.160)

## Objetivo
Um terceiro status, além de aberto e do desfecho (ganho/perdido, resolvido/não
resolvido, concluído/não concluído): **Pendente**, em amarelo. É o cartão que
já tem um resultado de fora (por exemplo, o portal Caixa Escolar aprovou,
recusou ou cancelou a proposta) e espera a avaliação do usuário para o
desfecho final. Vale para os três tipos de funil: comercial, operacional e
projeto, com o mesmo nome em todos.

## Banco
- `deal.status` aceita `pending` (`open | pending | won | lost`). A migração
  `0049_cartao_pendente.sql` refaz a tabela `deal` (o SQLite não altera CHECK),
  com as mesmas colunas e índices, como a 0004 fez com `tag`.
- Pendente **não é fechado**: `closed_at` fica vazio, sem motivo de perda.

## Telas
- **Quadro**: cartão amarelo com o canto dobrado (ampulheta) e a etiqueta
  "Pendente". O filtro **Abertos** mostra os abertos e os pendentes (seguem no
  quadro até a decisão); filtro novo **Pendentes**. Ordenação por status:
  abertos, pendentes, ganhos, perdidos.
- **Lista** e fichas de contato/organização, popup: etiqueta amarela.
- **Ficha do cartão**: botão **Pendente** ao lado de Ganho/Perdido; no
  pendente, faixa amarela "aguardando a sua avaliação" e os botões Ganho,
  Perdido e Reabrir.
- **Ações em lote**: botão **Pendente**; Ganho/Perdido valem também para os
  pendentes; Reabrir volta para aberto.
- **Histórico**: "Marcou como pendente". Importação de planilha: a coluna de
  status aceita "pendente". Copiloto: busca por `pending`.

## Relatórios
Pendente conta como **aberto** (previsão, abertos por responsável, tempo na
etapa) e nunca como ganho/perdido nem na taxa de conversão.

## Radar Caixa Escolar MG (spec 25)
Enviada (desde a 0.2.164), aprovada, recusada ou cancelada no portal → cartão
**Pendente** (antes: Ganho ou Perdido). A etapa "ao aprovar" continua valendo; o resultado vai na nota
"Resultado no portal".

## Testes
`extension/tests/cartaoPendente.test.ts` (migração, os três tipos de funil,
quadro, histórico e relatórios) e `extension/tests/radar.test.ts`.
