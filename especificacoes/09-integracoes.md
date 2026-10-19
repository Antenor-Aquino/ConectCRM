# Especificação 09 — Integrações (Pipedrive)

> Status: **implementado** (versões 0.2.35 e 0.2.36). Importa do Pipedrive
> leads, negócios, contatos e organizações, com as notas, de-para e controle do
> que já foi importado.

## 1. Configurações → Integrações

- Só **administradores** veem e usam (as chamadas de importação também
  conferem o papel).
- Uma entrada por integração (por enquanto só o Pipedrive), com a situação:
  Ativa, Inativa ou Não configurada.
- **Pipedrive**:
  - **Chave da API** (token pessoal: Pipedrive → Configurações pessoais → API);
  - **Endereço da conta** (ex.: `suaempresa.pipedrive.com`), preenchido
    automaticamente ao conectar, usado só para abrir o registro original;
  - **Conectar / Salvar e testar conexão**: pede a permissão de acesso a
    `api.pipedrive.com` (permissão opcional, para a atualização não desativar a
    extensão), consulta `/v1/users/me` e mostra a conta e o usuário;
  - **Integração ativa**, **Desconectar** (apaga a chave; o que já foi importado
    fica) e **Importar do Pipedrive**.
- Os parâmetros ficam só neste computador (`chrome.storage.local`), como as
  chaves de IA; não vão para o backup.

## 2. Importar do Pipedrive

Janela com as abas **Leads**, **Negócios**, **Contatos** e **Organizações**.

### 2.1 Buscar

- **Pelo nome** (contatos também por e-mail e telefone), mínimo de 2 letras:
  busca da API (`/api/v2/{persons|organizations|leads}/search`) e depois os
  registros completos.
- **Pela data de criação** (de / até): a API não filtra por criação, então a
  lista é lida do mais novo para o mais antigo (`sort_by=add_time`) e para ao
  passar da data inicial. Limite de 2.000 registros por busca (aviso para
  diminuir o período).
- Limite de uso da API (429): espera o tempo indicado e tenta de novo (até 5
  vezes).

### 2.2 Escolher

Cada registro aparece com a **situação no CRM**:

| Situação | Quando | Ao importar |
|---|---|---|
| **Novo** | Sem vínculo e sem parecido | Cria (vem marcado) |
| **Já importado** | Vinculado a um registro do CRM (mostra "alterado no Pipedrive" se mudou depois) | Vem desmarcado; marcado = **atualiza** |
| **Possível duplicado** | Mesmo e-mail/celular (contato), CNPJ (organização) ou nome no CRM, ainda sem vínculo | Escolha: vincular e atualizar (padrão), vincular sem alterar, ou criar um novo |

O vínculo fica na tabela `external_ref` (integração, tipo, id de origem,
registro local, data da última alteração na origem e da importação). Um
registro de origem aponta para um registro local por vez.

### 2.3 De-para

1. **Campos**: cada campo do Pipedrive (padrão e personalizados, com o valor
   já legível: opções pelo rótulo, usuários pelo nome, endereço por partes) com
   um exemplo dos selecionados → campo do CRM ou "não importar". Cada destino
   só uma vez. Sugestão automática: campos padrão (nome, e-mail, telefone,
   responsável, etiquetas → tags, endereço → logradouro/número/bairro/cidade/
   estado/CEP/país; título, valor, previsão, origem do lead) e personalizados
   pelo nome (ex.: "CNPJ" → CNPJ, "Ramo de atividade" → Segmento, "Origem do
   contato" → campo personalizado de mesmo nome). Campos sem valor nos
   selecionados ficam recolhidos.
2. **Valores**: responsável (usuário do Pipedrive → usuário do CRM, "quem
   importa" ou "sem responsável"; sugerido pelo e-mail/nome) e campos de
   lista/múltipla escolha (valor → opção do CRM, ou deixar vazio).
3. **Leads**: funil **comercial** e etapa de destino; cada lead vira um
   **cartão (negócio)**.
4. **Negócios — de-para das etapas**: cada etapa do Pipedrive usada pelos
   negócios escolhidos ("Funil › Etapa", com a quantidade) → etapa de um funil
   comercial do CRM. Sugestão pelo nome (no funil de mesmo nome primeiro);
   sem sugestão, a escolha é obrigatória. Cada negócio vira um cartão no funil
   da etapa escolhida.
5. **Importar também as notas** (marcado por padrão; fica salvo).

O de-para fica salvo por tipo neste computador e volta preenchido.

### 2.4 Importar

- Relacionados entram antes: a organização do contato; o contato e a
  organização do lead. Os que não estão no CRM são criados (com o de-para
  salvo deles ou o sugerido); os parecidos são vinculados sem alterar; os já
  importados são usados.
- Cada registro é gravado numa transação (tudo ou nada). Campos vazios no
  Pipedrive **não apagam** o que o CRM tem; tags são somadas às existentes.
  E-mail, telefone ou CNPJ inválidos (ou CNPJ já em outra organização) ficam
  de fora com **aviso**, sem impedir o resto.
- Em lotes de 100, com progresso. Resumo: criados, atualizados, vinculados,
  relacionados criados/vinculados, avisos e erros (com o nome do registro).

### 2.5 Negócios

- Situação: **ganho** e **perdido** são mantidos, com a data de fechamento do
  Pipedrive; o motivo da perda vira o motivo cadastrado de mesmo nome
  (Configurações → Motivos de perda) ou, se não houver, a observação da perda.
- Data de criação do Pipedrive vira a do cartão (relatórios por período ficam
  fiéis); o mesmo para leads.
- Contato e organização do negócio entram junto, como nos leads.
- Atualizar um negócio já importado: muda os campos do de-para, **move** o
  cartão se a etapa mudou no Pipedrive e acompanha a situação (reaberto,
  ganho, perdido).

### 2.6 Notas

- Depois de gravar os registros, busca as notas de cada um no Pipedrive
  (`GET /v1/notes?person_id|org_id|lead_id|deal_id=…`, uma chamada por
  registro) e grava no registro correspondente do CRM (cartão, contato ou
  organização).
- O texto vem sem formatação (as notas do CRM são texto), começando por "Nota
  do Pipedrive · autor"; mantém a data original e a fixação.
- Uma nota ligada a vários registros no Pipedrive (lead, contato e
  organização) entra uma vez em cada registro importado. Notas já trazidas
  são ignoradas (vínculo nota + registro), então reimportar ou atualizar só
  traz as novas.
- Só as notas dos registros escolhidos; as dos relacionados (importados junto)
  vêm quando eles forem importados pela própria aba.

## 3. Origem no cadastro

No detalhe do cartão (abaixo do X) e nas janelas de editar contato e
organização: **"Importado do Pipedrive em dd/mm/aaaa ↗"**, com link para o
registro original (contato, organização, lead ou negócio) quando o endereço
da conta está configurado.

## 4. API usada

| Uso | Chamada |
|---|---|
| Testar conexão | `GET /v1/users/me` |
| Usuários | `GET /v1/users` |
| Campos | `GET /v1/personFields`, `/v1/organizationFields`, `/v1/dealFields` (leads usam os campos de negócio) |
| Etiquetas de lead | `GET /v1/leadLabels` |
| Listar | `GET /api/v2/persons`, `/api/v2/organizations`, `/api/v2/deals` (cursor); `GET /v1/leads` (start/limit) |
| Buscar | `GET /api/v2/{persons,organizations,leads,deals}/search` |
| Funis e etapas | `GET /api/v2/pipelines`, `/api/v2/stages` (contas antigas: `/v1/…`) |
| Notas | `GET /v1/notes` com `person_id`, `org_id`, `lead_id` ou `deal_id` |
| Por id | `GET /api/v2/persons?ids=…` (em lotes) ou `/{id}`; `GET /v1/leads/{id}` |

Autenticação pelo cabeçalho `x-api-token`. Formatos v1 e v2 (custom fields na
raiz ou em `custom_fields`, e-mails/telefones em `email`/`emails`) são
aceitos.
