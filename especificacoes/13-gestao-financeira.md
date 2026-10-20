# 13 — Integração com a Gestão Financeira

Plano aprovado (20/10/2026): o **dinheiro mora na Gestão Financeira**; o CRM
lança pelos cartões (abrindo as telas de lançamento dela) e mostra uma cópia
de leitura. A Gestão Financeira ganha **Clientes e fornecedores** (PF/PJ),
e cada lançamento pode ter cliente/fornecedor, categoria/subcategoria e
projeto/subprojeto (opcionais), além da origem (cartão do CRM). A Gestão
Financeira é usada para finanças pessoais **e** da empresa: antes da
integração dos cartões ela separa por **carteira** (Pessoal / Empresa), para
receitas de clientes não entrarem na DRE pessoal.

Decisões do usuário: cadastro "Clientes e fornecedores"; CPF opcional no
contato do CRM; cliente/fornecedor padrão ao lançar pelo cartão = organização
do cartão, senão o contato principal, senão o CRM pede um dos dois; todos
veem os valores financeiros no CRM; formas de integração direta (mesmo Chrome)
e, opcional, por pacote de arquivo.

| Fase | Entrega |
|---|---|
| 0 | Banco da Gestão Financeira sincronizado entre janelas; pareamento entre as extensões; Configurações → Integrações → Gestão Financeira no CRM |
| 1 | Gestão Financeira: carteiras, Clientes e fornecedores, campo no lançamento/importações, relatórios por pessoa |
| 2 | CRM: aba Financeiro no cartão (+ Receita / + Despesa abrem a tela da Gestão Financeira), vínculo da pessoa, retorno automático, CPF |
| 3 | Visão financeira no CRM: resultado do cartão, financeiro do cliente, Relatórios → Financeiro |
| 4 | Modo pacote e extras (Copiloto, alertas) |

## Fase 0 (CRM 0.2.54 · Gestão Financeira 0.0.2)

### Por que pareamento (e não ID fixo)
Os dados de cada extensão ficam presos ao ID dela. Fixar um ID ("key" no
manifest) trocaria o ID das instalações atuais e os dados ficariam
inacessíveis; a Chrome Web Store também dá outro ID. Então:

1. O CRM encontra a Gestão Financeira instalada neste Chrome
   (`chrome.management`, pelo nome; dá para informar o ID manualmente).
2. "Conectar" envia `hello`; a Gestão Financeira guarda o pedido e abre o
   painel com **"Conectar ao ConectCRM? Permitir / Recusar"**.
3. Permitido, as duas só aceitam mensagens uma da outra (o ID do CRM fica
   guardado na Gestão Financeira; o da Gestão Financeira, no CRM).
4. Reinstalou de outra pasta (ID novo): pareia de novo (a Gestão Financeira
   avisa que substitui a conexão anterior).

Protocolo versionado (`src/lib/finance/protocol.ts`, mesmo arquivo nos dois
repositórios): `hello` e `ping`; respostas `paired` (com versão e ambiente
Produção/Teste), `pending`, `refused`, `not-paired`, `protocol`, `invalid`.
O CRM avisa quando a Gestão Financeira está no Ambiente de Teste.

### Configurações → Integrações → Gestão Financeira (CRM, admin)
Status (encontrada / conectada, versão, ambiente, desde), **Conectar**
(espera a permissão até 3 min), **Testar conexão**, **Desconectar**, ID
manual e as formas de integração (direta / pacote) — guardadas neste
computador (`conectcrm-gestao-financeira`).

### Gestão Financeira: banco em várias janelas
Antes, cada página (painel, popup) tinha sua cópia do banco e a última a
gravar apagava o que a outra fez. Agora o snapshot tem revisão; cada página
anota suas escritas e, se outra gravou antes, carrega o banco novo e
**reaplica as suas por cima** (o conflito raro — ex.: o mesmo nome único nas
duas — é descartado e avisado). As páginas sem escrita pendente passam a ler o
banco novo e mostram "Os dados foram alterados em outra janela · Atualizar".

## Fase 2 (CRM 0.2.55 · Gestão Financeira 0.0.5) — lançar pelo cartão

### No CRM: aba **Financeiro** do cartão
- **+ Receita / + Despesa** abrem, numa janela, a **tela de lançamento da
  própria Gestão Financeira**, já preenchida: descrição (título do cartão),
  valor (receita: o que falta lançar do valor do cartão; despesa: vazio),
  carteira **Empresa** e o **cliente/fornecedor**. Categoria/subcategoria,
  projeto/subprojeto, conta, vencimento, parcelas e recorrência são
  escolhidos lá, no momento do lançamento. Lançar é opcional: cartão sem
  lançamento só mostra "Nenhum lançamento".
- Cliente/fornecedor = **organização do cartão** (PJ, com CNPJ); sem ela, o
  **contato principal** (PF, com o CPF novo do contato). Sem nenhum dos dois,
  os botões avisam: "vincule uma organização ou um contato a este cartão".
- Na Gestão Financeira, a pessoa é achada pelo vínculo com o CRM, depois
  pelo CPF/CNPJ, depois pelo nome exato (e o vínculo é gravado); não
  existindo, é cadastrada em Clientes e fornecedores (a janela avisa).
- A lista (vencimento, código, categoria, projeto, conta/cartão, situação
  Em aberto / Atrasado / Recebido / Pago) e o resumo (**Receitas, Despesas,
  Resultado**, previsto e realizado) vêm da Gestão Financeira; são lidos ao
  abrir a aba, ao voltar para a janela do CRM e quando a janela de lançamento
  fecha. Clicar num lançamento abre a edição dele na Gestão Financeira.
- Cópia local (`finance_entry`/`finance_sync`, fora do change_log): com a
  Gestão Financeira desativada ou sem resposta, a aba mostra a última cópia
  ("Mostrando a cópia de dd/mm hh:mm") e os botões ficam desativados. A
  contagem da aba usa a cópia. Ela também servirá aos relatórios da Fase 3.
- **Ganho com valor**: ao marcar como ganho, com a Gestão Financeira
  conectada, o CRM pergunta "Lançar a receita de R$ X na Gestão
  Financeira?" e abre a janela da receita.
- Contato ganhou **CPF** (opcional, validado, sem repetir).
- Todos os usuários veem os valores (decisão do usuário).

### Na Gestão Financeira
- Protocolo **2**: `openLaunch` (guarda o pedido em `chrome.storage.session`
  e abre `src/launch/launch.html` numa janela) e `listByOrigin` (o service
  worker lê uma **cópia só de leitura** do banco — não precisa do painel
  aberto). Ambos só para o CRM pareado; pedidos malformados são recusados.
- Lançamento com **origem** (`origin_app`, `origin_ref` = id do cartão,
  `origin_label`): gravada em lançamento simples, recorrente, parcelado no
  cartão e no saldo do pagamento parcial; editar não muda a origem.
- A janela de lançamento respeita a Senha de Acesso, avisa quando está no
  Ambiente de Teste e grava pelo banco sincronizado (o painel aberto recebe
  a alteração). Só edita lançamentos daquele cartão.
- Em Lançamentos, etiqueta **ConectCRM** nos lançamentos vindos do CRM.

## Fase 3 (CRM 0.2.56 · Gestão Financeira 0.0.6) — visão financeira no CRM

- **Leitura geral**: `listByOrigin` sem `refs` devolve todos os lançamentos
  vindos do CRM (Gestão Financeira 0.0.6). Com a 0.0.5, o CRM pede em lotes de
  500 cartões. A cópia local é substituída inteira (`finance.replaceAll`) e
  marca a hora da leitura; cada tela filtra pela permissão do usuário.
- **Cartão**: abaixo do valor, faixa com Receitas, Despesas, Resultado (e
  margem) e atrasados; clicar abre a aba Financeiro.
- **Relatórios → Financeiro** (seletor Comercial / Financeiro no topo):
  - filtros: período, **base** (Competência; Vencimento; Caixa = só o que foi
    pago/recebido, pela data do pagamento), funil (todos os tipos), situação
    do cartão, responsável/equipe;
  - indicadores: receitas, despesas, resultado e margem, realizado (recebido −
    pago), a receber e a pagar (com atrasados);
  - receitas × despesas por mês; resultado por cliente (organização do
    cartão, senão o contato principal), por cartão (com o valor do cartão
    para comparar), por funil e por categoria/subcategoria;
  - **Ganhos com receita a lançar**: cartões ganhos no período cujo valor
    ainda não foi todo lançado como receita;
  - exportação para Excel (uma aba por relatório). Lê da Gestão Financeira ao
    abrir e no "Atualizar"; sem ela, usa a última cópia (e avisa).
- **Organização e contato → aba Financeiro**: totais do cliente (receitas,
  despesas, resultado, a receber e atrasado), receitas em aberto por
  vencimento e o resultado de cada cartão (organização: cartões dela;
  contato: cartões em que é o contato principal).

## Fase 4 (CRM 0.2.57 · Gestão Financeira 0.0.7) — pacote, Copiloto e alertas

### Modo pacote de arquivo (quando as extensões não estão no mesmo Chrome)
Ligado em Configurações → Integrações → Gestão Financeira ("Por pacote de
arquivo"). Ida e volta:
1. **CRM, aba Financeiro do cartão**: sem a Gestão Financeira por perto,
   Receita/Despesa abrem um **pedido** (descrição, valor — a receita sugere o
   que falta lançar —, vencimento, competência, observação). Os pedidos ficam
   no cartão ("aguardando exportação" / "exportado · aguardando o retorno") e
   dá para desistir (`finance_request`, migration 0019).
2. **CRM, Integrações → Exportar pacote**: arquivo
   `conectcrm-pedidos-financeiro-AAAA-MM-DD.json` com os pedidos ainda não
   confirmados (os exportados vão de novo até voltarem: a Gestão Financeira
   ignora repetidos).
3. **Gestão Financeira, Importar → Pacote do ConectCRM**: lista os pedidos
   (novo / lançado); **Revisar e lançar** abre a tela de lançamento preenchida
   (inclusive datas, observação e carteira Empresa) e **Lançar os novos sem
   revisar** cria em aberto, sem categoria/conta. Cada lançamento guarda o
   pedido (`origin_request`, migration 0014): o mesmo pedido nunca entra duas
   vezes (nem depois de excluído).
4. **Gestão Financeira → Exportar retorno para o ConectCRM**: todos os
   lançamentos vindos do CRM; **CRM → Importar retorno** substitui a cópia
   (cartões, relatórios, cliente) e marca os pedidos como lançados.
Formato versionado em `protocol.ts` (`PACKAGE_FORMAT`, `parsePackage`).

### Copiloto
- `resumo_financeiro` (período, base competência/vencimento/caixa, funil,
  responsável): mesmos números de Relatórios → Financeiro, com melhores e
  piores cartões, clientes, funis, categorias e ganhos com receita a lançar.
- `pendencias_financeiras`: receitas atrasadas (dias de atraso), a vencer em
  7 dias, despesas atrasadas e ganhos com receita a lançar.
- `detalhar_cartao` traz o financeiro do cartão. As ferramentas leem a
  Gestão Financeira antes de responder (ou usam a última cópia); o "como
  estou / pontos de atenção" inclui as pendências financeiras.

### Alertas
- **Resumo diário** (Notificações): bloco "Financeiro" com receitas
  atrasadas (cartão, cliente, valor, dias), a vencer em 7 dias, ganhos há 3+
  dias com receita a lançar (descontando pedidos no pacote) e despesas
  atrasadas — dos cartões do usuário; só quando a integração está em uso.
- O service worker do CRM lê a Gestão Financeira a cada 3 h (modo direto)
  para os alertas usarem dados recentes.
