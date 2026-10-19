# Especificação 08 — GED (Gerenciamento eletrônico de documentos)

> Status: **implementado** (versão 0.2.0). Todo arquivo anexado no CRM é um
> documento do GED, com nome, classificação e vínculos.

## 1. Documento

| Campo | Regra |
|---|---|
| **Nome** | Obrigatório. Sugestão: nome do arquivo sem extensão |
| **Classificação** | Obrigatória ao anexar (tipos em Configurações → Documentos). Anexos antigos ficam "Não classificado" |
| **Data do documento** | Opcional (ex.: emissão) |
| **Validade** | Opcional. O tipo pode sugerir (ex.: comprovante de endereço = 90 dias, a partir da data do documento ou de hoje) |
| **Palavras-chave** | Tags da entidade "Documento" |
| **Descrição** | Opcional |
| **Restrito** | Só quem enviou, administradores e o responsável por um cartão vinculado veem |
| **Vínculos** | Contatos, organizações, cartões (negócio, ticket, projeto) e atividades, quantos forem |

**Tipos padrão:** Comprovante de endereço (90 dias), Documento de
identificação, CPF/CNPJ, Contrato, Proposta, Nota fiscal, Comprovante de
pagamento, Certificado (365 dias), Foto/imagem, Outros. Nome, cor, validade
padrão, ordem e ativo são editáveis; excluir um tipo deixa os documentos dele
"não classificados".

## 2. Vínculos automáticos ("tudo que está na tela")

Na janela **Novo documento** os vínculos já vêm marcados (etiquetas cinza =
automáticos); dá para tirar ou acrescentar (busca de cartão, atividade, contato
ou organização).

| Onde anexa | Vínculos |
|---|---|
| Atividade | atividade + cartão + contato + organização (da atividade ou do cartão) |
| Cartão | cartão + contato + organização |
| Contato | contato + organizações dele |
| Organização | organização |
| Popup do WhatsApp (arquivos e recortes) | cartão escolhido + contato + organização |
| GED | nenhum (o usuário escolhe) |

- Os vínculos ficam como gravados no envio (se a atividade mudar de cartão, o
  documento não muda). Editáveis no documento → Vínculos.
- Atividade nova: os arquivos escolhidos aguardam; ao salvar a atividade abre a
  janela Novo documento já vinculada a ela.
- **Arquivo repetido** (mesmo SHA-256): a janela avisa "já está no GED como
  …" e oferece **vincular o existente** (padrão) ou enviar como novo.

### 2.0 Classificação

O campo Classificação é uma busca: digitar um tipo que não existe oferece
**Criar classificação "…"** e já o seleciona (qualquer usuário cria;
editar e excluir tipos continua com administradores e gestores, em
Configurações → Documentos). Nome igual a um existente (sem acento e
maiúsculas) usa o existente.

### 2.1 Transcrição com IA (opcional, no envio)

Cada arquivo da janela "Novo documento" pergunta **"Transcrever com IA?"**
(desmarcado). O texto vira uma **nota** no cadastro de origem (ou no 1º
vínculo: cartão, atividade, contato, organização) com a referência ao documento
("Arquivo: …"), e também entra na busca do GED. Antes de enviar, a janela
diz o que esperar:

| Arquivo | Como | Avisos |
|---|---|---|
| Áudio | Gemini ou OpenAI (Whisper) | Longo (> 20 min): pode demorar. Gemini: até 14 MB. Claude/DeepSeek: não transcrevem áudio |
| PDF com texto | Copia o texto do próprio arquivo (sem custo de IA), página a página | Extenso (> 50 páginas): só as 50 primeiras |
| PDF escaneado | A IA lê as páginas como imagem (3 por vez) | Complexo: tabelas, carimbos e manuscritos podem sair com erros; extenso (> 10 páginas): só as 10 primeiras. DeepSeek não lê imagens |
| Imagem | A IA lê o texto | Complexo: fotos tortas, tabelas e manuscritos; revisar |
| Word/Excel/PowerPoint | — | Não transcreve: "salve como PDF" |
| Vídeo | — | Não transcreve: "envie só o áudio" |

Sem IA configurada, a opção fica desabilitada com o aviso (exceto PDF com
texto). Se a transcrição falhar (cota, chave, sem texto), o documento é
salvo assim mesmo e a janela lista o motivo antes de fechar.

## 3. Aba "Documentos" (cartão, atividade, contato, organização)

- Lista: ícone, nome, classificação, validade, restrito, arquivo, tamanho,
  versão e "Também em:" (os outros vínculos, clicáveis).
- Ações: **visualizar**, **baixar**, **remover deste cadastro** (só o vínculo;
  continua no GED e nos outros) e **lixeira** (sai de todos os cadastros).
- Anexar: botão ou arrastar arquivos para a aba.
- Histórico do cartão: "Vinculou/Desvinculou o documento X".
- Lista de atividades: chips dos documentos (clique baixa).

## 4. Menu GED

- **Indicadores** (também filtros rápidos): total e espaço, vencem em 30
  dias, vencidos, não classificados, sem vínculo, lixeira.
- **Busca livre**: em qualquer campo — nome, arquivo, descrição, classificação,
  palavras-chave, datas (dd/mm/aaaa), quem enviou, nomes e e-mail/CNPJ dos
  vínculos, funil, e o **texto de dentro dos PDFs**. Sem acento, sem
  maiúsculas, pedaço de palavra e em qualquer ordem ("comp ender regina").
- **Filtros**: classificação, funil, vinculado a (cartão/atividade/contato/
  organização), formato (PDF, imagem, planilha, texto, outros), validade,
  enviado por, período de envio, palavras-chave, só sem vínculo, lixeira.
  Ficam na URL (`#ged?...`).
- **Lista** (colunas, ordenação por envio, nome, classificação, validade,
  tamanho) ou **grade** com miniaturas (imagem ou 1ª página do PDF). 25 por
  página.
- **Ações em lote**: baixar (.zip), reclassificar, vincular a, lixeira; na
  lixeira: restaurar e excluir definitivamente (administrador).
- **Enviar documentos** direto no GED.

## 5. Documento aberto

- **Prévia** antes de baixar: PDF (páginas, zoom), imagem (ajustar/tamanho
  real), texto/CSV. Outros tipos: só baixar.
- **Informações** editáveis; **Vínculos**; **Versões** (enviar nova versão;
  as anteriores ficam; restaurar uma antiga cria nova versão); **Auditoria**
  (enviou, versões, alterações campo a campo, vínculos, palavras-chave,
  visualizou, baixou, lixeira, exclusão — com usuário e data/hora).
- Integridade: SHA-256 de cada versão.

## 6. Permissões

- Administrador vê tudo; quem enviou sempre vê.
- Restrito: + responsável por um cartão vinculado.
- Demais: vê se puder ver algum cadastro vinculado (contato e organização são
  de todos; cartão e atividade seguem a regra do funil/atividades); sem vínculo,
  todos veem.
- Vincular exige acesso ao cadastro. Lixeira, restaurar e marcar restrito:
  quem enviou, gestor ou administrador. Excluir definitivamente: administrador.

## 7. Armazenamento e backup

- O banco guarda só as informações; o conteúdo fica no **navegador**
  (IndexedDB, por ambiente) ou numa **pasta do computador** (Configurações →
  Documentos; só Produção), organizada em `AAAA-MM/Nome do documento (abc12345).ext`.
- O Chrome pede de novo a autorização da pasta ao reiniciar; até autorizar,
  os novos ficam no navegador e são movidos depois ("Conceder acesso").
- Arquivos iguais são guardados uma vez só.
- Lixeira: 30 dias; depois (ou na exclusão definitiva) o arquivo é apagado se
  nenhum outro documento o usa.
- Backup automático: além do `.sqlite`, copia para `documentos/` só os
  arquivos novos. Cópia manual: `.zip` (banco + documentos). Restaurar aceita
  `.zip` ou `.sqlite` (neste caso busca os documentos na pasta de backup).
- Atualização da 0.1.x: anexos de cartão e atividade viram documentos "não
  classificados" com os vínculos da regra acima; o conteúdo sai do banco na
  primeira abertura e o texto dos PDFs é lido ao abrir o GED.

## 8. Alertas e campos

- Uma vez por dia o sino avisa os documentos que vencem em até 7 dias.
- Campo personalizado do tipo **Documento (GED)**: escolhe um documento (ou
  envia um novo) e mostra nome + validade.
- Contato e organização: **+ Novo campo** no próprio formulário
  (administrador).

## 9. Depois

- OCR automático de todas as imagens e PDFs escaneados para a busca —
  decisão do usuário: depois (hoje só quando se pede a transcrição com IA
  no envio, seção 2.1).

## Enviar documento pelo WhatsApp (0.2.46)

- Na aba Documentos do cartão, do contato, da organização e da atividade,
  cada documento ganha o ícone de WhatsApp quando há alguém com celular:
  - cartão: contato principal, outros contatos do cartão e a organização;
  - contato: ele mesmo; organização: ela e os contatos dela;
  - atividade: os do cartão vinculado, o contato e a organização dela.
- A janela "Enviar pelo WhatsApp" mostra o documento, para quem enviar
  (nome, celular e papel: contato principal, outro contato…) e a mensagem que
  vai junto (começa com o nome do documento).
- O envio sai do WhatsApp conectado no WhatsApp Web deste Chrome, sem abrir a
  conversa (mesma biblioteca dos lembretes, spec 10). Imagem PNG/JPG/WebP vai
  como foto com legenda; o resto, como documento com o nome do arquivo. Até
  64 MB.
- Sem a aba do WhatsApp Web aberta e conectada, a janela explica e oferece
  "Abrir WhatsApp Web".
- O envio fica na auditoria do documento: "Enviou pelo WhatsApp para
  Cristiane · (81) 98729-8285".
- Se o WhatsApp Web mudar por dentro e o envio automático falhar, a janela
  oferece o plano B: "Baixar o arquivo e abrir a conversa" com o contato, para
  arrastar o arquivo manualmente.
- Biblioteca WA-JS 4.7.1 (0.2.47, corrige o envio de arquivos depois de uma
  mudança do WhatsApp Web). A aba do WhatsApp com uma versão anterior da
  biblioteca é recarregada sozinha antes do envio.

No cartão, o campo **Contato** (principal) mostra os ícones de WhatsApp e de
e-mail quando o contato tem celular/e-mail, como os "Outros contatos".

## Vários números de origem do WhatsApp (0.2.48)

**Configurações → WhatsApp**: cada usuário cadastra os números de onde envia
(neste computador, como os provedores de e-mail): nome (ex.: Comercial,
Suporte), número e forma de envio:

| Forma | Como envia |
|---|---|
| WhatsApp Web deste Chrome | Sozinho, pelo WhatsApp Web aberto neste perfil do Chrome. Só um por perfil (o WhatsApp Web aceita um número por perfil). O CRM confere se o número conectado é o cadastrado (DDD e 8 últimos dígitos, com ou sem o 9) e recusa se for outro |
| Manual | Para o número aberto em outro perfil do Chrome ou no celular: o CRM baixa o arquivo e mostra os passos com "Copiar o link da conversa" (wa.me) e "Copiar a mensagem"; "Já enviei" registra o envio |
| Z-API | Sozinho, pela API da Z-API (instância, token e Client-Token; permissão de acesso a api.z-api.io pedida ao salvar). Funciona com qualquer perfil aberto |

- **Testar**: WhatsApp Web confere o número conectado; Z-API consulta se a
  instância está conectada.
- No envio do documento, com mais de um número, aparece **Enviar de**; vem
  escolhido o último usado. Sem nenhum número cadastrado, tudo sai do WhatsApp
  Web deste Chrome, como antes.
- A auditoria registra o número de origem: "… · de Suporte (envio manual)".
- **Por que não há dois automáticos pelo WhatsApp Web:** cada perfil do Chrome
  é isolado; a extensão só enxerga as abas do perfil onde está instalada, e
  instalá-la no outro perfil criaria outro CRM, com banco próprio. Para dois
  números automáticos, o segundo vai pela Z-API.

### Envio vira atividade concluída (0.2.49)

Cada envio (automático ou "Já enviei" no manual) cria uma **atividade
concluída** do tipo **WhatsApp** (criado na primeira vez, ícone de conversa):
- título: `Enviou "CONTRATO" pelo WhatsApp para Cristiane`;
- descrição: Para (nome e celular), De (número de origem, "envio manual") e a
  mensagem enviada;
- fica no cartão da tela (ou no cartão da atividade); fora de um cartão, no
  contato/organização; responsável = quem enviou; sem lembretes;
- aparece na aba Atividades do cartão, na linha do tempo e nos relatórios.
O documento não é vinculado à atividade (o título já diz qual foi), para não
encher o "Também em" a cada envio.
