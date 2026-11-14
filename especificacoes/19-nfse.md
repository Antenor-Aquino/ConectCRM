# 19 — Nota fiscal de serviço (NFS-e Nacional)

## Objetivo
Emitir a NFS-e do negócio a partir do cartão:
- um botão abre o formulário já preenchido;
- os campos obrigatórios que faltam ficam apontados;
- o usuário ajusta, confirma e autoriza a emissão.

## Contexto (pesquisa de nov/2026)
- **Empresas emissoras:** duas empresas do Simples Nacional, cerca de 20 notas por mês no total:
  - 28.288.572/0001-37, com certificado A1;
  - 68.153.622/0001-93, com certificado A3 (token).
- **Emissor obrigatório:** desde 01/11/2026 o Simples emite exclusivamente pelo
  Emissor Nacional (`www.nfse.gov.br/EmissorNacional`). Os campos de IBS/CBS só
  passam a ser exigidos do Simples em 2027.
- **Login no portal:** usuário e senha, certificado digital ou gov.br (prata ou
  ouro, com troca de perfil para o CNPJ).
- **Emissão completa no portal, em 4 passos:** Pessoas → Serviço → Valores → Emitir.
  O portal também tem rascunho de DPS e serviços favoritos.
- **API Sefin Nacional:**
  - emissão em `POST /nfse` (DPS em XML assinado);
  - consulta em `GET /nfse/{chave}`;
  - eventos em `/nfse/{chave}/eventos`;
  - parâmetros municipais em `/parametros_municipais`;
  - exige a conexão autenticada pelo certificado ICP-Brasil.

## Decisão: preencher o Emissor Nacional no Chrome
- **API direta descartada:** a extensão do Chrome não consegue apresentar o
  certificado na conexão nem assinar com o A3 sem um programa instalado no
  computador.
- **Intermediário pago (Focus, PlugNotas…) descartado:**
  - precisa do arquivo do certificado, e o A3 não tem arquivo;
  - a 20 notas por mês, o custo não se justifica.
- **Escolha:** no portal, o login com certificado (A1 ou A3) é feito pelo próprio
  Chrome. A extensão só preenche os passos com os dados do CRM, e o usuário confere
  e clica em **Emitir**. É o mesmo modelo do envio pelo WhatsApp Web.

## Fases
| Fase | Entrega |
|---|---|
| 0 | Mapear o portal (produção restrita): campos e botões de cada passo. Precisa das páginas salvas pelo usuário. |
| 1 | Cadastro fiscal: empresas emissoras, código de tributação nos serviços, tabelas oficiais (municípios IBGE, lista nacional de serviços, NBS) e regras de pendência. |
| 2 | Botão "Emitir NFS-e" no cartão: formulário preenchido, lista de pendências e rascunho salvo no cartão. |
| 3 | Emitir: pergunta por qual empresa emitir, confere a empresa logada no portal, preenche os 4 passos e para na tela final para o usuário clicar em Emitir. |
| 4 | Retorno: número, chave, PDF e XML no cartão e no GED, status, cancelamento e receita na Gestão Financeira. |

## Fase 1 — cadastro fiscal (0.2.102; empresa escolhida a cada nota na 0.2.103; textos personalizados na 0.2.104)

### Empresas emissoras (Configurações → Nota fiscal)
- Tabela `nfse_issuer`, com estes campos:
  - CNPJ (validado e único);
  - razão social;
  - inscrição municipal (opcional);
  - município (código IBGE);
  - tipo de acesso ao portal (certificado A1, certificado A3 ou gov.br);
  - situação no Simples Nacional (`opSimpNac`: 1 não optante, 2 MEI, 3 ME/EPP);
  - regime especial municipal (`regEspTrib`, padrão 0, nenhum);
  - ativa.
- **A empresa é escolhida a cada nota (0.2.103):** ao clicar para emitir, o CRM
  pergunta por qual empresa sai a nota. Com uma única empresa ativa, ela já vem
  escolhida. Não há vínculo fixo funil → empresa: a 0.2.102 tinha esse vínculo,
  e a migration `0033_nfse_sem_funil.sql` removeu a tabela `nfse_pipeline_issuer`.
- O botão "Buscar dados" preenche a razão social e o município pela consulta de
  CNPJ que o CRM já tem.

### Serviços (Configurações → Produtos e serviços)
- Em serviço (`kind = servico`), entram dois campos:
  - **Código de tributação nacional** (`nfse_trib_nac`, 6 dígitos, da lista
    nacional, com busca por código ou descrição);
  - **NBS** (`nfse_nbs`, 9 dígitos, opcional no leiaute atual).
- **Descrição na nota:** vem da descrição do produto; sem ela, vem o nome.

### Tabelas oficiais (Anexos A e B do gov.br)
- `src/lib/nfse/municipios.json`: 5.570 municípios (código IBGE, nome, UF).
- `src/lib/nfse/listas.json`: 338 códigos de tributação nacional e 918 códigos
  NBS de 9 dígitos.
- **Código IBGE do tomador:** sai da cidade e da UF do endereço da organização,
  sem coluna nova. Por isso esta fase não mexe em `organization` e a regra de
  paridade com a Gestão Financeira não se aplica.

### Textos personalizados de cada nota (0.2.104)
A discriminação dos serviços e a observação mudam de cliente para cliente
(processo de compra, empenho, prazo, dados bancários…). Por isso são revisadas
a cada nota.

**Campos do leiaute**
| Campo | Leiaute | Limite |
|---|---|---|
| Discriminação dos serviços | `xDescServ` | 1000, obrigatória |
| Observação (informações complementares) | `xInfComp` | 2000 |
| Nº do pedido / processo de compra | `xPed` | 60 |

**Modelos por empresa** (Configurações → Nota fiscal)
- Um modelo de discriminação (padrão `{itens}`) e um de observação.
- Os botões de campo inserem no texto selecionado.
- Campos disponíveis:
  - `{itens}`: um item por linha, com a quantidade quando maior que 1;
  - `{cliente}` e `{documento_cliente}`;
  - `{cartao}` e `{pedido}`;
  - `{competencia}` (MM/AAAA) e `{valor}`.

**Como o texto da nota é preenchido** (`nfse_draft`, um por cartão)
1. Se o cartão já tem os textos salvos, valem eles.
2. Se não tem, a discriminação vem do modelo da empresa.
3. A observação vem da última nota do mesmo cliente. Se ele ainda não teve
   nota, vem do modelo.

A empresa escolhida também fica salva no rascunho.

**Pendências que impedem a emissão**
- textos ainda não revisados e salvos no cartão;
- discriminação vazia ou acima de 1000 caracteres;
- observação acima de 2000 ou nº do pedido acima de 60;
- campo `{x}` que sobrou sem preencher.

**Tela de emissão (Fase 2)**
- Os dois textos aparecem em destaque, editáveis e com contador de caracteres.
- Mostra de onde veio a observação ("da última nota deste cliente").
- Tem um botão para reaplicar o modelo.
- A emissão só é liberada depois de salvar os textos.

### Rascunho e pendências (base da Fase 2)
- `nfseDraftForCard(cartão, { issuerId })` monta o rascunho a partir do cartão:
  - a empresa escolhida (sem escolha, a única ativa) e a lista de empresas
    ativas para escolher;
  - o tomador, que é a organização do cartão (CNPJ, razão social, endereço e
    IBGE) ou, sem organização, o contato (CPF e nome);
  - os serviços dos itens do negócio;
  - o valor dos itens ou, sem itens, o valor do negócio;
  - a competência (hoje);
  - o local da prestação (município da empresa).
- `nfsePending` lista as pendências, cada uma com o campo e o texto para o
  usuário. Exemplos:
  - empresa a escolher, quando há mais de uma ativa, ou nenhuma cadastrada;
  - tomador sem CNPJ/CPF ou sem nome;
  - CNPJ/CPF inválido;
  - endereço do tomador incompleto, quando informado, ou município sem código IBGE;
  - item sem código de tributação nacional;
  - valor zerado;
  - item do tipo produto, que não entra na NFS-e (fica como aviso).
- Os obrigatórios seguem o leiaute oficial (Anexo I v1.01, DPS):
  - **prestador:** CNPJ, `opSimpNac`, `regEspTrib`;
  - **tomador:** CNPJ ou CPF e nome; com endereço, município IBGE, CEP,
    logradouro, número e bairro;
  - **serviço:** local da prestação, `cTribNac` e descrição;
  - **valores:** valor do serviço.

### Testes
- `tests/nfse.test.ts`:
  - validação das empresas e escolha da empresa na hora de emitir;
  - código IBGE pela cidade e UF;
  - rascunho a partir do cartão;
  - pendências.

## Fase 2 — botão "Nota fiscal" no cartão (0.2.105)
O botão **Nota fiscal** fica na barra de ações do cartão e abre a janela da nota
(`NfseDialog`) já preenchida.

**Partes da janela**
- **Pendências no topo:**
  - vermelho impede a emissão; amarelo só avisa;
  - sem pendências, aparece "Tudo preenchido: a nota está pronta para emitir";
  - as pendências dos textos são calculadas ao vivo, enquanto o usuário digita.
- **Emitir por:** um cartão para cada empresa ativa. Com uma só, ela já vem
  escolhida. A escolha fica salva no rascunho.
- **Tomador:** nome, CNPJ/CPF, endereço e código IBGE. O link **Corrigir
  cadastro** abre a organização ou o contato e, ao salvar, a janela relê os
  dados sem perder os textos.
- **Serviço:** código e descrição da lista nacional, valor, competência e local
  da prestação (o município da empresa).
- **Textos desta nota**, em destaque:
  - nº do pedido / processo de compra;
  - discriminação (contador 0/1000) e observação (contador 0/2000);
  - a origem de cada texto: salvo no cartão, da última nota do cliente ou do
    texto padrão;
  - **Reaplicar texto padrão** troca os textos pelo modelo da empresa, já com o
    nº do pedido digitado (`nfse.draft { fromTemplate, orderNumber }`).

**Botões**
- **Atualizar dados:** relê o cartão depois de corrigir produtos ou cadastro.
- **Salvar rascunho:** grava os textos e a empresa no cartão.
- **Emitir no Emissor Nacional:** só habilita sem pendências e com os textos
  salvos. Nesta versão, avisa que o preenchimento do portal chega na fase 3.

Ao fechar com textos alterados e não salvos, a janela pede confirmação.

## Fase 3 — emitir pelo Emissor Nacional (0.2.106)

**Ambiente** (Configurações → Nota fiscal)
- Produção restrita (testes, sem valor fiscal) ou produção. O padrão é a produção
  restrita.
- Passar para produção pede confirmação.
- A escolha fica neste computador (`conectcrm-nfse`).

**Permissão:** a do site do ambiente (`www.producaorestrita.nfse.gov.br` ou
`www.nfse.gov.br`) é pedida no primeiro uso (`optional_host_permissions`).

**"Emitir no Emissor Nacional" na janela da nota**
1. Pede confirmação com o valor, o tomador, a empresa e o ambiente.
2. Abre o portal, ou traz a aba para a frente se já estiver aberta.
3. Fica esperando a nota voltar e atualiza a janela sozinha.

**Painel do ConectCRM dentro do portal** (`lib/nfse/assistant.ts`)
- O service worker injeta o painel em cada página que carrega naquela aba.
- **Empresa:** procura o CNPJ da empresa da nota na página. Se achar o de outra
  empresa cadastrada, avisa para trocar o perfil ou o certificado.
- **Etapas Pessoas, Serviço e Valores:** cada uma mostra os campos com o valor e
  um botão **Copiar**. A etapa atual é reconhecida pelos campos na tela.
- **Preencher a etapa:**
  - acha cada campo pelo rótulo do guia oficial (Guia do Emissor Web v1.3), com
    o bloco da tela levado em conta (o CPF/CNPJ do tomador não se confunde com o
    do prestador);
  - preenche e contorna de verde o campo preenchido;
  - nos campos com lista de sugestões (município, código de tributação, NBS),
    digita e escolhe a sugestão;
  - mostra o que não achou ("copie e cole").
- **Lembretes:** município do tomador (o portal busca pelo CEP), retenção do
  ISSQN, valor aproximado dos tributos / alíquota do Simples. O usuário é quem
  clica em Avançar e em Emitir NFS-e.
- **Tela "NFS-e Gerada com sucesso":** o painel lê a chave de acesso (50
  caracteres) e o número da nota, que podem ser corrigidos. **Trazer nota para
  o CRM** grava no cartão.

**Campos preenchidos** (`portalSteps.ts`)
- **Pessoas:** data de competência, tomador no Brasil, CPF/CNPJ, nome/razão
  social, CEP, logradouro, número, complemento, bairro, e-mail. O município do
  tomador fica só para copiar.
- **Serviço:** município do local da prestação, código de tributação nacional,
  NBS, descrição do serviço, informações complementares, nº do pedido.
- **Valores:** valor da operação/serviço prestado.

**Nota emitida** (`nfse.markIssued`, migration `0035_nfse_emitida.sql`)
- O rascunho do cartão vira emitido, com número, chave, ambiente e data.
- Entra uma nota no histórico do cartão.
- O rascunho fica travado: não salva mais e não emite de novo.
- Ler a mesma nota de novo não duplica.

**Teste no Chrome:** feito num portal simulado, com os rótulos e as etapas do
guia oficial. O portal de verdade precisa de login. O primeiro uso deve ser em
produção restrita. Se algum campo não for achado, o painel mostra qual, e o nome
dele no portal ajusta o preenchimento.
