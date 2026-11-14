# 21 — Cobrança pelo cartão (checkout integrado da InfinitePay)

## Objetivo
Botão **Cobrança** no cartão (ao lado de "Nota fiscal") que gera o link de
pagamento no checkout integrado da InfinitePay com o valor dos serviços do
cartão e já lança a **receita** correspondente na Gestão Financeira.

## API usada (documentação: infinitepay.io/checkout-documentacao)
- `POST https://api.checkout.infinitepay.io/links` com `handle` (InfiniteTag
  sem "$"; conta `claudiatech`), `items[{description, quantity, price}]` (preço
  em **centavos**), `order_nsu` e `customer {name, email, phone_number}`.
  Sem API Key (a chave só é exigida para opções do link, como validade).
- Mínimo de R$ 1,00. Não há sandbox: cada link é real (só vira venda se pago).
- O link não expira nem pode ser cancelado pela API; estorno só pelo app.
- Confirmação de pagamento: webhook (precisa de servidor público) ou
  `POST /payment_check` (precisa de `transaction_nsu` e `slug`, que só chegam
  pelo webhook ou pela `redirect_url`). **A extensão não tem servidor**, então
  nesta versão a baixa é manual ("Marcar como paga" no CRM e a baixa da receita
  na GF). Automatizar exige um pequeno serviço na internet que receba o
  webhook (fase futura).
- O campo do link na resposta não é fixado na documentação: o CRM aceita
  `url`, `checkout_url`, `link`, `payment_url` ou qualquer URL https.

## Fluxo
1. Janela "Cobrança": itens vindos dos produtos/serviços do cartão
   (quantidade inteira mantém o preço unitário; fracionada ou com desconto vira
   1 × total da linha; sem itens, o valor do cartão), editáveis; comprador =
   contato principal (ou organização) com celular no formato +55; vencimento
   da receita; conta InfinitePay (padrão `claudiatech`, guardada no
   computador).
2. "Gerar cobrança": pede a permissão do site da API no 1º uso (no clique),
   cria o link, grava em `payment_charge` (migration 0040) e deixa nota no
   cartão com valor, vencimento, link e pedido (`order_nsu` =
   `crm-<cartão>-<aammddhhmmss>`).
3. Em seguida abre a **receita na Gestão Financeira** pela aba Financeiro do
   cartão (mesma integração da Fase 2): descrição "Cobrança InfinitePay —
   <título>", valor, vencimento, cliente e observações com link, pedido e
   itens. No modo pacote, vira um pedido de receita com os mesmos dados.
   O usuário confere categoria/conta e salva.
4. Lista de cobranças do cartão: copiar link, "Marcar como paga", "Cancelar",
   "Reabrir".

## Cancelar e reabrir (0.2.119 / GF 0.0.49)
- A receita lançada pela cobrança leva o pedido (`LaunchRequest.requestId` =
  `order_nsu`), gravado na GF em `origin_request`.
- **Cancelar**: o CRM pede à GF (`removeLaunch`) para excluir as receitas
  ainda não recebidas daquele pedido — achadas por `origin_request` ou por
  "Pedido: <order_nsu>" nas observações (receitas lançadas antes desta versão).
  Receita já recebida não é excluída (o CRM avisa). O link continua ativo na
  InfinitePay (a API não permite desativar); pagamento depois disso se estorna
  pelo app.
- **Reabrir** uma cobrança cancelada: se a receita não existe mais na GF
  (`removeLaunch` com `dryRun`), abre a receita de novo, já preenchida; se
  ainda existe, não duplica.
- Sem a GF no mesmo Chrome (modo pacote), o CRM avisa para excluir lá.

## Protocolo CRM ↔ GF
`LaunchRequest.dueDate` (opcional, aaaa-mm-dd), `LaunchRequest.requestId` e a
mensagem `removeLaunch {ref, requestId, dryRun?}` → `{removed, pending, paid}`
— arquivo `protocol.ts` idêntico nos dois repositórios.
