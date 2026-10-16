# ConectCRM — Planejamento de implementação (v4)

> Status: **Fases 0 a 6 concluídas** (branches em sequência até `fase-6-produtos-campos`). Próximo: Fase 7 (tarefas e agenda).
> v4: v1 individual (sem sincronização) com cadastro de equipes/usuários; estrutura pronta para sincronizar no futuro; "Fluxo geral" confirmado.

## 1. Visão

CRM completo rodando **localmente como extensão do Chrome** (Manifest V3):
funis/projetos, Kanban de etapas, tarefas, clientes (pessoas e empresas),
produtos e serviços, campos personalizados, equipes e relatórios. Sem servidor
para os dados; backup diário automático em pasta local (mesma lógica da
`gestao-financeira-extensao`).

A integração com o WhatsApp Web funciona **como hoje no wa-pipedrive**, mas
gravando no CRM local em vez de Pipedrive/HubSpot (que deixam de existir).

## 2. Decisões confirmadas

| Tema | Decisão |
|---|---|
| Extensão | **Nova** extensão (novo ID, nova chave `.pem`, novo OAuth Client do Google/Microsoft). O wa-pipedrive publicado não é alterado. |
| Usuários | Equipes e vários usuários/vendedores, associáveis a negócios. |
| Pipedrive/HubSpot | Removidos. Todo o código de API deles vira chamadas ao CRM local. |
| Licença | Mesma lógica e backend do wa-pipedrive (`extpipe.claudiacrm.com.br`: trial, planos, checkout, upgrade, cancelamento, device ID). **Por instalação**: vários usuários cadastrados num mesmo computador usam uma licença. |
| Uso na v1 | **Individual**: um banco por computador, sem sincronização. Usuários, equipes e vendedores são cadastrados para atribuição e controle (ex.: gestor acompanhando a equipe no próprio computador). |
| Sincronização | **Futura.** O modelo de dados já nasce preparado (seção 5.1). |
| Visões do Kanban | *Fluxo geral* (todos), *Meu fluxo*, *Minha equipe*. |
| Indicadores dos cartões | A definir mais à frente. A v1 mostra o básico (título, valor, contato, responsável); os indicadores entram depois. |
| Licença ConectCRM × wa-pipedrive | **Separadas.** A extensão envia `produto: "conectcrm"` em todas as chamadas; o servidor (`extpipe`) precisa passar a validar o produto para que chaves de um não ativem o outro. |
| Preços e checkout | Os mesmos do wa-pipedrive (R$ 17,65/mês; R$ 180,00/ano). |
| Campos personalizados | Entram na estrutura desde o início. |
| Produtos e serviços | Entram na estrutura desde o início. |
| WhatsApp | Mesmo fluxo atual (popup), apontando para o CRM local. |

## 3. Tela inicial (a partir do mockup)

**Barra superior (fixa)**
- Busca global `Ctrl+K` (negócios, pessoas, empresas, tarefas).
- Menu: **Funis · Tarefas · Contatos · Organizações · Relatórios** + botão **"+"** (cadastro rápido — regras em `especificacoes/01-funis-kanban.md`).
- **Configurações**, **sino** (central de notificações: backups, tarefas vencendo, avisos de licença) e **calendário** (agenda do dia / próximas tarefas).

**Coluna esquerda — lista de funis**
- Funis com ícone (ex.: Suporte, PowerCubus, Matrículas 2024, Olimpíadas, Vendas); selecionado em destaque.
- Funis são genéricos (vendas, suporte, matrículas, projetos) — não só vendas.
- Recolhível pelo ícone ☰ do cabeçalho do quadro.

**Cabeçalho do quadro**
- Nome do funil, ícone de **indicadores do funil** (mini-relatório), menu **⋯** (editar funil/etapas, duplicar, arquivar, exportar).
- Pesquisa dentro do funil, **Filtrar** (responsável, equipe, etiqueta, status, valor, datas, campos personalizados).
- **Fluxo geral**: seletor de visão — *Fluxo geral* (todos), *Meu fluxo*, *Minha equipe* e ordenação **Mais recentes** (recentes, valor, data prevista, próxima tarefa, nome).

**Colunas (etapas)**
- Bolinha colorida, nome, **quantidade** e **soma de valores** da etapa.
- Etapa vazia mostra a área tracejada **"+"** para criar negócio direto nela.
- Rolagem horizontal; arrastar-e-soltar entre etapas e para reordenar.

**Cartão do negócio**
- Título (link para o detalhe) e **valor**.
- Contato com avatar de iniciais.
- **Avatar do responsável**.
- Indicadores do rodapé e destaques visuais (ex.: cartão vermelho com "✕", balão vermelho): **a definir mais à frente**.

## 4. Arquitetura

Herdada da `gestao-financeira-extensao`:

| Camada | Decisão |
|---|---|
| Build | Vite + React 19 + TypeScript, `base: "./"`, entradas: dashboard, popup, background, content script, offscreen |
| UI | Tailwind 4 + `shared/tailadmin` (Card, Button, Modal, Badge, layout, tema claro/escuro), lucide-react, fonte Inter |
| Kanban | `@dnd-kit` para arrastar-e-soltar (acessível, com teclado) |
| Banco | SQLite WASM (`sql.js`), snapshot no IndexedDB, migrations `.sql` versionadas |
| Backup | File System Access API, conforme seção 7 |
| Testes | Vitest com banco em memória |

**Ponto novo — banco com um único "dono".** Na financeira o banco vive na aba
do dashboard. Aqui o popup do WhatsApp também lê e grava; se dashboard e
popup carregassem cada um seu snapshot, um sobrescreveria o outro. Proposta:
o banco roda num **documento offscreen** da extensão; dashboard, popup e
background falam com ele por mensagens (camada `db/*` com a mesma interface,
só muda o transporte). Isso também permite lembretes de tarefas via
`chrome.alarms` com o dashboard fechado.

## 5. Usuários e equipes — como funciona sendo local

Recomendação para a v1:
- **Usuários** e **equipes** são cadastros no banco (nome, e-mail, avatar/cor, equipe, papel: admin / gestor / vendedor, ativo).
- Ao abrir, o sistema identifica o **usuário atual** (seleção + PIN, reaproveitando o bloqueio por PIN da financeira).
- Negócios, tarefas, pessoas e empresas têm **responsável** e **participantes**; filtros "Meus" / "Minha equipe" / "Todos".
- Permissões simples por papel (ex.: vendedor vê só os próprios negócios; gestor vê a equipe).

**Limite importante:** com dados locais, todos os usuários compartilham o
banco **do mesmo navegador/computador**. Para vendedores em computadores
diferentes, ver seção 5.1.

### 5.1 Sincronização entre computadores (futura — não entra na v1)

Modelo **local-first**: cada instalação continua com o banco completo no
próprio computador (funciona offline, rápido, com backup diário), e um
servidor só troca as **alterações** entre os computadores da mesma empresa.

1. **Espaço da empresa**: o admin cria a empresa no servidor e convida os
   usuários; cada instalação (com sua licença) entra nesse espaço.
2. **Registro de alterações**: toda gravação local (criar, editar, mover
   etapa, excluir) também vai para uma fila local com id, data/hora,
   usuário e campos alterados.
3. **Envio**: a cada poucos segundos (e ao voltar a ter internet), a extensão
   envia a fila ao servidor.
4. **Recebimento**: a extensão pede ao servidor "tudo que mudou desde a
   última vez" e aplica no banco local; o Kanban atualiza na tela.
5. **Conflitos**: decididos **por campo** — se duas pessoas mudam campos
   diferentes do mesmo negócio, as duas alterações valem; no mesmo campo,
   vale a mais recente e a anterior fica no histórico. Exclusões são lógicas
   (podem ser desfeitas).
6. **Permissões no servidor**: o vendedor recebe só o que pode ver (seus
   negócios / sua equipe); o gestor recebe a equipe; o admin, tudo.
7. **Anexos** (arquivos, mídias do WhatsApp) sobem separados e são baixados
   sob demanda.

Implicações:
- Os dados passam a ficar **também no servidor** → política de privacidade e
  LGPD, custo de hospedagem e armazenamento.
- Backend: o mesmo servidor da licença (`extpipe`) ganharia a API de
  sincronização, **ou** um serviço pronto (ex.: Supabase/Postgres), que
  acelera a construção.
- O banco já nasce preparado, então ligar a sincronização depois não exige
  refazer as telas.

### 5.2 Preparação para sincronização (entra na v1)

Regras aplicadas a **todas** as tabelas de dados:
- `id` em UUID gerado no cliente (nunca autoincremento).
- `created_at`, `created_by`, `updated_at`, `updated_by`.
- `deleted_at` (exclusão lógica, nada é apagado de fato).
- `version` (contador por registro, para detectar conflitos).
- `workspace_id` (empresa; na v1 existe um só, criado na instalação).
- Tabela `change_log` (entidade, id, campos alterados, valores antigo/novo,
  usuário, data/hora, `synced_at` vazio na v1) — alimenta também a timeline
  e o histórico do negócio.
- Valores de campos personalizados e itens de negócio em tabelas próprias
  (sincronizáveis linha a linha, sem JSON gigante num campo).
- Toda gravação passa por uma única camada (`db/*`), que é onde a fila de
  sincronização será ligada no futuro.

## 6. Modelo de dados

**Organização e acesso**
- `users`, `teams`, `team_members`, `roles` (permissões por papel)
- `license_state` (local, espelho da licença)

**Funis**
- `pipelines` (nome, ícone, cor, tipo, ordem, arquivado, equipes com acesso)
- `stages` (funil, nome, cor, ordem, probabilidade %, dias para "estagnado")
- `loss_reasons`

**Negócios**
- `deals` (título, valor, moeda, funil, etapa, posição no Kanban, pessoa, empresa, responsável, status aberto/ganho/perdido, motivo de perda, data prevista, data de ganho/perda, origem)
- `deal_participants` (usuários e pessoas adicionais)
- `deal_items` (produto/serviço, quantidade, preço unitário, desconto, total, recorrência) — o valor do negócio pode ser manual ou a soma dos itens
- `deal_stage_history` (entrada/saída em cada etapa → conversão e tempo por etapa)

**Contatos e Organizações**
- `persons` (nome, telefones, e-mails, cargo, empresa, responsável)
- `organizations` (razão social, fantasia, CNPJ + dados da Receita, endereço, responsável)
- `person_organizations`

**Tarefas e interações**
- `activity_types` (ligação, reunião, e-mail, WhatsApp, tarefa… configuráveis)
- `activities` (tipo, assunto, descrição, data/hora, duração, responsável, concluída, vínculos com negócio/pessoa/empresa, id do evento no Google/Outlook)
- `checklist_items` (checklist do negócio — o `0/1` do cartão)
- `notes` e `comments` (com menção a usuários)
- `attachments` (arquivos, recortes de tela, mídias do WhatsApp)
- `whatsapp_captures` (mensagens capturadas, vinculadas a negócio/pessoa)

**Produtos e serviços**
- `product_categories`
- `products` (código, nome, tipo produto/serviço, unidade, preço, custo, recorrência avulsa/mensal/anual, ativo)

**Campos personalizados**
- `custom_fields` (entidade: negócio/pessoa/empresa/produto/tarefa; tipo: texto, texto longo, número, moeda, data, sim/não, lista, lista múltipla, usuário, pessoa, empresa, telefone, e-mail, URL; opções; obrigatório; ordem; restrito a funil(is) específicos)
- `custom_field_values` (entidade, registro, campo, valor)
- Campos personalizados aparecem nos formulários, no detalhe, nos filtros, nas colunas das listas, na importação/exportação e nos relatórios.

**Diversos**
- `tags` + vínculos, `saved_filters` (visões salvas), `settings`, `audit_log` (timeline e base para a futura sincronização)

## 7. Backup (igual à financeira)

- Pasta escolhida pelo usuário (handle salvo no IndexedDB).
- Checagem na primeira abertura do dia; arquivo `diario_conectcrm-backup-auto-<data local>.sqlite` (opção semanal).
- Data sempre no **fuso local** (mesma correção já feita na financeira).
- Se a permissão da pasta cair: modal pedindo reautorização com o backup rodando logo em seguida.
- Notificação de sucesso/erro, exportação manual, **restauração** de backup e ambiente de **Teste** com dados de demonstração.

## 8. Reaproveitamento do wa-pipedrive

Fonte em `referencia/wa-pipedrive/` (será portado para TypeScript modular).

| Recurso | Destino |
|---|---|
| Captura de conversa e mídias do WhatsApp (`content.js`, blob hook, downloads) | Popup → localizar pessoa pelo telefone → negócio → salvar nota/atividade/anexos |
| Recorte de tela (`background.js`) | Anexos |
| Roteador de IA (Gemini, OpenAI, Claude, DeepSeek), resumo, transcrição de áudio | `lib/ai/` compartilhado |
| Consulta CNPJ (BrasilAPI, minhareceita, ReceitaWS) | Cadastro de empresa e "novo negócio a partir de CNPJ" |
| Autocomplete anti-duplicação | Formulários de pessoa/empresa/negócio |
| Painel de atividades (períodos, atrasadas, concluir) | Módulo Tarefas e popup |
| Agendamento Google Agenda / Outlook (horários livres, Meet/Teams, convidados) | Tarefas do tipo reunião |
| ZapSign | Aba "Documentos" do negócio |
| Asaas (cobranças avulsas/recorrentes) | Aba "Cobranças" do negócio, usando os itens (produtos/serviços) |
| Licença (trial, checkout, upgrade, cancelamento) | Mesmo fluxo |
| Ícones, fonte, política de privacidade, guia OAuth | Adaptados ao novo ID |

## 9. Fases

| Fase | Entrega |
|---|---|
| **0. Fundação** | Repositório, build, manifest da nova extensão, ícones, offscreen com banco, testes rodando |
| **1. Dados** | Migrations de todo o modelo da seção 6, camada `db/*`, testes, dados de demonstração |
| **2. Estrutura e tela inicial** | Barra superior, busca `Ctrl+K`, botão "+", lista de funis, quadro Kanban (somente visual), tema claro/escuro |
| **3. Usuários, equipes e licença** | Cadastros, seleção de usuário + PIN, papéis, tela de licença |
| **4. Funis e Kanban** | Cadastro de funis/etapas, arrastar-e-soltar, cartão completo, filtros, ordenação, ganho/perdido, detalhe do negócio (timeline, notas, comentários, checklist, anexos, histórico) |
| **5. Contatos e Organizações** | Pessoas e empresas, CNPJ, anti-duplicação, mesclar, importação/exportação Excel/CSV |
| **6. Produtos, serviços e campos personalizados** | Catálogo, itens no negócio, editor de campos personalizados, uso em formulários/filtros/listas |
| **7. Tarefas e agenda** | Lista e calendário, tipos, lembretes, Google Agenda/Outlook |
| **8. Backup e segurança** | Backup diário, restauração, ambiente de teste |
| **9. WhatsApp** | Popup sobre o WhatsApp Web gravando no CRM local |
| **10. Relatórios** | Conversão do funil, previsão (valor × probabilidade), ganhos/perdidos por período/motivo/responsável/equipe, tempo por etapa, produtos vendidos, atividades por usuário; exportar Excel |
| **11. Integrações** | ZapSign, Asaas, copiloto IA |
| **12. Sincronização** (futura) | Servidor, espaço da empresa, convites, envio/recebimento de alterações, permissões no servidor |
| **13. Publicação** | Política de privacidade, verificação OAuth, Chrome Web Store |

**MVP = Fases 0 a 9** (CRM com equipe, Kanban, clientes, produtos, campos
personalizados, tarefas, backup e WhatsApp).

## 10. Especificações por módulo

- `especificacoes/00-design.md` — padrão visual: o mesmo da gestão financeira (TailAdmin, fonte Inter, paleta, componentes).
- `especificacoes/01-funis-kanban.md` — tipos de funil, botão "+", formulários de negócio e ticket, SLA, responsável, tags, campos personalizados.
- `especificacoes/02-tarefas.md` — modal de tarefa, tipos, quando/duração/lembrete.
- `especificacoes/03-contatos.md` — modal de contato, canais, organizações, campos personalizados.
- `especificacoes/04-organizacoes.md` — modal de organização, CNPJ, CEP, contatos vinculados.

## 11. Dúvidas

Nenhuma pendente para iniciar. Ficam para depois: indicadores dos cartões
e o backend da sincronização (servidor próprio `extpipe` ou serviço pronto).
