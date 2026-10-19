# ConectCRM

CRM local como extensão do Chrome (Manifest V3): funis, Kanban, atividades,
contatos, organizações e relatórios, com os dados no próprio computador.

- Planejamento: [`PLANEJAMENTO.md`](PLANEJAMENTO.md)
- Especificações por módulo: [`especificacoes/`](especificacoes)
- Fonte do wa-pipedrive (referência para portar recursos): [`referencia/wa-pipedrive/`](referencia/wa-pipedrive)

## Estrutura

```
extension/              extensão Chrome (Vite + React + TypeScript)
  src/db/               banco SQLite (sqlite-wasm, arquivo no OPFS): esquema, migrations, repo e módulos
  src/offscreen/        documento offscreen e worker do banco (único dono do SQLite)
  src/rpc/              mensagens entre telas e banco
  src/background/       service worker
  src/dashboard/        CRM (aba própria)
  src/popup/            popup da extensão
  tests/                testes (Vitest, banco em memória)
shared/tailadmin/       design compartilhado (cópia da gestao-financeira-extensao)
```

## Como rodar

Requer Node 22+.

```bash
npm install
npm test            # testes do banco
npm run typecheck
npm run build       # gera extension/dist
```

Carregar no Chrome: `chrome://extensions` → **Modo do desenvolvedor** →
**Carregar sem compactação** → selecione a pasta `extension/dist`. Clique no
ícone do ConectCRM → **Abrir o CRM**.

Durante o desenvolvimento, `npm run dev` recompila a cada alteração (depois
clique em ↻ na extensão em `chrome://extensions`).

### Licença

O CRM valida a licença por instalação no mesmo servidor do wa-pipedrive
(`extpipe.claudiacrm.com.br`). Para testar sem licença, gere um build de
teste — **nunca publique este build**:

```bash
VITE_LICENSE_BYPASS=1 npm run build
```

### Agenda (Google Agenda e Outlook)

A extensão nova tem um ID próprio, diferente do wa-pipedrive, então:

1. **ID fixo da extensão:** gere uma chave (`.pem`) ao empacotar pela
   primeira vez em `chrome://extensions` e coloque a chave pública no campo
   `key` do `manifest.json` (mesmo procedimento do wa-pipedrive, ver
   `referencia/wa-pipedrive/LEIA-ME-OAuth-Google.md`). Nunca versione o `.pem`.
2. **Google:** no Google Cloud, crie um OAuth Client do tipo "Extensão do
   Chrome" com esse ID e substitua `COLE_AQUI_O_CLIENT_ID_DO_GOOGLE...` em
   `extension/public/manifest.json` (`oauth2.client_id`).
3. **Outlook:** no app do Microsoft Entra usado pelo wa-pipedrive, adicione o
   redirect `https://<ID-da-extensão>.chromiumapp.org/microsoft`.

Sem isso, o restante do CRM funciona; só a criação de eventos na agenda
mostra o aviso de configuração.

### Backup e ambiente de teste

Em **Configurações → Backup e ambiente**, escolha a pasta e ative o backup
automático (diário ou semanal). O Chrome pede a autorização da pasta de novo
sempre que é reiniciado; o CRM mostra um aviso e o backup roda no mesmo clique.
A chave **Produção / Teste** no topo abre um banco separado com dados de
exemplo.

### WhatsApp e inteligência artificial

Com o WhatsApp Web aberto, clique no ícone do ConectCRM: o popup identifica o
contato da conversa pelo telefone e grava notas, atividades, reuniões, recortes de
tela e arquivos no cartão escolhido (detalhes em
[`especificacoes/05-whatsapp.md`](especificacoes/05-whatsapp.md)). Para resumir
recortes e transcrever áudios, informe a chave do provedor em
**Configurações → Inteligência artificial**.

### Relatórios

Menu **Relatórios**: indicadores, conversão do funil, previsão (valor ×
probabilidade da etapa), ganhos/perdidos por mês, motivos de perda, tempo por
etapa, produtos vendidos, desempenho por responsável/equipe e atividades, com
exportação para Excel (regras em
[`especificacoes/06-relatorios.md`](especificacoes/06-relatorios.md)). A
probabilidade de cada etapa é definida nas configurações do funil.

### Copiloto de IA

Botão **Copiloto** no topo (ou **Perguntar ao Copiloto** no cartão): perguntas
em linguagem natural sobre negócios, atividades e vendas, respondidas com consultas
reais ao banco local e com ações sugeridas (criar atividade, nota) que só são
aplicadas com um clique. Usa o provedor de **Configurações → Inteligência
artificial** (detalhes em [`especificacoes/07-copiloto-ia.md`](especificacoes/07-copiloto-ia.md)).

### GED (documentos)

Todo arquivo anexado (cartão, atividade, contato, organização, popup) vira um
documento com nome, classificação, validade e vínculos — anexado numa atividade,
aparece também no cartão, no contato e na organização. O menu **GED** busca em
qualquer campo (inclusive no texto dos PDFs), filtra, mostra a prévia de PDFs e
imagens, guarda versões e a trilha de auditoria. Os arquivos ficam no
navegador ou numa pasta escolhida (detalhes em
[`especificacoes/08-ged.md`](especificacoes/08-ged.md)). Ao enviar, cada arquivo
pode ser **transcrito com IA** (opcional): áudio, PDF e imagem viram uma nota
no cadastro; a janela avisa antes o que é extenso, complexo ou não dá para
transcrever.

### Integrações (Pipedrive)

Em **Configurações → Integrações** (só administradores) o Pipedrive é conectado
com a chave da API. **Importar do Pipedrive** traz leads e negócios (como cartões
nos funis comerciais, com de-para das etapas), contatos e organizações, com as
notas, buscando pelo nome ou pela data de
criação, com de-para dos campos e dos valores. O CRM sabe o que já foi
importado (e oferece atualizar), aponta possíveis duplicados e mostra no
cadastro o link para o original (detalhes em
[`especificacoes/09-integracoes.md`](especificacoes/09-integracoes.md)).

### Notificações

Cada atividade tem vários lembretes (ex.: 1 dia antes e 1 h antes no WhatsApp,
15 min antes no Chrome). Em **Configurações → Notificações** cada
usuário liga os canais — Chrome e WhatsApp (pelo WhatsApp Web aberto no Chrome, para o número indicado, ou pelo CallMeBot) —, testa cada um e define os lembretes
padrão, o resumo diário da agenda, o aviso de atividades atrasadas e o horário
de silêncio. Com o Chrome fechado, ao reabrir chega um resumo único. O canal de
e-mail está suspenso por enquanto (detalhes em
[`especificacoes/10-notificacoes.md`](especificacoes/10-notificacoes.md)).

### Lixeira

Toda exclusão vai para a **Lixeira** (ícone no menu superior e em
Configurações → Lixeira), com um aviso "enviado para a lixeira, pode ser
restaurado em até N dias" e o botão **Restaurar**. O cartão leva junto as
atividades e notas, e tudo volta junto. Depois do prazo (padrão 30 dias,
configurável pelo administrador), o item é excluído definitivamente (detalhes
em [`especificacoes/11-lixeira.md`](especificacoes/11-lixeira.md)).

### Cartão a partir de documento (Copiloto)

No Copiloto, anexe um documento (PDF, Word, planilha, foto): ele identifica
cliente, contato, pedido e tags, mostra tudo para conferir e pergunta em qual
funil/etapa criar. Ao confirmar, cria organização, contato, tags e o cartão,
guarda o arquivo no GED e registra a origem no histórico (detalhes em
[`especificacoes/12-copiloto-documento.md`](especificacoes/12-copiloto-documento.md)).

### Cadastros duplicados

Ao criar contato, organização ou cartão, o CRM procura nomes parecidos (mais
de 70% de semelhança em alguma parte do nome, sem acento; ex.: "Anten" ×
"Antenor Aquino") e pergunta se é para **abrir o existente** ou **criar mesmo
assim**. No cartão também avisa quando o mesmo contato/organização já tem um
cartão em aberto no mesmo tipo de funil.
