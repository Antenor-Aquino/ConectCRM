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
  tarefas em aberto (concluir com um clique). Botão **"Abrir no CRM"** abre o
  cartão no funil dele, na aba do CRM já aberta (ou numa nova); ✕ troca o
  destino.
- Ações: **Novo** (formulário completo do CRM, origem "WhatsApp"),
  **Tarefa**, **Reunião** (formulário de tarefa já como reunião, com Google
  Agenda/Outlook, horários livres e convidados) e **Nota**.
- O destino fica lembrado entre aberturas do popup.
- Novo cartão parecido com um existente (título ou mesmo contato com cartão
  em aberto, spec 01 §5.2): **Usar este** troca o destino para o existente.

## 3. Recortes de tela

- **Novo recorte**: captura a aba e mostra um seletor (arraste; ESC cancela).
  O popup fecha ao clicar na página; os recortes ficam guardados até serem
  enviados (até 40).
- **Resumir com IA**: **Transcrição** (prompt 2, padrão, primeira opção) ou
  **Análise comercial** (prompt 1, texto padrão do wa-pipedrive). O texto
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
DeepSeek), chave, modelo (opcional), prompts 1 e 2 e **Testar conexão**. A
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
