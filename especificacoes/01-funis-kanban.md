# Especificação 01 — Funis / Kanban

> Status: **em detalhamento**. Telas de referência enviadas: Novo ticket,
> Nova negociação, seletor de SLA, Criar campo personalizado.
> Todas as telas de cadastro recebidas (specs 02, 03 e 04).
> antes de iniciar o código.

## 1. Menu principal

`Funis · Atividades · Contatos · Organizações · GED · Relatórios` + botão **"+"** ·
Copiloto · Notificações · Agenda · Configurações (engrenagem).

(O antigo item "Clientes" foi dividido em **Contatos** e **Organizações**.)

## 2. Tipos de funil

Todo funil tem um **tipo**, escolhido na criação. O tipo define o nome do
item no Kanban, o formulário de cadastro e os campos próprios.

| Tipo | Item do Kanban | Campos próprios |
|---|---|---|
| **Comercial** | Negócio (negociação) | Valor (R$) e produtos/serviços |
| **Operacional** | Ticket | Descrição e SLA (data + hora) |
| **Projeto** | **Etapa de projeto** (cartão) | Descrição, data de início e prazo |

Campos comuns aos três: título/nome, funil, etapa, contato, organização,
responsável, tags, campos personalizados.

Modelo de dados: uma única tabela de itens do Kanban (`deals`), com o tipo
herdado do funil e colunas específicas (`value`, `description`, `sla_at`,
`start_at`, `due_at`)
preenchidas conforme o tipo. Assim o Kanban, filtros, histórico, atividades e
relatórios funcionam igual para todos os tipos.

### 2.1 Desfecho do cartão

No banco o status é sempre `open` / `won` / `lost`; só os termos mudam:

| Tipo | Positivo (verde) | Negativo (vermelho) |
|---|---|---|
| Comercial | **Ganho** | **Perdido** |
| Operacional | **Resolvido** | **Não resolvido** |
| Projeto | **Concluído** | **Não concluído** |

- Cartão fechado no quadro: fundo e borda verdes ou vermelhos, canto dobrado
  com ✓ / ✕, título na mesma cor e etiqueta "Ganho em 15/10/2026" (ou o termo
  do tipo) no rodapé.
- Detalhe: botões com os termos do tipo e faixa verde/vermelha com data,
  motivo e observação.
- Os mesmos termos valem no filtro do quadro ("Resolvidos", "Não
  concluídos"…), nos indicadores do funil, no histórico ("Marcou como
  resolvido"), nas fichas de contato/organização, no popup do WhatsApp, no
  copiloto e nos relatórios (ver spec 06).
- Os motivos (Configurações → Motivos de perda) são os mesmos para os três
  tipos.
- Etapas sugeridas para funis novos não terminam em "Resolvido"/"Concluído"
  (o desfecho é marcado pelos botões): operacional termina em "Em
  validação", projeto em "Entrega".

## 3. Botão "+" (cadastro rápido)

Os cartões aparecem com o tipo do funil: **Negócio (Comercial)**, **Ticket
(Operacional)** e **Etapa (Projeto)**. Os três tipos têm **Valor** e
**produtos/serviços** no mesmo padrão do negócio (com produtos, o valor é a
soma); os campos Valor e Produtos também podem ir para o cartão do quadro.

Menu suspenso com as opções abaixo. As opções de item de funil **só aparecem
se existir pelo menos um funil ativo daquele tipo**.

| Opção | Aparece quando |
|---|---|
| Atividade | sempre |
| Contato | sempre |
| Organização | sempre |
| Negócio | existe funil **Comercial** |
| Ticket | existe funil **Operacional** |
| Etapa (cartão de projeto) | existe funil **Projeto** |

Exemplos:
- Só funis comerciais → Atividade, Contato, Organização, Negócio.
- Comercial + Operacional → Atividade, Contato, Organização, Negócio, Ticket.

Comportamento:
- Se o usuário está com um funil aberto, o formulário já vem com **esse funil
  e a primeira etapa** selecionados (quando o tipo combina).
- O **"+" tracejado de uma coluna** do Kanban abre o formulário do tipo do
  funil já com aquele funil e **aquela etapa**.
- Arquivar o último funil de um tipo remove a opção do menu.

## 4. Formulário "Nova negociação" (funil Comercial)

Modal com rolagem interna, botão ✕ no topo.

| Seção | Campo | Regra |
|---|---|---|
| — | **Nome da negociação** * | Placeholder "Ex.: Proposta de licenças 2026" |
| VALOR | Valor (R$) | Máscara de moeda pt-BR, padrão R$ 0,00 |
| | **+ Adicionar** | Abre a seleção de produtos/serviços (quantidade, preço, desconto). Com produtos, o valor passa a ser a soma dos itens (editável manualmente se o usuário desvincular) |
| FUNIL | Funil | Lista **somente funis Comerciais** |
| | **Etapa** * | Etapas do funil escolhido, com a bolinha de cor; muda ao trocar o funil |
| RELACIONAMENTO | Contato | Busca por **nome, telefone ou e-mail**; opção de criar novo contato a partir da busca |
| | Organização (opcional) | Botão tracejado **"Vincular ou criar organização"**; ao escolher o contato, sugere a organização dele |
| MAIS DETALHES | Responsável | Ver seção 7 |
| | Tags | Ver seção 8 |
| | Campos personalizados | Campos da entidade "Negócio" (ver seção 9) |

Botões: **Criar e abrir** (salva e abre o detalhe do negócio) · **Criar**
(salva, fecha e o cartão aparece na coluna).

## 5. Formulário "Novo ticket" (funil Operacional)

| Seção | Campo | Regra |
|---|---|---|
| — | **Título do ticket** * | Placeholder "Ex: Falha no acesso do cliente" |
| TICKET | Descrição | Texto longo — "Descreva o problema, solicitação ou contexto do ticket" |
| | SLA | Data **e hora** (seção 6) |
| FUNIL OPERACIONAL | Funil | Lista **somente funis Operacionais** |
| | **Etapa do ticket** * | Com bolinha de cor |
| RELACIONAMENTO | Contato / Organização | Igual à negociação |
| MAIS DETALHES | Responsável, Tags, Campos personalizados | Inicialmente recolhido no link **"+ Mais detalhes (responsável, tags e campos personalizados)"**; ao clicar, a seção abre e o link some |

Botões: **Criar e abrir** · **Criar**.

Observação: no mockup da negociação a seção "Mais detalhes" aparece aberta e
no ticket aparece recolhida. Proposta: **mesmo comportamento nos dois** —
recolhida por padrão, abrindo automaticamente se houver campo personalizado
obrigatório ou marcado como "Sempre mostrar".

## 5.1 Formulário "Nova etapa" (funil Projeto)

Sem mockup próprio; segue o padrão dos outros dois:

| Seção | Campo | Regra |
|---|---|---|
| — | **Título** * | |
| PROJETO | Descrição | Texto longo |
| | Início / Prazo | Datas (seletor da atividade) |
| FUNIL DE PROJETO | Funil | Lista **somente funis de Projeto** |
| | **Etapa** * | Coluna do funil, com bolinha de cor |
| RELACIONAMENTO | Contato / Organização | Igual à negociação |
| MAIS DETALHES | Responsável, Tags, Campos personalizados | Recolhido por padrão |

Obs.: no menu "+" e no formulário, o cartão de projeto se chama
**"Etapa"**; a coluna do quadro continua sendo a "etapa do funil".

### 5.2 Cartão parecido (anti-duplicidade)

Nos três formulários, o CRM avisa "Possível duplicidade" quando já existe,
no mesmo tipo de funil e visível para o usuário:

- cartão com **título parecido** (mais de 70% em alguma parte, sem acento —
  mesma regra de contatos, spec 03); ou
- cartão **em aberto do mesmo contato ou organização** escolhidos.

Cada item mostra funil › etapa, situação, contato e organização, com o botão
**Abrir** (no popup: **Usar este**, vira o destino). Salvar sem confirmar
pergunta antes de criar (**Criar mesmo assim**).

## 6. Seletor de SLA (data e hora)

- Campo com ícone de calendário; ao clicar abre um painel com:
  - Calendário mensal (Dom–Sáb), navegação `«  ‹  2026 Out  ›  »`
    (ano anterior, mês anterior, próximo mês, próximo ano), dia de hoje
    destacado, dias de outros meses em cinza.
  - Duas colunas roláveis à direita: **horas (00–23)** e **minutos (00–59)**.
  - Rodapé: **Agora** (preenche data/hora atuais) e **OK** (habilitado após
    escolher a data).
- Exibição no campo: `dd/mm/aaaa hh:mm`, fuso local.
- Também é possível digitar a data/hora direto no campo.
- **Decisão:** o SLA usa este seletor; atividades usam o seletor próprio
  (spec 02). Os dois coexistem.

## 7. Responsável

- Lista de **usuários do sistema e vendedores** (cadastros da Fase 3).
- Sempre exibe o tipo ao lado do nome: **"Antenor (vendedor)"**,
  "Maria (gestor)", "João (administrador)". Tipos: **Administrador, Gestor,
  Vendedor**.
- Padrão: o usuário atual.
- Usuários inativos não aparecem para novos registros (mas continuam nos
  registros antigos).

### 6.0 Cabeçalho das etapas e recolher

- O nome da etapa aparece numa "pílula" na cor da etapa (texto branco),
  com a quantidade e o valor total ao lado: **Prospect 2 - R$ 641,00** (o
  valor sempre no comercial; nos outros tipos quando há valor). No topo da coluna: **⋮**
  abre "Editar funil e etapas" e **‹** recolhe a etapa.
- Em "Novo funil" e "Editar funil", a **Prévia no quadro** mostra os nomes
  com as cores escolhidas antes de salvar.
- Etapa recolhida mostra nome, quantidade e **valor total** (na vertical),
  numa coluna da largura do texto (não uma faixa larga).
- A pílula tem folga nas laterais; quantidade de cartões e valor em negrito.

- Cada coluna do quadro tem o botão **‹ Recolher etapa** no topo: a etapa
  vira uma coluna estreita com o nome na vertical e a quantidade; clicar
  nela expande. Dá para arrastar um cartão para uma etapa recolhida.
- Na linha da pesquisa, **Recolher etapas** recolhe todas (para expandir só
  as necessárias); com alguma recolhida, o botão vira **Expandir etapas**.
- As etapas recolhidas ficam lembradas por funil e usuário.

### 6.0.1 Indicador de atividades no cartão

No rodapé de cada cartão em aberto, ao lado do responsável:

| Cor | Situação |
|---|---|
| Vermelho (‹) | Alguma atividade pendente **atrasada** |
| Verde (›) | Atividade para **hoje** (sem atrasadas) |
| Cinza (›) | Só atividades **futuras** |
| Amarelo (⚠) | **Nenhuma** atividade pendente |

O clique (sem abrir o cartão) mostra um painel com as atividades pendentes,
atrasadas primeiro: tipo, nome, prazo e responsável, com os botões
**Concluir** (verde) e **Abrir** (abre a atividade). No rodapé, **Agendar
uma atividade** abre "Nova atividade" já vinculada ao cartão. A lista do
painel rola sem fechá-lo; rolar o quadro, clicar fora ou Esc fecha.

### 6.1 Visão em lista

Botões **Quadro / Lista** ao lado do nome do funil (a escolha fica lembrada).
A lista mostra uma linha por cartão com os mesmos filtros, visão e busca do
quadro:

- Título (sempre, fixo à esquerda; verde/vermelho com o desfecho quando
  encerrado) e as colunas escolhidas em **Personalizar colunas**: busca,
  visíveis com ordem (↑/↓), demais campos por grupo (negócio, contato,
  organização e campos personalizados), **Colunas padrão**, Cancelar e
  Salvar. Colunas lembradas por funil e usuário. Padrão: Etapa, Valor
  (comercial) / SLA (operacional) / Início e Prazo (projeto), Organização,
  Contato, Responsável e Próxima atividade.
- Clique no cabeçalho ordena (crescente, decrescente, original); vazios no
  fim. Próxima atividade atrasada em vermelho.
- Quantidade e soma no topo; clique na linha abre o cartão.

### 6.2 Detalhe do cartão: painel ou tela cheia

O detalhe abre como painel lateral (até 1100 px) ou em **tela cheia** (botão
⤢ ao lado do ✕): ocupa a área do quadro/lista, mantendo a lista de funis; ao
fechar, volta ao quadro. A escolha fica lembrada. As duas colunas do
detalhe se ajustam à largura do painel (estreito: uma coluna só, sem
rolagem lateral).

### 7.0 Editar contato, organização e responsável pelo cartão

No detalhe do cartão, o **nome** do contato e da organização é um link: o
clique abre o formulário de edição do cadastro por cima do cartão; ao salvar,
o cartão já mostra os dados novos. Para trocar o vínculo, ⇆ abre a busca; ✕
tira o vínculo. Ao lado do responsável, o lápis abre o cadastro do usuário
(administrador edita qualquer um; os demais, só o próprio).

## 7.1 Permissão por tipo de usuário

- **Administrador:** vê e edita todos os cartões.
- **Gestor:** vê e edita os cartões da(s) sua(s) equipe(s).
- **Vendedor:** vê e edita só os seus cartões.
- Cartões sem responsável ficam visíveis a todos.
- Vendedor só atribui cartões a si mesmo; gestor, a alguém da equipe.
- As visões *Fluxo geral / Meu fluxo / Minha equipe* filtram dentro do que
  o usuário pode ver.

## 8. Tags

Novo cadastro em **Configurações → Tags**:
- Nome, cor, ativo.
- **Separadas por entidade**: cada tag pertence a uma entidade (Contato,
  Organização, Negócio, Ticket, Projeto) e só aparece nos formulários dela.
- No formulário: campo de múltipla seleção com busca, mostrando as tags
  como "chips" coloridos; opção de criar tag nova direto no campo (só para
  administradores — a confirmar).
- Filtro por tags no Kanban.

## 9. Campos personalizados

Novo cadastro em **Configurações → Campos personalizados** (lista + modal
"Criar campo personalizado"):

| Campo | Regra |
|---|---|
| Nome do campo | Obrigatório |
| Descrição | Texto de ajuda exibido no formulário |
| Tipo de campo | Texto (padrão), texto longo, número, moeda, data, data e hora, sim/não, lista, lista múltipla, telefone, e-mail, URL, usuário, contato, organização. Tipos "lista" abrem o cadastro de opções |
| Entidade | Contato (padrão), Organização, Negócio, Ticket, Projeto, Atividade, Produto |
| Chave reservada | Placeholder `{{chave}}` — gerada automaticamente a partir do nome (ex.: "Data de nascimento" → `{{data_de_nascimento}}`), editável, **única**. Usada no chat/WhatsApp para ser substituída pelo valor do campo |
| Sempre mostrar | O campo aparece fora do "Mais detalhes" e fica visível no detalhe mesmo vazio |
| Esconder | Não aparece nas telas; continua em relatórios, importação/exportação e na chave do chat |
| Obrigatório | Impede salvar sem preencher |

Proposta adicional: restringir o campo a **funis específicos** (ex.: campo
"Curso" só no funil Matrículas 2024).

Dados: `custom_fields` ganha `description`, `placeholder_key` (única),
`always_show`, `hidden`, `required`, `pipeline_ids`.

## 10. Configuração de funis e etapas

Em **Configurações → Funis** (e pelo menu ⋯ do quadro):
- Criar/editar funil: nome, **tipo** (Comercial / Operacional / Projeto),
  ícone, ordem, ativo/arquivado.
- Etapas: nome, cor, ordem (arrastar), probabilidade % (comercial), prazo
  em dias para considerar o item parado.
- Excluir etapa com itens: pede para mover os itens para outra etapa.
- **Filtrar** do quadro (status, responsável, tags): o último filtro escolhido
  fica salvo por usuário e vale em **todos os funis de todas as categorias**
  (também ao reabrir). As tags são de cada tipo de cartão: a tag de negócio
  escolhida vale nos funis comerciais; nos outros tipos, as tags deles. Ao lado do
  botão aparecem a quantidade e as opções ativas, ex.: "Filtrar (3) Todos ·
  Antenor · Teste" (o status só aparece quando não é o padrão "Abertos").
- Lista de funis (tela Funis e seletores): agrupada por categoria —
  **Comercial**, **Projeto**, **Operacional** (título em negrito com uma linha
  abaixo) — e, dentro de cada uma, por nome.

## 10.1 Campos do cartão (por funil)

Editar funil → aba **Cartão** (ajuste da avaliação 1). Cada funil escolhe
quais campos aparecem nos seus cartões e em que ordem, com prévia ao vivo
no cartão mais recente do funil.

- O **título** aparece sempre; o **valor** fica no topo à direita e o
  **responsável** no rodapé; os demais seguem a ordem da lista.
- Campos disponíveis:
  - **Negócio:** valor, produtos e serviços, probabilidade da etapa, previsão
    de fechamento, SLA (operacional), início e prazo (projeto), descrição,
    dias na etapa, próxima atividade, atividades concluídas, quantidade de notas,
    tags, responsável, origem, criado em;
  - **Contato:** nome, telefone, e-mail;
  - **Organização:** nome, cidade/UF, CNPJ, segmento, telefone;
  - **Campos personalizados** do cartão (os do funil), do contato e da
    organização.
- Campo sem valor não aparece no cartão. Datas vencidas (SLA, prazo,
  previsão, próxima atividade) ficam em vermelho.
- Até 12 campos. **Restaurar padrão** volta ao cartão original (valor,
  contato e responsável; no operacional, SLA; no projeto, prazo).

## 10.1.0 Abas do detalhe, número do ticket e pesquisa geral

- Abas do detalhe do cartão com a quantidade num balão verde: **Histórico (n)**,
  **Notas (n)**, **Atividades (n)** e **Documentos (n)**; em Atividades, um
  segundo balão **vermelho** com as atrasadas (só quando há).
- **Número do ticket**: todo cartão de funil Operacional recebe um número
  sequencial, mostrado no canto superior direito do detalhe, abaixo do X:
  "Ticket: 123". Os tickets existentes são numerados na ordem de criação; um
  cartão que vira ticket (Mudar de funil) recebe o próximo número e o mantém se
  sair e voltar; a cópia de um ticket ganha número novo. A pesquisa do funil
  aceita "123", "#123" ou "Ticket: 123".
- **Pesquisa geral** na barra superior (Ctrl+K ou "/"): cartões (título,
  contato, organização e número do ticket), contatos, organizações, atividades,
  notas e documentos, respeitando as permissões. Setas e Enter escolhem; o
  resultado abre o cartão no funil, o contato, a organização, a atividade ou a
  prévia do documento. Em telas menores que 1536 px aparece só a lupa.

## 10.1.1 Mudar o cartão de funil e clonar

- No detalhe do cartão, o nome do funil (⇄) abre **Mudar de funil**: lista
  os funis de **todos os tipos**, agrupados por categoria.
- Mudando de tipo (negócio ↔ ticket ↔ etapa de projeto), o cartão passa a ser
  do tipo do funil de destino; tags e campos personalizados de **mesmo nome**
  são levados (tags que faltam são criadas no novo tipo; listas pelo rótulo da
  opção). Os campos só do tipo antigo (previsão de fechamento, SLA,
  início/prazo) ficam guardados, mas não aparecem. Arrastar no quadro continua
  só dentro do funil.
- **Clonar** (botão no detalhe): nome da cópia e funil de destino (o atual ou
  outro, de qualquer tipo), com as mesmas regras de etapa. Vão para a cópia
  valor, produtos, contato, organização, responsável, origem, tags e campos
  personalizados; as datas do tipo só quando o tipo é o mesmo. Atividades,
  notas, documentos e histórico ficam no original. A tela abre a cópia.
- Se o funil de destino tiver uma etapa com o **mesmo nome** (sem diferença de
  acento/maiúsculas), ela já vem escolhida; senão o usuário escolhe a etapa.
- Depois de mudar, a tela abre o funil de destino com o cartão aberto. O
  histórico registra "Mudou de funil: Vendas › Proposta → Parcerias › Proposta"
  (com "(agora ticket)" quando o tipo muda).

## 10.2 Detalhe do negócio: produtos e histórico

- Com produtos/serviços no negócio, o resumo aparece logo abaixo do valor:
  produto/serviço, quantidade, preço unitário, desconto e total (com linha
  de total quando há mais de um item). Clicar abre o editor de itens.
- Abas do detalhe: **Histórico**, Notas, Atividades e Documentos (o cartão
  abre em Notas). No histórico, as linhas de **nota, atividade e documento**
  que ainda existem são links: a nota abre na aba Notas destacada, a atividade
  no formulário e o documento na prévia do GED.
- A aba **Histórico** mostra toda alteração do cartão, com quem fez, quando
  e o valor antigo → novo: campos (valor, contato, organização,
  responsável, datas, motivo da perda…), etapa, ganho/perdido/reaberto,
  produtos (adicionados, alterados, removidos), tags, campos
  personalizados, notas, anexos e atividades (criada, concluída, remarcada,
  excluída). Gravações do mesmo usuário em até 2 segundos aparecem como um
  só evento (ex.: salvar produtos recalcula o valor).

## 11. Pendências

Respondidas: P1 (cartão "Etapa" no funil Projeto), P2 (proposta aceita),
P3 (Administrador, Gestor, Vendedor), P4 (tags por entidade).

- **P5 — Tipo do funil:** adotado que **não pode ser alterado** depois de
  criado (muda os campos dos cartões). Reabrir se necessário.
