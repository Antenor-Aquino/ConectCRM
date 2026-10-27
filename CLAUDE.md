# ConectCRM — instruções para quem mexe no código

## Paridade de cadastros com a Gestão Financeira (regra permanente)

Contatos (pessoa física) e organizações (pessoa jurídica) do ConectCRM têm
paridade com "Clientes e fornecedores" da extensão Gestão Financeira
(repositório `Antenor-Aquino/gestao-financeira-extensao`). **Toda alteração de
código nesses cadastros precisa ser aplicada também na Gestão Financeira, na
mesma entrega.** Isso vale para: colunas novas/alteradas em `person` ou
`organization`, novos vínculos (tags, campos personalizados, organização do
contato), validações (CPF/CNPJ, e-mail, telefone) e regras de formatação.

Como fazer:
1. `extension/src/db/contactCard.ts`: decida para onde vai cada coluna nova em
   `PERSON_COLUMNS` / `ORGANIZATION_COLUMNS` (campo da ficha ou
   `"não vai: motivo"`) e monte o campo em `personCard` / `organizationCard`.
2. Campo novo na ficha: altere `ContactCard` e `CONTACT_CARD_FIELDS` em
   `extension/src/lib/finance/protocol.ts` e **copie o arquivo idêntico** para
   `extension/src/lib/integration/protocol.ts` da Gestão Financeira (suba
   `CONTACT_CARD_VERSION`).
3. Na Gestão Financeira: migration nova em `counterparty`, campo em
   `COUNTERPARTY_TEXT_FIELDS` (ou equivalente), `CARD_TO_COUNTERPARTY` e
   `cardToInput` (`extension/src/db/integration.ts`) e o formulário de Clientes e
   fornecedores (`CounterpartiesPanel.tsx`).
4. Rode os testes de paridade dos dois lados: aqui
   `extension/tests/paridadeContatos.test.ts`; lá `tests/contact-parity.test.ts`.
   Coluna sem decisão ou campo da ficha sem lugar fazem os testes (e o `tsc`
   da Gestão Financeira) falharem.
5. Suba a versão das duas extensões e entregue as duas juntas.

Regras da integração: o CRM manda nos dados de cadastro dos registros
vinculados (`crm_ref`); as observações da Gestão Financeira são só de lá. Só
vão para lá os contatos usados em lançamentos ou enviados pelo botão "Enviar
para a Gestão Financeira"; fotos/logos não vão. Detalhes em
`especificacoes/13-gestao-financeira.md`.
