# 23 — Várias organizações no cartão

Casos: a escola compra e o **Caixa Escolar paga**; a escola tem uma **mantenedora**;
numa **rede**, uma mantenedora com várias escolas, ou várias escolas num cartão só.

## Modelo
- `deal.organization_id` continua sendo a **principal** (quadro, listas, filtros).
- `deal_org_link` (migration 0044): outras organizações com papel
  `pagador` | `mantenedora` | `cliente` (unidade/escola) | `outra`.
  (O nome `deal_organization` já era de um índice do 0000_init.)
- Um **pagador** por cartão: marcar outro faz o anterior virar "Outra".
- Sem principal, a 1ª unidade/outra vinculada vira principal; pagador e
  mantenedora ficam com o papel.

## Quem paga
`payerOrganizationId`: o pagador; sem ele, a principal. Usado por:
- **Cobrança** (pagador do boleto do Inter; cliente da InfinitePay continua o contato);
- **NFS-e** (tomador);
- **Gestão Financeira** (`cardCounterparty`: cliente da receita).

## Onde aparece
- Cartão: "Outras organizações" (papel, tornar principal, desvincular; o papel
  do próximo vínculo vem sugerido: Pagador, ou Mantenedora se já houver pagador).
- Ficha da organização → Negócios: cartões em que ela é principal **ou vinculada**,
  com o papel; financeiro do cliente também conta os vinculados.
- Busca do quadro e busca de cartões acham pelo nome das vinculadas.
- Histórico do cartão, clonar (vínculos vão junto), mesclar cartões e
  organizações, lixeira (vínculo sai com o cartão/organização), envio por WhatsApp
  (telefone das vinculadas como destinatário).
