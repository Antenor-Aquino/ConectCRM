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
| **Vínculos** | Contatos, organizações, cartões (negócio, ticket, projeto) e tarefas, quantos forem |

**Tipos padrão:** Comprovante de endereço (90 dias), Documento de
identificação, CPF/CNPJ, Contrato, Proposta, Nota fiscal, Comprovante de
pagamento, Certificado (365 dias), Foto/imagem, Outros. Nome, cor, validade
padrão, ordem e ativo são editáveis; excluir um tipo deixa os documentos dele
"não classificados".

## 2. Vínculos automáticos ("tudo que está na tela")

Na janela **Novo documento** os vínculos já vêm marcados (etiquetas cinza =
automáticos); dá para tirar ou acrescentar (busca de cartão, tarefa, contato
ou organização).

| Onde anexa | Vínculos |
|---|---|
| Tarefa | tarefa + cartão + contato + organização (da tarefa ou do cartão) |
| Cartão | cartão + contato + organização |
| Contato | contato + organizações dele |
| Organização | organização |
| Popup do WhatsApp (arquivos e recortes) | cartão escolhido + contato + organização |
| GED | nenhum (o usuário escolhe) |

- Os vínculos ficam como gravados no envio (se a tarefa mudar de cartão, o
  documento não muda). Editáveis no documento → Vínculos.
- Tarefa nova: os arquivos escolhidos aguardam; ao salvar a tarefa abre a
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
vínculo: cartão, tarefa, contato, organização) com a referência ao documento
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

## 3. Aba "Documentos" (cartão, tarefa, contato, organização)

- Lista: ícone, nome, classificação, validade, restrito, arquivo, tamanho,
  versão e "Também em:" (os outros vínculos, clicáveis).
- Ações: **visualizar**, **baixar**, **remover deste cadastro** (só o vínculo;
  continua no GED e nos outros) e **lixeira** (sai de todos os cadastros).
- Anexar: botão ou arrastar arquivos para a aba.
- Histórico do cartão: "Vinculou/Desvinculou o documento X".
- Lista de tarefas: chips dos documentos (clique baixa).

## 4. Menu GED

- **Indicadores** (também filtros rápidos): total e espaço, vencem em 30
  dias, vencidos, não classificados, sem vínculo, lixeira.
- **Busca livre**: em qualquer campo — nome, arquivo, descrição, classificação,
  palavras-chave, datas (dd/mm/aaaa), quem enviou, nomes e e-mail/CNPJ dos
  vínculos, funil, e o **texto de dentro dos PDFs**. Sem acento, sem
  maiúsculas, pedaço de palavra e em qualquer ordem ("comp ender regina").
- **Filtros**: classificação, funil, vinculado a (cartão/tarefa/contato/
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
  de todos; cartão e tarefa seguem a regra do funil/tarefas); sem vínculo,
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
- Atualização da 0.1.x: anexos de cartão e tarefa viram documentos "não
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
