# ConectCRM

CRM local como extensão do Chrome (Manifest V3): funis, Kanban, tarefas,
contatos, organizações e relatórios, com os dados no próprio computador.

- Planejamento: [`PLANEJAMENTO.md`](PLANEJAMENTO.md)
- Especificações por módulo: [`especificacoes/`](especificacoes)
- Fonte do wa-pipedrive (referência para portar recursos): [`referencia/wa-pipedrive/`](referencia/wa-pipedrive)

## Estrutura

```
extension/              extensão Chrome (Vite + React + TypeScript)
  src/db/               banco SQLite (sql.js): esquema, migrations, repo e módulos
  src/offscreen/        documento offscreen: único dono do banco
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
contato da conversa pelo telefone e grava notas, tarefas, reuniões, recortes de
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
em linguagem natural sobre negócios, tarefas e vendas, respondidas com consultas
reais ao banco local e com ações sugeridas (criar tarefa, nota) que só são
aplicadas com um clique. Usa o provedor de **Configurações → Inteligência
artificial** (detalhes em [`especificacoes/07-copiloto-ia.md`](especificacoes/07-copiloto-ia.md)).
