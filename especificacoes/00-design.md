# Especificação 00 — Padrão visual

> Regra: o ConectCRM usa **o mesmo padrão de design da
> `gestao-financeira-extensao`**, inclusive as mesmas fontes. Os mockups de
> CRM enviados definem **estrutura e campos**; cores, tipografia, espaçamento
> e componentes seguem a gestão financeira.

## 1. Fonte única do design

O pacote `shared/tailadmin` da gestão financeira será copiado para o
ConectCRM sem alterações de estilo:
- `src/index.css` — tema Tailwind 4 (`@theme`), paleta e utilitários.
- `src/tokens.ts` — cores, raios, sombras, z-index, paleta de badges
  (para uso fora de classes, ex.: gráficos).
- Componentes: `Button`, `Card`, `Input`, `Badge`, `Modal`, `AppLayout`,
  `TopNavBar`, contextos de tema e sidebar.
- `build-static-css.mjs` (CSS estático gerado no build).

## 2. Tipografia

- **Inter Variable** (`@fontsource-variable/inter`), empacotada na extensão
  (sem Google Fonts/CDN). Fallback: `Inter, system-ui, sans-serif`.
- Mesma escala de tamanhos e pesos da gestão financeira.

## 3. Cores

| Uso | Valor |
|---|---|
| Primária (brand-500) | `#465FFF` (hover `#3641F5`, ativo `#2A31D8`) |
| Fundo da página | `#F9FAFB` · fundo sutil `#F3F4F6` |
| Card | `#FFFFFF`, borda `#E4E7EC` |
| Texto | principal `#1D2939` · secundário `#667085` · apagado `#98A2B3` |
| Sucesso / Erro | `#16A34A` / `#DC2626` (fundos `#F0FDF4` / `#FEF2F2`) |
| Badges | azul, roxo, verde, âmbar, vermelho, ciano, cinza (`badgePalette`) — também usadas como cores de **etapas** e **tags** |

Raios 8/12/16 px, sombras `xs`→`lg`, transição 200 ms. Tema claro/escuro
como na gestão financeira.

## 4. Padrões de tela reaproveitados

| Gestão financeira | Uso no ConectCRM |
|---|---|
| Barra superior com logo + nome do sistema e subtítulo da tela ("Gestão Financeira / Lançamentos") | "**ConectCRM** / *tela atual*" |
| Itens de menu com ícone e item ativo em destaque | Funis · Tarefas · Contatos · Organizações · Relatórios · Configurações, + botão "+" |
| Guia, Ajuda, chave **Produção / Teste**, sino com contador, Sair | Iguais |
| Barra de período (‹ Outubro ›, Hoje, 7 dias atrás, Esse mês, Esse ano, intervalo de datas, Limpar filtro, Filtros avançados) | Filtros de Tarefas e Relatórios |
| Cards de KPI com borda lateral colorida e detalhamento | Topo de Relatórios e indicadores do funil |
| Cards de alerta clicáveis que filtram a lista | Tarefas atrasadas, vencendo, negócios parados |
| Abas segmentadas (Todas / Receitas / Despesas) + botões de ação coloridos | Ex.: Abertos / Ganhos / Perdidos |
| Barra de busca com filtro de responsável e botões de status | Listas de contatos, organizações e tarefas |
| Tabela com ordenação, agrupamento com total (ex.: "Antenor · 10 lançamentos · R$ 9.950,00"), badges de status, ações por linha, paginação, **Exportar Excel**, configuração de colunas | Listas de contatos, organizações, negócios e tarefas |
| Modais, drawer de filtros, central de notificações, tela de PIN | Iguais |

## 5. Mockups de CRM × padrão financeiro

- Layout dos mockups mantido: lista de funis à esquerda, quadro Kanban com
  colunas, modais de cadastro com seções em caixa-alta cinza, botões
  "Criar e abrir" / "Criar" / "Salvar".
- Aparência aplicada a eles: cores, fonte, botões, inputs, badges, raios e
  sombras da gestão financeira (ex.: botão primário `#465FFF`, não o azul
  dos mockups).
