# Especificação 05 — Popup do WhatsApp

> Status: **implementado na Fase 9**. Referência: popup do wa-pipedrive v1.46
> (`referencia/wa-pipedrive/popup.html`), agora gravando no CRM local.

O popup abre pelo ícone da extensão em qualquer aba. Usa a mesma licença, o
mesmo usuário atual e o mesmo PIN do CRM; no ambiente de Teste mostra o selo
"Teste". As permissões são as do usuário (vendedor só vê e grava nos seus
cartões).

**Abrir o CRM em tela cheia:** botão **"Abrir CRM"** (ícone ⤢) no topo, com a
dica "Abrir o CRM em tela cheia (aba do navegador)"; atalho **Ctrl+Enter**
(⌘+Enter no Mac). O nome do usuário fica na dica do avatar. Se o CRM já
estiver aberto em alguma aba, ela é ativada em vez de abrir outra.

## 1. Conversa no WhatsApp

- Com o WhatsApp Web na aba ativa, o popup lê o **nome** e o **telefone** da
  conversa aberta (mesma lógica do `content.js` do wa-pipedrive).
- Telefone casado com o cadastro por **DDD + últimos 8 dígitos** (o WhatsApp às
  vezes traz o celular sem o 9º dígito).
- Contato encontrado: lista os negócios, tickets e projetos dele; um clique
  escolhe o **destino**. "+ Novo" abre o formulário de cartão já com o contato.
- Contato não cadastrado: botão **Cadastrar contato** (nome e telefone). Se
  houver contato com **nome parecido** (> 70%, spec 03), mostra "Possível
  duplicidade" com **É este**: grava o telefone da conversa no contato
  existente (pergunta antes de trocar um telefone já gravado).
- Telefone invisível (chats novos do WhatsApp): aviso para abrir "Dados do
  contato" e clicar em ↻.

## 2. Negócio de destino

- Busca por título ou nome do contato (negócio, ticket ou etapa de projeto).
- Resumo: título, funil › etapa, contato, organização, responsável, valor e
  atividades em aberto (concluir com um clique). Botão **"Abrir no CRM"** abre o
  cartão no funil dele, na aba do CRM já aberta (ou numa nova); ✕ troca o
  destino.
- Ações: **Novo** (formulário completo do CRM, origem "WhatsApp"),
  **Tarefa**, **Reunião** (formulário de atividade já como reunião, com Google
  Agenda/Outlook, horários livres e convidados) e **Nota**.
- O destino fica lembrado entre aberturas do popup.
- Novo cartão parecido com um existente (título ou mesmo contato com cartão
  em aberto, spec 01 §5.2): **Usar este** troca o destino para o existente.

## 3. Recortes de tela

- **Novo recorte**: captura a aba e mostra um seletor (arraste; ESC cancela).
  O popup fecha ao clicar na página; os recortes ficam guardados até serem
  enviados (até 40). Em páginas onde o Chrome não deixa extensões
  desenharem o seletor (Nova guia, páginas internas, loja de extensões), a
  tela visível inteira é guardada como recorte, com aviso.
- **Resumir com IA**: **Transcrição** (instrução 2, padrão, primeira opção) ou
  **Análise comercial** (instrução 1, texto padrão do wa-pipedrive). O texto
  pode ser editado.
- **Anexar ao cartão**: cada recorte vira documento do GED (PNG); o resumo
  vira nota com referência aos recortes ("Arquivo: …", abre a prévia).

## 4. Anexar arquivos

- Arquivos do computador (documentos e mídias baixados do WhatsApp), até
  25 MB cada.
- Áudios: **Transcrever áudio** (Gemini ou OpenAI/Whisper); a transcrição vira
  nota "Transcrição de áudio" e o áudio é anexado. A nota mostra o áudio
  transcrito ("Arquivo: …"); clicar abre a prévia/download pela própria nota.
  Se o documento for para a lixeira, some da nota.

## 5. Inteligência artificial

Configurações → **Inteligência artificial**: provedor (Gemini, OpenAI, Claude,
DeepSeek), chave, modelo (opcional; **Testar conexão** também carrega a lista
de modelos liberados para a chave como sugestões do campo), instruções 1 e 2
da IA e **Testar conexão**. Modelo inexistente: a mensagem lista os modelos
disponíveis. OpenAI usa `max_completion_tokens` (exigido pelos modelos novos,
como GPT‑5). A
chave fica só neste computador; as chamadas saem direto do navegador para o
provedor.

## 6. Anexos do cartão

Nova aba **Anexos** no detalhe do cartão: enviar, baixar e excluir arquivos,
com miniatura das imagens. Segue a permissão do cartão.

## 7. Fora desta fase

- Captura automática do texto da conversa: está desligada no wa-pipedrive
  atual (o WhatsApp muda a página com frequência); o caminho hoje são os
  recortes de tela com IA.
- Copiloto de IA dentro do CRM, ZapSign e Asaas: Fase 11.

## Número do contato da conversa (0.2.83)

O popup lê o número da conversa aberta no WhatsApp Web (`lib/whatsapp.ts`,
`readOpenChat`), nesta ordem de confiança:

1. **Painel "Dados do contato"** aberto à direita: o número atual. Procurado a
   partir do título do painel; nunca na lista de conversas (`#pane-side`), que
   mostra números de outros contatos.
2. **Cabeçalho** da conversa (contato sem nome salvo mostra o número).
3. **Código das mensagens** (`true_5511…@c.us_ID`): só a parte da conversa (o
   início), nunca o remetente/citação do fim; vale a mensagem mais recente.
   Conversas novas usam `@lid` (sem número), então pode sobrar só o número de
   mensagens antigas — por isso é a fonte menos confiável.

- Fontes com números diferentes: o popup mostra **"Esta conversa mostra
  números diferentes. Qual é o do contato?"** com cada número e de onde veio;
  o escolhido é o usado para achar, cadastrar ou atualizar o contato.
- Só o código das mensagens: aviso para conferir em "Dados do contato" (↻).
- **Cadastrar contato** abre nome e celular editáveis ("confira antes de
  salvar"), já com o número mais confiável.
