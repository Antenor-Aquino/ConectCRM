# Especificação 10 — Notificações (lembretes das atividades)

> Status: **implementado** (versões 0.2.39 e 0.2.40). Avisos das atividades no Chrome,
> por e-mail (conta Gmail ou Outlook) e pelo WhatsApp (WhatsApp Web ou CallMeBot), com
> antecedência definida pelo usuário.

> **Canal de e-mail suspenso (0.2.41):** por decisão de 19/10/2026 o e-mail
> sai das telas e do envio; ficam Chrome e WhatsApp. O código continua no
> projeto (`EMAIL_CHANNEL_ENABLED` em `src/lib/notify/settings.ts`) para
> voltar quando houver envio próprio ou a conta Google configurada. A reserva
> por e-mail do Google Agenda também fica desligada. O que está descrito abaixo
> sobre e-mail vale quando o canal voltar.

## 1. Lembretes na atividade

- Cada atividade tem **vários lembretes**. Cada lembrete tem:
  - a **antecedência**: número + unidade (min, horas, dias), contada a partir do
    **início** da atividade. "0 min" avisa na hora;
  - os **canais**: Chrome, E-mail, WhatsApp (um ou mais).
- Lembretes com a mesma antecedência se juntam (os canais somam); lembrete sem
  canal é descartado.
- Atividade **nova** vem com os **lembretes padrão** do usuário (Configurações →
  Notificações). Padrão de fábrica: 15 min antes, no Chrome.
- O canal marcado que o usuário ainda não configurou aparece em amarelo, com a
  dica de configurar.
- Quem recebe é o **responsável** da atividade (sem responsável: o usuário
  atual deste computador). Atividade concluída ou excluída não avisa.
- O campo antigo "Lembrete (min)" virou um lembrete do Chrome na migração
  (`0014_lembretes_notificacoes.sql`).
- **Agendar atividade em lote** (cartões selecionados) também escolhe os
  lembretes, começando pelos padrão.
- **Avisos enviados**: na edição da atividade, "Ver avisos enviados" lista cada
  envio (tipo, canal, data) e as falhas com o motivo.

## 2. Canais

### 2.1 Chrome
- Notificação do sistema com o título, a data/hora, o tipo e o cartão.
- Botões **Concluir** (marca a atividade como concluída) e **Adiar 10 min**.
  Clicar no aviso abre a atividade no CRM. Também entra no sino do CRM.
- Só aparece no computador do responsável (usuário atual da instalação).

### 2.2 E-mail
- Enviado pela **conta Gmail ou Outlook conectada neste computador**
  (Configurações → Notificações → Enviado pela conta). Permissões:
  `gmail.send` (Google) ou `Mail.Send` (Microsoft).
- Vai para o e-mail informado pelo usuário (padrão: o e-mail do cadastro dele).
- Google: exige o `oauth2.client_id` no `manifest.json` (OAuth Client do tipo
  "Extensão do Chrome" no Google Cloud, com a Gmail API ativada). Outlook: quem já
  tinha conectado a agenda autoriza de novo, por causa da nova permissão.

### 2.3 WhatsApp
O usuário informa o **número que recebe** os avisos e escolhe como enviar:

**a) Pelo WhatsApp Web aberto neste Chrome (padrão, desde a 0.2.40)**
- A mensagem sai do número conectado no WhatsApp Web deste computador e chega
  no número indicado como uma conversa normal (com notificação no celular).
- Usa a biblioteca de código aberto WA-JS (`@wppconnect/wa-js`, Apache-2.0,
  em `public/vendor/`), injetada na aba do WhatsApp só no momento do envio. Ela
  envia **sem abrir a conversa**, então não atrapalha quem está usando o
  WhatsApp. Configurada sem nome de aparelho próprio e sem estatísticas.
- Confere se o número tem WhatsApp (resolve o 9º dígito dos celulares
  brasileiros) e recusa o próprio número conectado (mensagem para si mesmo não
  toca no celular).
- Precisa da aba do `web.whatsapp.com` aberta e conectada. A tela mostra se a
  aba está aberta e oferece **Abrir em aba fixa**. Aba suspensa pelo Chrome é
  recarregada antes do envio. Sem aba, sem login ou carregando: a entrega
  falha com o motivo e entra nas novas tentativas.
- Cuidados exibidos na tela: automatizar o WhatsApp Web não é permitido
  oficialmente pelo WhatsApp — usar só para lembretes, para um número salvo nos
  contatos; as mensagens ficam no histórico do WhatsApp conectado.

**b) CallMeBot** (serviço gratuito de terceiros)
- Envia para o próprio número que fez a ativação: o usuário manda "I allow
  callmebot to send me messages" para o número do CallMeBot e recebe a chave
  (apikey). O serviço às vezes fica sem vagas para novos números.
- A permissão de acesso a `api.callmebot.com` é opcional e pedida ao salvar ou
  testar. A chave fica só neste computador (não vai para o backup).
- Quem já tinha configurado o CallMeBot na 0.2.39 continua nele.

### 2.4 Testar
Cada canal tem **Testar**, que envia na hora uma mensagem de teste e mostra o
resultado ou o erro em português (chave inválida, sem permissão, conta não
conectada...).

## 3. Resumo diário, atrasos e silêncio

- **Resumo diário da agenda** (opcional): no horário escolhido (padrão 07:30),
  uma vez por dia, com as atividades de hoje e até 10 atrasadas. Canais à
  escolha (padrão: e-mail). Se o Chrome abrir depois do horário, sai ao abrir.
- **Aviso de atraso** (opcional): quando uma atividade passa da finalização (ou
  do início, se não tiver finalização) sem ser concluída. Só para as que
  atrasaram nas últimas 24 h; cada uma avisa uma vez por prazo.
- **Horário de silêncio** (opcional, padrão 20:00–07:00, pode passar da
  meia-noite): Chrome e WhatsApp esperam o fim do período; o e-mail sai
  normalmente.

## 4. Chrome fechado

- Os avisos saem do ConectCRM enquanto o Chrome está aberto (o service worker
  confere a cada minuto). Não há servidor.
- Ao reabrir, lembretes que perderam o momento (atividade já começou e o aviso
  deveria ter saído há mais de 15 min) **não** são enviados um a um: chega um
  **resumo único** ("N atividades começaram enquanto o Chrome estava fechado").
  Lembretes ainda úteis (a atividade não começou) saem normalmente.
- **Reserva no Google Agenda** (padrão ligada): reuniões criadas no Google
  Agenda pelo CRM levam também os lembretes por e-mail do próprio Google (os
  lembretes da atividade que têm o canal E-mail), que chegam mesmo com o
  computador desligado.

## 5. Entregas e repetição

- Cada aviso tem uma chave única (lembrete: atividade + início + antecedência;
  resumo: usuário + dia; atraso: atividade + prazo) por canal, gravada em
  `notification_delivery`: não repete, mesmo editando a atividade. Mudar o
  início gera novos lembretes.
- Falha de envio tenta de novo em 5, 15 e 60 min; na última falha o sino do CRM
  mostra "Não foi possível avisar por <canal>" com o motivo.

## 6. Configurações → Notificações

Por usuário, neste computador (`chrome.storage.local`):
canais (com Testar), lembretes padrão, reserva no Google Agenda, resumo diário,
aviso de atraso e horário de silêncio. O administrador vê a tabela de quais
usuários deste computador configuraram cada canal.

## 7. Em espera (decisão de 19/10/2026)

- **E-mail:** suspenso (ver aviso no início). Caminhos avaliados: envio próprio
  por serviço de e-mail (SES, Resend, Brevo) com servidor pequeno; conta
  Gmail/Outlook do usuário (exige `client_id` do Google); IMAP/SMTP por uma
  ponte, que também permitiria o histórico de e-mails no CRM.
- **SMS:** sem opção gratuita confiável. Avaliados: celular Android como
  gateway (app de código aberto, usa o SMS do plano) e provedores pagos
  (Zenvia, Comtele, Mobizon). Uso sugerido: reserva quando o WhatsApp falhar.
- **Telegram:** canal gratuito e oficial, sugerido como alternativa.
- **WhatsApp oficial (API da Meta):** para empresas que queiram envio oficial.
