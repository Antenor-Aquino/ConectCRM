# Configuração do Google OAuth — WhatsApp → Pipedrive

## SEU ID FIXO DE EXTENSÃO
obhgddehjknmdjbnoiaogkhenpcpkjil

Esse ID agora é permanente (graças à chave pública embutida no manifest.json).
Ele vale no carregamento local E quando você publicar na Chrome Web Store.

## ARQUIVOS IMPORTANTES (guarde em local seguro, NÃO publique)
- extension_private_key.pem  → chave privada. Necessária para empacotar/publicar
  com o MESMO id. Se perder, o id muda. NÃO suba para a Web Store nem para git.

## PASSO A PASSO NO GOOGLE CLOUD

### 1. Projeto + API
1. Acesse console.cloud.google.com e crie (ou selecione) um projeto.
2. Menu → "APIs e serviços" → "Biblioteca".
3. Procure "Google Calendar API" e clique em ATIVAR.

### 2. Tela de consentimento OAuth
1. "APIs e serviços" → "Tela de consentimento OAuth".
2. Tipo de usuário:
   - Se as contas são @gmail comuns: escolha "Externo".
   - Se for só Workspace da empresa: pode escolher "Interno".
   Como você usa as duas, escolha "Externo".
3. Preencha: nome do app, e-mail de suporte, e-mail do desenvolvedor.
4. Em "Escopos", adicione:
   - https://www.googleapis.com/auth/calendar.events
   - https://www.googleapis.com/auth/calendar.readonly
   - https://www.googleapis.com/auth/userinfo.email
5. Em "Usuários de teste", adicione os e-mails que vão usar a extensão
   (o seu e os da equipe). Enquanto o app estiver em modo "Teste", só esses
   e-mails conseguem logar (limite de 100). Para liberar geral/comercial,
   depois é preciso passar pela "Verificação do app" do Google.

### 3. Criar o Client ID
1. "APIs e serviços" → "Credenciais" → "Criar credenciais" → "ID do cliente OAuth".
2. Tipo de aplicativo: "Extensão do Chrome" (ou "Aplicativo do Chrome").
3. No campo "ID do aplicativo" / "ID da extensão", cole:
   obhgddehjknmdjbnoiaogkhenpcpkjil
4. Clique em "Criar". O Google mostra o CLIENT ID
   (algo como 123456789-abc...apps.googleusercontent.com).
   NÃO há client secret nesse tipo — é o esperado.

### 4. Colar o Client ID no manifest
No arquivo manifest.json, troque:
   "client_id": "COLE_AQUI_SEU_CLIENT_ID.apps.googleusercontent.com"
pelo client id que o Google gerou. Salve.

### 5. Carregar e testar
1. chrome://extensions → Modo desenvolvedor → "Carregar sem compactação"
   → selecione a pasta da extensão.
2. Confirme que o ID exibido é obhgddehjknmdjbnoiaogkhenpcpkjil.
   (Se for outro, a chave não foi lida — verifique o campo "key" no manifest.)
3. Abra a extensão → seção "Agendar reunião" → "Conectar Google Agenda".
4. Faça login com um e-mail que esteja na lista de usuários de teste.

## QUANDO FOR PUBLICAR NA CHROME WEB STORE
- Use a MESMA chave privada (extension_private_key.pem) ao empacotar, para
  manter o id. Na prática, ao subir o .zip pelo Developer Dashboard, a Store
  usa o "key" do manifest e mantém o id obhgddehjknmdjbnoiaogkhenpcpkjil.
- Antes de comercializar para o público, conclua a "Verificação do app" na
  tela de consentimento (Google revisa o uso dos escopos de Calendar).
