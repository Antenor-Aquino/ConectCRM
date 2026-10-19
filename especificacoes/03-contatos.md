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
| NOTAS | Notas | Área de texto em destaque amarelo — "Escreva algo sobre esse contato..." Links clicáveis; imagens coladas ou arrastadas (ver abaixo) |
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
- Detalhe: dados, organizações, negócios/tickets, atividades, notas, conversas
  do WhatsApp e histórico de alterações.
- Mesclar contatos duplicados.

## 3.1 Telefone, e-mail e site clicáveis

- **Telefone** (no cartão do quadro, no detalhe do contato e da organização):
  o clique abre a conversa no **WhatsApp Web** (`web.whatsapp.com/send?phone=`),
  reaproveitando a aba do WhatsApp já aberta. Número sem DDI ganha o 55.
- **E-mail**: o clique abre o provedor cadastrado em **Configurações →
  E-mail** (por usuário, neste computador):
  - Gmail, Outlook (Microsoft 365), Outlook.com/Hotmail e Yahoo abrem a nova
    mensagem já com o destinatário;
  - Aplicativo de e-mail do computador (mailto:);
  - **Outro**: o link de abertura informado (ex.: Zoho). Com `{email}` no
    link, ele vira o destinatário; sem, o link abre e o endereço é copiado
    ("E-mail copiado — cole no destinatário").
  - Com mais de um provedor, o clique mostra a lista para escolher; sem
    nenhum, oferece o aplicativo do computador e indica a configuração.
- **Organização** no cartão: com **site** cadastrado, o nome abre o site numa
  nova aba (sem "https://", ele é acrescentado); sem site, é texto comum.
- No formulário de contato e de organização, os campos de telefone e e-mail
  têm um botão (WhatsApp verde / envelope) com o mesmo comportamento; clicar
  no campo continua editando.
- O clique no telefone/e-mail/organização não abre o cartão.

## 4. Decisões e pendências

- C1: **sem sincronização com o Google** (decisão do cliente); o toggle do sistema de referência não entra.
- C2: responsável e tags entram em "Mais detalhes".
- C3: um e-mail e um celular por contato na v1 (mais canais depois).

## Notas: links e imagens (0.2.44)

Vale para as notas de cartões, contatos, organizações e atividades.

- Links (http/https, www., e-mail) ficam clicáveis e abrem em outra aba.
- **Imagem colada (Ctrl+V) ou arrastada** para o campo da nota:
  - aparece como miniatura abaixo do campo e um marcador "[imagem 1]" no
    texto, no lugar onde foi colada (pode mover o marcador ou remover a
    imagem no "x");
  - ao salvar, vira documento no GED: nome "Imagem da nota - dd/mm/aaaa hh:mm",
    tipo "Foto/imagem" (ou o primeiro tipo ativo), vinculado ao registro da
    nota com os vínculos automáticos de sempre (ex.: cartão → contato e
    organização); a mesma imagem já existente no GED só ganha o vínculo;
  - na nota, a imagem aparece no lugar do marcador (até 25 MB por imagem);
    clicar abre o documento no GED (prévia, versões, auditoria, editar
    classificação);
  - mostrar a imagem na nota não conta como visualização na auditoria do GED;
  - imagem excluída ou na lixeira: a nota mostra "[imagem excluída ou na
    lixeira]".
- No histórico, na busca e no copiloto o marcador aparece como "[imagem]".
