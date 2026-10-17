# Especificação 03 — Contatos

> Status: **em detalhamento**. Tela de referência: modal "Criar contato".

## 1. Modal "Criar contato"

Modal com rolagem interna, botão ✕ no topo, **Salvar** fixo no rodapé.

| Seção | Campo | Regra |
|---|---|---|
| — | **Foto** | Círculo com ícone padrão + link **"Adicionar foto"** (imagem recortada em círculo, guardada no banco). Sem foto: avatar com iniciais nas listas e cartões |
| — | **Nome** | Obrigatório. Placeholder "Nome do contato" |
| CANAIS | **E-mail** | Validação de formato. Placeholder "nome@empresa.com.br" |
| | **Celular** | Seletor de país com bandeira (padrão 🇧🇷 **+55**), máscara do país; gravado normalizado (`+5511999998888`) para casar com o WhatsApp |
| ORGANIZAÇÕES | **Vincular organização** | Área tracejada "Vincule a empresa em que esse contato trabalha"; busca ou cria organização; permite **mais de uma**; a primeira vinculada vira a **principal** (ver spec 04) |
| NOTAS | Notas | Área de texto em destaque amarelo — "Escreva algo sobre esse contato..." |
| | **Contato privado** (?) | Visível apenas para o responsável/criador (e administradores) |
| MAIS DETALHES | Responsável, Tags | Responsável com tipo ("Antenor (vendedor)"); tags da entidade **Contato** |
| CAMPOS PERSONALIZADOS (n) | Campos da entidade **Contato** | Grade de **duas colunas**; o título mostra a quantidade. Ex.: Empresa, Cargo, Valor Power, Site/Instagram, Origem do Lead, Turma aluno, Filho(a) 1, Filho(a) 2 |

## 2. Regras

- **Anti-duplicação:** ao digitar e-mail ou celular já cadastrados, avisa e
  oferece abrir o contato existente (lógica do autocomplete do wa-pipedrive).
- **Nome parecido (anti-duplicidade):** ao criar, compara o nome digitado
  com os contatos visíveis para o usuário (sem acento e maiúsculas, ignora
  "da/de/do"): **mais de 70%** de semelhança com alguma parte do nome já
  cadastrado (ex.: "Anten" × "Antenor Aquino" = 71%; erros de digitação e
  ordem trocada também contam). O aviso aparece enquanto digita, com
  organização, e-mail e celular para distinguir homônimos, e os botões
  **Abrir existente** e **Não é o mesmo, continuar**. Se salvar sem
  confirmar, o formulário segura o "Salvar" e pergunta: abrir o existente ou
  **Criar mesmo assim**. A criação rápida pelo campo de busca (formulários
  de negócio/organização) pergunta se é para usar o cadastro existente.
- **Popup do WhatsApp:** telefone da conversa não cadastrado, mas com contato
  de nome parecido → "Possível duplicidade" com o botão **É este** (grava o
  telefone da conversa no contato existente).
- Contato pode ser criado pelo "+", pela lista de Contatos, pela busca de
  contato nos formulários de negócio/ticket e pelo popup do WhatsApp (já com
  nome e celular da conversa).
- Responsável do contato: padrão o usuário atual.

## 3. Lista e detalhe (menu Contatos)

- Lista com busca, filtros (tags, responsável, organização, campos
  personalizados), colunas configuráveis, exportar/importar Excel/CSV.
- Detalhe: dados, organizações, negócios/tickets, tarefas, notas, conversas
  do WhatsApp e histórico de alterações.
- Mesclar contatos duplicados.

## 4. Decisões e pendências

- C1: **sem sincronização com o Google** (decisão do cliente); o toggle do sistema de referência não entra.
- C2: responsável e tags entram em "Mais detalhes".
- C3: um e-mail e um celular por contato na v1 (mais canais depois).
