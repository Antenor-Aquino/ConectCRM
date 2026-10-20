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
