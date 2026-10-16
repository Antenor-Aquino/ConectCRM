# Especificação 01 — Funis / Kanban

> Status: **em detalhamento**. Telas de referência enviadas: Novo ticket,
> Nova negociação, seletor de SLA, Criar campo personalizado.
> Aguardando: tela de cadastro de **Organização**
> antes de iniciar o código.

## 1. Menu principal

`Funis · Tarefas · Contatos · Organizações · Relatórios` + botão **"+"** ·
Configurações · Notificações · Agenda.

(O antigo item "Clientes" foi dividido em **Contatos** e **Organizações**.)

## 2. Tipos de funil

Todo funil tem um **tipo**, escolhido na criação. O tipo define o nome do
item no Kanban, o formulário de cadastro e os campos próprios.

| Tipo | Item do Kanban | Campos próprios |
|---|---|---|
| **Comercial** | Negócio (negociação) | Valor (R$) e produtos/serviços |
| **Operacional** | Ticket | Descrição e SLA (data + hora) |
| **Projeto** | *a definir (ver pendência P1)* | *a definir* |

Campos comuns aos três: título/nome, funil, etapa, contato, organização,
responsável, tags, campos personalizados.

Modelo de dados: uma única tabela de itens do Kanban (`deals`), com o tipo
herdado do funil e colunas específicas (`value`, `description`, `sla_at`)
preenchidas conforme o tipo. Assim o Kanban, filtros, histórico, tarefas e
relatórios funcionam igual para todos os tipos.

## 3. Botão "+" (cadastro rápido)

Menu suspenso com as opções abaixo. As opções de item de funil **só aparecem
se existir pelo menos um funil ativo daquele tipo**.

| Opção | Aparece quando |
|---|---|
| Tarefa | sempre |
| Contato | sempre |
| Organização | sempre |
| Negócio | existe funil **Comercial** |
| Ticket | existe funil **Operacional** |
| *Item de projeto* (ver P1) | existe funil **Projeto** |

Exemplos:
- Só funis comerciais → Tarefa, Contato, Organização, Negócio.
- Comercial + Operacional → Tarefa, Contato, Organização, Negócio, Ticket.

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
| | **+ Adicionar produtos** | Abre a seleção de produtos/serviços (quantidade, preço, desconto). Com produtos, o valor passa a ser a soma dos itens (editável manualmente se o usuário desvincular) |
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
- O mesmo componente será usado em tarefas e demais campos de data/hora.

## 7. Responsável

- Lista de **usuários do sistema e vendedores** (cadastros da Fase 3).
- Sempre exibe o tipo ao lado do nome: **"Antenor (vendedor)"**,
  "Maria (gestor)", "João (administrador)".
- Padrão: o usuário atual.
- Usuários inativos não aparecem para novos registros (mas continuam nos
  registros antigos).

## 8. Tags

Novo cadastro em **Configurações → Tags**:
- Nome, cor, ativo.
- Usadas nos formulários de negócio, ticket, item de projeto e
  (provavelmente) contato, organização e tarefa — ver pendência P4.
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
| Entidade | Contato (padrão), Organização, Negócio, Ticket, Item de projeto, Tarefa, Produto |
| Chave reservada | Placeholder `{{chave}}` — gerada automaticamente a partir do nome (ex.: "Data de nascimento" → `{{data_de_nascimento}}`), editável, **única**. Usada no chat/WhatsApp para ser substituída pelo valor do campo |
| Sempre mostrar | Ver pendência P2 |
| Esconder | Ver pendência P2 |
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

## 11. Pendências

- **P1 — Funil Projeto:** "Nova Etapa" no menu "+" significa criar uma
  **nova etapa (coluna)** no funil de projeto, ou criar um **item de projeto**
  (o cartão)? Haverá tela de cadastro para esse tipo?
- **P2 — "Sempre mostrar" e "Esconder":** proposta —
  *Sempre mostrar* = o campo aparece fora do "Mais detalhes" e fica visível no
  detalhe mesmo vazio; *Esconder* = o campo não aparece nas telas (só em
  importação/exportação, relatórios e chave do chat). Confirma?
- **P3 — Tipos de usuário:** a lista é Administrador, Gestor, Vendedor? Há
  outros (ex.: Atendente/Suporte para tickets)?
- **P4 — Tags:** únicas para todo o sistema, ou separadas por entidade
  (tags de contato ≠ tags de negócio)?
- **P5 — Tipo do funil:** pode ser alterado depois de criado? (Proposta: não,
  pois muda os campos dos itens.)
- **P6 — Tela pendente:** Organização (Tarefa e Contato recebidas — specs 02 e 03).
