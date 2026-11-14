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

## Fase 1 — cadastro fiscal (0.2.102, empresa escolhida a cada nota na 0.2.103)

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
