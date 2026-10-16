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
