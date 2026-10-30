# Especificação 15 — Rascunhos e alterações não salvas (0.2.75)

Pedido: o que o usuário começou a digitar (nota, atividade...) não pode se perder
ao navegar dentro do cartão, e sair da tela principal sem salvar deve avisar.
O que foi digitado fica **só em memória** enquanto a tela principal (o cartão) está
aberta; para sair é preciso **salvar no banco ou descartar de propósito**.

## Como funciona
- **Registro** (`lib/drafts.ts`): cada editor avisa quando tem algo não salvo
  (`useDraft(rótulo, sujo, aba)` em `dashboard/ui/unsaved.tsx`). Escopo = id do
  cartão aberto (`DraftScope`) ou "app".
- **Notas** (`NotesPanel`): texto ou imagem colada ainda não salvos = rascunho "Nota
  nova"/"Edição de nota". As abas Notas e Atividades do cartão **ficam montadas**
  (só escondidas) ao trocar de aba: voltar à nota mostra o texto como estava.
- **Atividade** (`TaskModal`): rascunho quando algo mudou desde que o formulário
  assentou (ou qualquer digitação/seleção). **Minimizar** (botão no cabeçalho)
  esconde a janela, mostra o chip "Atividade em edição: … Reabrir" e libera o cartão
  para consulta; o formulário continua montado com tudo preenchido. Clicar em "Nova
  atividade" ou numa atividade com uma minimizada reabre a minimizada (nunca
  sobrescreve). Fechar (X, fora, Esc, Cancelar) com rascunho pergunta antes.
- **Campos personalizados do cartão** editados e sem "Salvar campos personalizados"
  também contam como rascunho.
- **Avisos**: ponto laranja na aba com algo não salvo; fechar o cartão (X, clicar
  fora), abrir outro cartão/funil ou trocar de tela do sistema mostra "Existem itens
  não salvos" (lista o que é) com **Continuar editando** / **Descartar e sair**; fechar
  ou recarregar o navegador mostra o aviso do próprio navegador (`beforeunload`).
- **Alternar painel lateral/tela cheia** não perde nada: o cartão tem a mesma
  estrutura nos dois modos (só muda o CSS) e ocupa o mesmo lugar na árvore.
- **Outras telas** (`GuardedModal`): formulários de cartão novo, contato, organização,
  campo personalizado, produto, funil, usuário, equipe, itens do cartão e "perdido"
  não fecham ao clicar fora/Esc/X com algo digitado: perguntam antes. O botão
  **Cancelar** é uma escolha deliberada e descarta na hora.

## Limites conhecidos
- Rascunho em memória se perde ao recarregar a página (daí o aviso do navegador).
- Em `GuardedModal`, "alterado" = qualquer digitação/seleção na janela (mesmo que
  volte ao valor original).
- Título e descrição do cartão se salvam ao sair do campo; não são rascunho.
