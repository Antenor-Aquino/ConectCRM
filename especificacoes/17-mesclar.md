# 17 — Mesclar negócios, contatos e organizações (0.2.94)

Junta dois registros duplicados em um só. Um registro **fica** (o principal) e
o outro **sai**. Tudo o que estava ligado ao que sai vem para o que fica.

## Onde

- **Cartões (negócio, ticket, etapa de projeto):** selecione 2 cartões no
  quadro → **Mesclar** na barra de seleção; ou, no detalhe do cartão,
  **Mesclar** → buscar o outro (só cartões do mesmo tipo).
- **Contatos e organizações:** na ficha, **Mesclar duplicado** → buscar o outro.

## Janela de mesclagem

- Os dois registros lado a lado; no topo, **qual fica** (clique para trocar).
- Para cada campo, clique no valor que deve ficar. Padrão: o do principal;
  campo vazio no principal é completado com o do outro. Observações e
  descrição têm também **"Os dois juntos"** (um embaixo do outro). Campos
  personalizados entram na mesma lista.
- Embaixo, o que vem junto (quantidades) e o aviso de que o registro que sai
  deixa de existir (não vai para a lixeira — voltaria vazio). Confirma antes.
- No principal fica uma nota "Mesclado com …".

## O que vem junto (sempre)

- **Cartão:** atividades, notas, documentos do GED, produtos (o valor vira a
  soma quando o cartão é "pela soma dos produtos"), outros contatos (o contato
  principal do que sai vira "outro contato"), histórico de etapas, etiquetas,
  campos personalizados, tarefas do To Do, conversas do WhatsApp, envios de
  documento, vínculos de importação (Pipedrive) e origem (Copiloto).
- **Contato:** cartões (como principal ou outro contato), organizações,
  atividades e lembretes do contato por WhatsApp, notas, documentos,
  etiquetas, campos, tarefas do To Do, conversas e envios, vínculos de
  importação.
- **Organização:** contatos (a que sai, se era a principal de um contato,
  passa a ser a que fica), cartões, atividades, notas, documentos,
  etiquetas, campos, envios, vínculos de importação.
- Repetidos não duplicam (mesma etiqueta, mesmo documento, mesmo contato no
  cartão, mesma organização).

## Gestão Financeira

Os lançamentos de lá apontam para o cartão e para o contato/organização pelo
id. Por isso **o registro ligado à Gestão Financeira é sempre o que fica**
(cartão com lançamentos/pedidos; contato/organização já enviado para lá) — a
janela já o deixa como principal e não deixa trocar. **Se os dois estiverem
ligados, a mesclagem é recusada** com a explicação. Depois de mesclar, o
cadastro que ficou vai de novo para a Gestão Financeira (ficha atualizada).
Nada muda na Gestão Financeira.

## Código

`db/mergeRecords.ts` (`mergePreview`, `defaultChoices`, `mergeRecords`);
`db/merge.ts` (atalhos antigos `mergePersons`/`mergeOrganizations`, agora com
o mesmo motor); RPC `merge.preview`, `merge.defaults`, `merge.run` (quem mescla
precisa enxergar os dois); tela `dashboard/ui/MergeDialog.tsx`. Testes:
`tests/mesclar.test.ts` e `tests/fase5.test.ts`.
