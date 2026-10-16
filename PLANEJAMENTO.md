# ConectCRM — Planejamento de implementação

> Status: **planejamento** (nenhum código escrito ainda). Aguardando a sugestão
> de tela inicial e o detalhamento das funcionalidades para fechar o escopo.

## 1. Visão

CRM completo rodando **100% local como extensão do Chrome** (Manifest V3):
funis de venda, Kanban de etapas, tarefas/atividades, cadastro de pessoas e
empresas, relatórios — sem servidor próprio para os dados. Backup diário
automático em pasta escolhida pelo usuário, na mesma lógica da extensão
`gestao-financeira-extensao`.

O `wa-pipedrive` (que já usa o nome "ConectCRM" no manifest) hoje é um
"conector" WhatsApp Web → Pipedrive/HubSpot. O novo ConectCRM passa a ser o
**próprio CRM**: tudo que hoje é gravado via API do Pipedrive/HubSpot passa a
ser gravado no banco local.

## 2. Arquitetura (herdada da gestao-financeira-extensao)

| Camada | Decisão | Origem |
|---|---|---|
| Build | Vite + React 19 + TypeScript, `base: "./"`, múltiplas entradas (popup, dashboard, background) | `extension/vite.config.ts` |
| UI | Tailwind 4 + pacote `shared/tailadmin` (Card, Button, Modal, Badge, AppLayout, TopNavBar, tema claro/escuro), ícones lucide-react, fonte Inter | `shared/tailadmin` |
| Banco | SQLite em WASM (`sql.js`), snapshot persistido no IndexedDB, migrations `.sql` versionadas | `extension/src/db/client.ts`, `idb.ts`, `sql.ts` |
| Ambientes | Produção / Teste (com dados demo) | `lib/environment.ts`, `lib/seedDemoData.ts` |
| Backup | File System Access API: handle da pasta salvo no IndexedDB; checagem ao abrir o dashboard; `diario_*.sqlite` / `Semanal_*.sqlite` com data **local**; modal de reautorização quando a permissão cai; notificação de sucesso/erro; restauração manual | `lib/autoBackup.ts`, `lib/backupFolder.ts`, `AutoBackupPermissionModal.tsx` |
| Segurança | PIN de bloqueio + código de recuperação | `lib/appLock.ts`, `LockScreen.tsx` |
| Notificações | Central de notificações (sino) | `lib/notifications.ts`, `NotificationBell.tsx` |
| Exportação | Excel (`xlsx`) | `lib/exportExcel.ts` |
| Testes | Vitest com banco em memória | `tests/` |

Telas: **dashboard em aba própria** (CRM completo) + **popup/side panel**
leve para ações rápidas (especialmente dentro do WhatsApp Web).

## 3. O que reaproveitar do wa-pipedrive

Fonte copiado em `referencia/wa-pipedrive/` (somente referência; será portado
para módulos TypeScript, não usado como está — o `popup.js` tem ~5.100 linhas
em JS puro).

| Recurso | Onde está (popup.js / outros) | Destino no ConectCRM |
|---|---|---|
| Captura de conversa e mídias do WhatsApp Web | `content.js`, `pageBlobHook`, `mergeDownloadsIntoMedia`, `background.js` (cache de downloads) | Módulo "WhatsApp": grava mensagens como nota/atividade no deal local |
| Recorte de tela (clips) | `background.js` (`startClip`, `cropDataUrl`), `loadClips` | Anexos de deal/nota |
| Roteador de IA (Gemini, OpenAI, Claude, DeepSeek) + tradução de erros | `aiGenerate`, `callGemini`, `callOpenAILike`, `callClaude` | `lib/ai/` (unificar com o da financeira) |
| Resumo de conversa / imagens por IA, transcrição de áudio | `summarizeWithGemini`, `summarizeImagesWithGemini`, `transcribeAudioWithAI` | Notas inteligentes |
| Consulta CNPJ (BrasilAPI, minhareceita, ReceitaWS, merge de fontes) | bloco "Consulta de CNPJ" | Cadastro de Empresas (preenchimento automático) |
| Autocomplete anti-duplicação Pessoa/Organização | `setupAutocomplete` | Formulários de cadastro e de novo deal |
| Painel de atividades (filtro por período, atrasadas, concluir) | bloco "Painel de atividades do CRM" | Módulo Tarefas |
| Agendamento Google Agenda / Outlook (OAuth, horários livres, Meet/Teams, convidados) | `gAuth`, `microsoftAuth`, `getScheduleBusyRanges`, `computeFreeSlots`, `createProviderEvent` | Tarefas do tipo reunião → evento na agenda |
| ZapSign (assinatura eletrônica) | bloco "ZapSign" | Aba do deal "Documentos" |
| Asaas (cobranças avulsas e recorrentes) | bloco Asaas | Aba do deal "Cobranças" |
| Licença / trial / checkout / upgrade / cancelamento (`extpipe.claudiacrm.com.br`) + device ID | início do `popup.js` | Mantido (a confirmar) |
| Ícones, logo, fonte, política de privacidade, guia OAuth | `icons/`, `fonts/`, `Ajustes/` | Reaproveitados |

Integrações com Pipedrive/HubSpot: deixam de ser destino principal. Proposta:
manter apenas um **importador** (migrar deals, pessoas, empresas e atividades
de quem já usa Pipedrive/HubSpot).

## 4. Modelo de dados (rascunho)

- `pipelines` (funis) · `stages` (etapas: ordem, probabilidade, cor, dias para "estagnado")
- `deals` (negócios: título, valor, moeda, funil, etapa, pessoa, empresa, responsável, status aberto/ganho/perdido, motivo de perda, data prevista, origem, etiquetas)
- `deal_stage_history` (entrada/saída de cada etapa — base dos relatórios de conversão e tempo por etapa)
- `persons` (pessoas) · `organizations` (empresas, com dados de CNPJ) · `person_organization`
- `activities` (tarefas: tipo, assunto, data/hora, duração, concluída, vínculo com deal/pessoa/empresa, id do evento na agenda)
- `activity_types` · `notes` · `attachments` (blobs no IndexedDB/SQLite) · `tags`
- `custom_fields` + valores (campos personalizados por entidade) — a confirmar
- `whatsapp_captures` (mensagens capturadas vinculadas a deal/pessoa)
- `loss_reasons`, `products` / `deal_products` — a confirmar
- `settings`, `audit_log` (histórico/timeline de alterações)

## 5. Fases de implementação

| Fase | Entrega | Principais itens |
|---|---|---|
| **0. Fundação** | Repositório e build | Monorepo no padrão da financeira (`extension/`, `shared/tailadmin`, `tests/`), manifest MV3, ícones, CI de typecheck/testes |
| **1. Dados** | Banco local | Migrations iniciais, camada `db/*` por entidade, testes Vitest, seed de demonstração |
| **2. Shell + Tela inicial** | Navegação | Layout (sidebar/topbar), tela inicial conforme mockup enviado, busca global, tema claro/escuro |
| **3. Cadastros** | Pessoas e Empresas | Listas com filtros/colunas configuráveis, ficha com timeline, CNPJ automático, anti-duplicação, mesclar registros, importação CSV/Excel |
| **4. Funis + Kanban** | Negócios | Configuração de funis/etapas, Kanban com arrastar-e-soltar, cartões com valor/atraso/próxima atividade, visão lista, ganho/perdido, detalhe do deal (notas, atividades, anexos, histórico) |
| **5. Tarefas / Agenda** | Atividades | Lista e calendário, filtros por período, atrasadas, lembretes (`chrome.alarms` + notificações), integração Google Agenda/Outlook |
| **6. Backup e segurança** | Confiabilidade | Backup diário/semanal, restauração, exportação, ambiente de teste, PIN de bloqueio |
| **7. WhatsApp** | Captura | Ação no WhatsApp Web: identificar contato pelo telefone, criar/abrir deal, salvar conversa/mídias/resumo IA como nota |
| **8. Relatórios** | Análise | Funil de conversão, previsão (valor × probabilidade), ganhos/perdidos por período e motivo, tempo médio por etapa, atividades por tipo, exportar Excel |
| **9. Integrações extras** | Valor agregado | ZapSign, Asaas, copiloto IA, importador Pipedrive/HubSpot |
| **10. Publicação** | Distribuição | Licenciamento, política de privacidade, Chrome Web Store |

Fases 0–6 formam o **MVP** (CRM utilizável com backup). 7–10 em seguida,
ordem ajustável conforme prioridade.

## 6. Decisões em aberto

1. **ID da extensão / Web Store**: o ConectCRM novo substitui o wa-pipedrive
   publicado (mesmo ID, mesma chave `.pem`, mesmo OAuth client do Google) ou
   será uma extensão separada?
2. **Usuário único ou equipe?** Local implica um usuário por navegador.
   Precisa de "responsável" por deal / vários vendedores / sincronizar entre
   computadores?
3. **Pipedrive/HubSpot**: manter só importador, ou também sincronização?
4. **Licenciamento**: reaproveitar o backend `extpipe.claudiacrm.com.br`
   (trial, planos, checkout)?
5. **Campos personalizados e produtos** entram no MVP?
6. **Onde fica o CRM no WhatsApp**: popup (como hoje) ou side panel fixo ao
   lado do WhatsApp Web?
7. **Repositório**: criar `Antenor-Aquino/ConectCRM` no GitHub (vazio) para
   versionar este projeto.

## 7. Próximos passos

1. Receber o mockup da tela inicial.
2. Detalhar funcionalidades módulo a módulo (começando por Funis/Kanban e Cadastros).
3. Fechar as decisões da seção 6 e congelar o modelo de dados.
4. Iniciar a Fase 0.
