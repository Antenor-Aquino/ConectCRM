# Especificação 07 — Copiloto de IA

> Status: **implementado na Fase 11**. ZapSign e Asaas ficaram pendentes por
> decisão do cliente.

Mesma lógica do Copiloto Financeiro da gestao-financeira-extensao: a IA
**nunca recebe o banco nem faz contas**. Ela escolhe quais consultas rodar; as
consultas são SQL de verdade no banco local (com a permissão do usuário) e
devolvem os valores já formatados; a IA só organiza esses números num card.

## 1. Onde fica

- Botão **Copiloto** no topo (qualquer tela): abre um painel lateral. A
  conversa continua enquanto o CRM estiver aberto; **Nova conversa** recomeça.
- No detalhe do cartão: **Perguntar ao Copiloto** abre o painel já pedindo o
  resumo do negócio (ou ticket/etapa) e o próximo passo.
- Perguntas por **áudio** (microfone): transcritas pelo Gemini ou OpenAI.
- Provedor e chave: Configurações → Inteligência artificial (Gemini, OpenAI,
  Claude ou DeepSeek — os quatro com consultas).

## 2. Consultas disponíveis para a IA

| Consulta | O que devolve |
|---|---|
| buscar_cartoes | Cartões por texto/situação/funil/responsável: etapa, valor, contato, dias na etapa, próxima tarefa, atrasadas, total e soma |
| detalhar_cartao | Um cartão: contato, itens, tarefas pendentes e concluídas, últimas notas, etapas percorridas com dias |
| resumo_comercial | Indicadores de um período (mesmos números da tela Relatórios) |
| listar_tarefas | Atrasadas (finalização vencida ou, sem finalização, início antes de hoje; da mais atrasada para a menos), de hoje, próximos 7 dias ou pendentes |
| negocios_parados | Abertos sem movimento (etapa, tarefa concluída ou nota) além do limite da etapa (ou 14 dias, ou o informado) |
| buscar_contatos | Pessoas e organizações por nome, e-mail ou telefone, com os cartões abertos |
| estrutura_do_crm | Funis e etapas, usuários, equipes, motivos de perda, tipos de tarefa |

Nomes de funil, usuário ou equipe aceitam parte do nome; sem correspondência,
a consulta devolve as opções e o Copiloto pergunta qual é.

## 3. Resposta (card)

Título, subtítulo, até 3 destaques (valor-chave em negrito; vermelho para
risco, verde para resultado positivo), tabela quando há linhas comparáveis
(com **Exportar Excel**), **sugestões** para continuar e **ações**.

As sugestões são escritas como o próximo pedido do usuário, no imperativo e
sem "?" (ex.: "Crie o cartão Conserto Gaveta Miguel no funil Casa"): o
clique envia o texto como se o usuário tivesse digitado. "Sim", "pode" ou
"crie" confirmam o que o Copiloto ofereceu na resposta anterior.

## 4. Ações sugeridas

A IA pode sugerir até 3 ações por resposta, só com cartões que vieram das
consultas: **criar tarefa** (título e data/hora), **adicionar nota**,
**abrir o cartão** ou **criar cartão** (título, funil e etapa; depois de
criado, o botão abre o cartão). Pedido claro de criação não vira pergunta:
o Copiloto confere o funil/etapa e se já existe cartão parecido e entrega o
botão pronto. A busca de cartões tolera nomes ditados com erro ("Concerto"
acha "Conserto"). Nada é gravado sem o clique do usuário; a tarefa é
criada para o usuário atual e vinculada ao cartão.

## 5. Permissões e privacidade

- As consultas seguem a permissão do usuário (vendedor vê só os seus
  cartões; gestor, os da equipe; administrador, todos).
- Vai para o provedor de IA só o que a pergunta precisa: a pergunta, o
  histórico da conversa e o resultado das consultas feitas (nunca o banco
  inteiro). A chave fica só neste computador.

## Ajustes (0.2.9)

- A cada pergunta o Copiloto consulta o CRM de novo (tarefas e negócios
  criados durante a conversa entram na resposta); nunca repete uma resposta
  anterior sem consultar.
- "Eu/meu/minhas" = o usuário atual (filtra pelo responsável).

## Copiloto aberto num cartão (0.2.13)

- Aberto pelo "Perguntar ao Copiloto" do cartão ou pelo botão do topo com o
  cartão aberto (em tela cheia), a conversa se refere a esse cartão: uma
  barra mostra "Conversa sobre o cartão X".
- "Crie uma tarefa…", "adicione uma nota…", "resuma", "próximo passo" valem
  para ele, a não ser que o pedido cite outro cartão, contato ou funil.
  Ação sem cartão indicado usa o cartão aberto.
- **Nova conversa** continua no mesmo cartão; **Geral** (na barra) volta
  para o CRM todo.
- Pedido de tarefa ditado ("criou a tarefa X para dia 18 às 8 horas") vira
  a ação criar tarefa pronta; tabela sem linhas não é exibida.
