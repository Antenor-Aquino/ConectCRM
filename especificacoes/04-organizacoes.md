# Especificação 04 — Organizações

> Status: **em detalhamento**. Tela de referência: modal "Nova organização".

## 1. Modal "Nova organização"

Modal com rolagem interna, botão ✕ no topo, **Salvar** fixo no rodapé.

| Seção | Campo | Regra |
|---|---|---|
| — | **Logo** | Quadrado arredondado com ícone de prédio + link **"Adicionar logo"**. Sem logo: ícone/iniciais nas listas |
| — | **Nome da organização** | Obrigatório. Placeholder "Nome fantasia" |
| EMPRESA | **CNPJ** | Máscara `00.000.000/0000-00`, validação dos dígitos. Ao completar um CNPJ válido, **consulta automática** (BrasilAPI → minhareceita → ReceitaWS, lógica do wa-pipedrive) e preenche nome fantasia, razão social, segmento (CNAE), telefone, e-mail e endereço — sem sobrescrever o que o usuário já digitou. Avisa se o CNPJ já está cadastrado |
| | **Site** | Placeholder "empresa.com.br" |
| | **Razão social** | |
| | **Segmento** | Texto com sugestões dos segmentos já usados (evita "Educação" / "educacao") |
| | **Responsável** | Usuários e vendedores com o tipo: "Antenor (vendedor)". Padrão: usuário atual |
| CONTATO | **Telefone** | Seletor de país com bandeira, padrão 🇧🇷 **+55** |
| | **E-mail** | Placeholder "contato@empresa.com.br" |
| ENDEREÇO | CEP, Logradouro, Número, Complemento, Bairro, Cidade, Estado, País | **CEP** com máscara; ao completar, busca o endereço (BrasilAPI CEP) e preenche logradouro, bairro, cidade e estado. País padrão: Brasil |
| DESCRIÇÃO | Descrição | "Contexto e informações relevantes sobre a empresa" |
| MAIS DETALHES | Tags, Campos personalizados | Tags da entidade **Organização** e campos personalizados (o responsável já fica na seção Empresa) |
| CONTATOS | **Buscar contato para vincular** | Busca e vincula um ou mais contatos. Dica: *"Se for a primeira organização do contato, o vínculo vira o principal."* |

## 2. Regras

- **Organização principal do contato:** um contato pode ter várias
  organizações; a primeira vinculada vira a **principal** (pode ser trocada
  no contato). A principal é a sugerida ao criar negócio/ticket para esse
  contato. Dado: `person_organizations.is_primary`.
- Pode ser criada pelo "+", pela lista de Organizações, pelo botão
  "Vincular ou criar organização" dos formulários de negócio/ticket/contato
  e pela consulta de CNPJ (fluxo "novo negócio a partir de CNPJ" do
  wa-pipedrive).
- Anti-duplicação por CNPJ e por nome semelhante: ao criar, nome fantasia
  ou razão social com **mais de 70%** de semelhança em alguma parte
  (ex.: "Power Cubos" × "PowerCubus"; sufixos como Ltda/ME/S/A não contam).
  Mesmo aviso do contato (spec 03): **Abrir existente** ou **Criar mesmo
  assim**, com razão social, CNPJ e cidade para distinguir.

## 3. Lista e detalhe (menu Organizações)

- Lista com busca, filtros (segmento, cidade/estado, responsável, tags,
  campos personalizados), colunas configuráveis, importar/exportar
  Excel/CSV.
- Detalhe: dados da Receita, contatos, negócios/tickets, atividades, notas e
  histórico de alterações.
- Mesclar organizações duplicadas.

## 4. Decisões

- O1: tags e campos personalizados em "Mais detalhes".
