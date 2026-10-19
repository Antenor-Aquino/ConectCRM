# Especificação 11 — Lixeira

> Status: **implementado** (versão 0.2.43). Toda exclusão vai para a lixeira,
> pode ser restaurada dentro do prazo e, depois dele, é excluída
> definitivamente.

## 1. O que vai para a lixeira

Toda exclusão feita no CRM:

| Exclusão | Vai junto (e volta junto ao restaurar) |
|---|---|
| Cartão (negócio, ticket, projeto), inclusive em lote | Atividades e notas do cartão |
| Contato | Notas; atividades ligadas só ao contato (sem cartão); vínculos com organizações |
| Organização | Notas; atividades ligadas só à organização; vínculos com contatos |
| Atividade | Notas da atividade |
| Nota, produto, categoria de produto | — |
| Tag | Os vínculos da tag com os registros |
| Funil (sem cartões ativos) | Etapas |
| Etapa removida do funil | — (os cartões já foram movidos para outra etapa) |
| Equipe | Membros |
| Campo personalizado, categoria de campos | Campos da categoria voltam a ela |
| Tipo de documento | Documentos voltam a ser do tipo |
| Documento (GED) | Vínculos (o GED continua com a sua aba Lixeira) |

Não são exclusões (e não vão para a lixeira): tirar um contato do cartão,
tirar uma tag de um registro, desvincular um documento, arquivar cartão,
desativar usuário, motivo de perda ou tipo de atividade.

Mecanismo: a exclusão grava no item da lixeira tudo o que ela alterou no banco
(o registro e o que foi junto, na ordem), a partir do `change_log`. Restaurar
desfaz essas alterações de trás para frente (`src/db/trash.ts`).

## 2. Aviso depois de excluir

Toda exclusão mostra, no rodapé da tela:

> **Negócio “Escola Alfa”** — enviado para a lixeira. Pode ser restaurado em
> até 30 dias; depois será excluído definitivamente. **Restaurar** · Ver lixeira

- Em lote: "3 cartões foram enviados para a lixeira. Podem ser restaurados em
  até 30 dias; depois serão excluídos definitivamente."
- **Restaurar** desfaz na hora; **Ver lixeira** abre a tela.
- As confirmações de exclusão também avisam que o item vai para a lixeira.

## 3. Tela Lixeira (menu superior)

- Ícone de lixeira no menu superior, com o número de itens.
- Lista: item (nome e detalhe, ex.: "Negócio · Funil Vendas · +2 item(ns)
  junto"), tipo, quem excluiu, quando, e em quantos dias será excluído
  definitivamente (amarelo com 7 dias ou menos, vermelho com 3 ou menos).
- Busca, filtro por tipo, seleção de vários.
- **Restaurar** (item ou selecionados). Se depender de algo que também está na
  lixeira, explica: "Restaure antes o funil “Vendas”, que também está na
  lixeira." Se já existir um registro ativo igual (mesmo nome, e-mail, CNPJ),
  pede para renomear ou excluir o outro antes.
- **Excluir definitivamente** e **Esvaziar lixeira**: só o administrador, com
  confirmação.
- Quem vê: o administrador vê tudo; os demais usuários veem e restauram o que
  eles mesmos excluíram.

## 4. Configurações → Lixeira

- **Prazo até a exclusão definitiva**: padrão 30 dias, de 1 a 365, só o
  administrador altera (vale para todos). Guardado em `setting`
  (`trash.retention_days`), vai no backup.
- Abaixo, a mesma lista da tela Lixeira.
- O prazo também vale para a lixeira do GED.

## 5. Exclusão definitiva

- Automática quando o prazo vence (conferida sempre que o CRM é aberto) ou
  manual pelo administrador.
- As linhas saem do banco, com o histórico de alterações delas (fica só uma
  marca de exclusão no `change_log`), e com o que depende delas: vínculos de
  tags, valores de campos, vínculos com documentos, notas, vínculos com
  organizações, itens e histórico de etapas do cartão, lembretes...
- Registros ativos que apontavam para o excluído ficam sem ele (ex.: o cartão
  continua, sem o contato).
- Se um registro ativo ainda depende obrigatoriamente do excluído (ex.: etapa
  que aparece no histórico de um cartão ativo), ele fica só como marca de
  excluído, fora da lixeira e de todas as telas.
- Documentos: o arquivo é apagado (como já fazia o GED).
- Itens excluídos antes da versão 0.2.43 não aparecem na lixeira.
