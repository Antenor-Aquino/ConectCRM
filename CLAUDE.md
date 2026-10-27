# ConectCRM — instruções para quem mexe no código

## Fluxo de trabalho com o GitHub (regra permanente)

Vale para toda sessão, local (Claude Desktop) ou na nuvem, e para os dois
repositórios: `Antenor-Aquino/gestao-financeira-extensao` e
`Antenor-Aquino/ConectCRM`. O GitHub é a fonte única: cada sessão tem a sua
própria cópia do código e só enxerga o trabalho das outras pelo `main`.

**Antes de começar qualquer tarefa:**
1. Nos dois repositórios, rode `git status`. Se houver alteração não salva
   (arquivo modificado ou novo, ou commit ainda não enviado), **avise e pare**,
   sem trocar de branch nem descartar nada.
2. Rode `git checkout main` e `git pull origin main` nos dois.
   Se o outro repositório não estiver disponível na sessão, diga isso em vez de
   pular calado.
3. Informe em que commit e versão cada um ficou (versão da extensão em
   `extension/public/manifest.json`; na Gestão Financeira, também a do app de
   celular em `pwa/package.json`).
4. Crie um branch novo a partir do `main` para a mudança pedida.

**Ao terminar a tarefa:** faça commit, envie o branch ao GitHub e abra o PR
para o `main`. O merge só acontece quando o dono do projeto pedir.

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
