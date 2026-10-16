# Justificativas para a aba "Privacidade" — Chrome Web Store (ConectCRM)

Cole cada texto no campo correspondente do Developer Dashboard.
Tudo abaixo reflete o que a extensão realmente faz (manifest.json + código).

---

## 1. Finalidade única (Single purpose)

> O ConectCRM tem uma finalidade única: capturar a conversa aberta no WhatsApp Web e
> registrá-la no CRM do usuário (Pipedrive ou HubSpot) como contato, negócio ou anotação,
> além de recursos de produtividade diretamente ligados a esse fluxo (resumo por IA,
> agendamento de reuniões, geração de cobranças e envio de documentos para assinatura).

---

## 2. Justificativa de cada permissão (permissions)

**activeTab**
> Usada para acessar a aba ativa do WhatsApp Web quando o usuário aciona a extensão,
> permitindo ler a conversa selecionada que ele deseja registrar no CRM.

**scripting**
> Necessária para injetar o script de conteúdo na página do WhatsApp Web e extrair o
> conteúdo da conversa que o usuário escolheu enviar ao CRM.

**storage**
> Armazena localmente as configurações e credenciais (chaves de API/tokens) que o próprio
> usuário insere, no modelo "traga sua própria chave". Esses dados ficam no navegador e
> não são enviados aos nossos servidores.

**unlimitedStorage**
> Permite armazenar localmente listas e dados de apoio das integrações (ex.: cache de
> templates de assinatura e registros locais) sem o limite padrão de cota, evitando perda
> de dados em uso intenso.

**tabs**
> Usada para identificar e abrir/focar a aba do WhatsApp Web e para o fluxo de
> autenticação OAuth (abrir a guia de login do Google/Microsoft e retornar à extensão).

**downloads**
> Permite que o usuário baixe arquivos gerados pela extensão (ex.: documentos e mídias
> de uma conversa) para o próprio computador.

**identity**
> Necessária para o login OAuth com o Google (Google Agenda), usando
> chrome.identity para obter o token de acesso à API de Calendar autorizada pelo usuário.

---

## 3. Justificativa dos host_permissions

**Versão para o campo do Dashboard (limite de 1.000 caracteres — este texto tem 940):**

```
Cada domínio é usado só quando o usuário ativa e configura o recurso:
web.whatsapp.com: ler a conversa a registrar no CRM.
*.pipedrive.com e api.hubapi.com: gravar contatos/negócios/notas no CRM escolhido.
generativelanguage.googleapis.com, api.openai.com, api.anthropic.com, api.deepseek.com: processar/resumir texto com IA e transcrever áudios (Whisper), se ativado.
www.googleapis.com: Google Agenda (criar/ler eventos) via OAuth.
graph.microsoft.com e login.microsoftonline.com: agenda do Outlook/365 e login OAuth.
extpipe.claudiacrm.com.br: servidor de licenciamento (validar licença/ativação).
brasilapi.com.br, minhareceita.org, www.receitaws.com.br: consultar dados públicos de empresas por CNPJ.
api.asaas.com e api-sandbox.asaas.com: gerar cobranças/links de pagamento.
api.zapsign.com.br: enviar documentos para assinatura eletrônica.
Todos esses recursos são opcionais e usam as próprias credenciais do usuário.
```

---

## 4. Uso de código remoto (Remote code)

> A extensão NÃO executa código remoto. Todo o código JavaScript está empacotado na
> extensão. As chamadas de rede acima transferem apenas dados (JSON), não código executável.

(No Dashboard, selecione a opção "Não, não estou usando código remoto".)

---

## 5. Declaração de uso de dados (Data usage)

Marque as categorias coletadas:

- [x] **Comunicações pessoais** — conteúdo de mensagens/áudios e contatos do WhatsApp Web selecionados pelo usuário.
- [x] **Informações de identificação pessoal** — nome, telefone, e-mail, CPF/CNPJ de contatos; e-mail/telefone do usuário para licenciamento.
- [x] **Informações de autenticação** — chaves de API/tokens e chave de licença (armazenadas localmente).
- [x] **Atividade do usuário** — somente se houver (em geral NÃO marcar; a extensão não rastreia navegação).

Responda às 3 certificações obrigatórias (todas devem ser marcadas como verdadeiras):

- [x] Não vendo nem transfiro dados do usuário a terceiros fora dos casos de uso aprovados.
- [x] Não uso nem transfiro dados do usuário para finalidades não relacionadas à finalidade única do item.
- [x] Não uso nem transfiro dados do usuário para determinar capacidade de crédito ou para empréstimos.

> NOTA (não é um campo a preencher): a aba "Coleta e uso de dados" é só caixas de seleção
> + as 3 certificações — não tem texto livre. O compartilhamento com terceiros (CRMs, IA,
> ASAAS, ZapSign, Microsoft, Google) NÃO se declara aqui; ele já fica explícito em dois
> lugares: (1) na justificativa dos host_permissions e (2) na seção 3 da Política de
> Privacidade. É permitido porque ocorre apenas para executar funções ativadas pelo usuário,
> dentro da finalidade única. Logo, nada extra a ajustar nesta seção.

---

## 6. Limited Use (Google Calendar)

> O uso dos dados das APIs do Google obedece à Política de Dados de Usuário dos Serviços de
> API do Google, incluindo os requisitos de Uso Limitado. Os dados da Google Agenda são
> usados apenas para fornecer funções visíveis ao usuário (criar e ler eventos), não são
> vendidos, não são usados para publicidade e não são lidos por humanos, salvo consentimento,
> suporte ou exigência legal.

(O texto correspondente já consta na seção 4 da Política de Privacidade.)

---

## 7. Checklist final antes de reenviar

- [ ] Política publicada em https://claudiacrm.com.br/privacidade (sem colchetes, abre sem login)
- [ ] URL da política colada no campo "Política de Privacidade" do Dashboard
- [ ] Finalidade única preenchida
- [ ] Justificativa de cada permissão preenchida
- [ ] Justificativa de cada host_permission preenchida
- [ ] "Não usa código remoto" selecionado
- [ ] Categorias de dados marcadas + 3 certificações marcadas
- [ ] Limited Use certificado (Calendar)
- [ ] Reenviar rascunho (NÃO usar "Contestação")
