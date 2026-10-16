// WhatsApp → Pipedrive · popup v1.2
let captured = null;      // { chatName, messages, media }
let selectedDeal = null;  // { id, title }
let channelFieldKey = null; // key do campo "Canal de origem"
let savedLicKey = '';       // chave de licença salva (para mascarar no campo)

const $ = (id) => document.getElementById(id);

const appVersionEl = $('appVersion');
if (appVersionEl && chrome.runtime && chrome.runtime.getManifest) {
  appVersionEl.textContent = 'v' + chrome.runtime.getManifest().version;
}

// ===== Config =====
const LICENSE_API = 'https://extpipe.claudiacrm.com.br';
const DOCS_VERSAO = '2026-06-14'; // versão da Política/Termos aceita (bump ao alterar os documentos)
// Janela de tolerância OFFLINE: por quanto tempo aceitamos o último resultado
// conhecido quando o servidor está inacessível. Não é mais um "cache de rotina"
// — a validação agora é sempre online ao abrir; isto é só rede de segurança.
const LICENSE_CACHE_HOURS = 24;

// ===== Device ID (identifica esta instalação para o controle de 1 dispositivo) =====
async function getDeviceId() {
  return new Promise((res) => {
    chrome.storage.local.get(['deviceId'], (d) => {
      if (d.deviceId) { res(d.deviceId); return; }
      // gera um ID único e persistente para esta instalação
      const id = 'dev-' + (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2)));
      chrome.storage.local.set({ deviceId: id }, () => res(id));
    });
  });
}

// ===== Controle de licença =====
function showView(view) {
  $('viewLicense').classList.toggle('hidden', view !== 'license');
  $('viewConfig').classList.toggle('hidden', view !== 'config');
  $('viewMain').classList.toggle('hidden', view !== 'main');
  $('viewCobranca').classList.toggle('hidden', view !== 'cobranca');
  const act = $('viewActivities'); if (act) act.classList.toggle('hidden', view !== 'activities');
  const cnpj = $('viewCnpj'); if (cnpj) cnpj.classList.toggle('hidden', view !== 'cnpj');
  const sig = $('viewSignature'); if (sig) sig.classList.toggle('hidden', view !== 'signature');
  const up = $('viewUpgrade'); if (up) up.classList.toggle('hidden', view !== 'upgrade');
  // engrenagem e cobrança só aparecem fora da tela de licença/upgrade
  $('btnConfig').classList.toggle('hidden', view === 'license' || view === 'upgrade');
  $('btnCobranca').classList.toggle('hidden', view === 'license' || view === 'upgrade');
  const btnAct = $('btnActivities'); if (btnAct) btnAct.classList.toggle('hidden', view === 'license' || view === 'upgrade');
  const btnCnpj = $('btnCnpj'); if (btnCnpj) btnCnpj.classList.toggle('hidden', view === 'license' || view === 'upgrade');
  const btnSig = $('btnSignature'); if (btnSig) btnSig.classList.toggle('hidden', view === 'license' || view === 'upgrade');
}

async function getLicenseState() {
  return new Promise((res) =>
    chrome.storage.local.get(['licKey', 'licValid', 'licChecked', 'licData'], res)
  );
}

async function setLicenseState(obj) {
  return new Promise((res) => chrome.storage.local.set(obj, res));
}

// Valida a chave no servidor SEMPRE ao abrir (cancelamento reflete rápido).
// O cache só é usado como rede de segurança quando o servidor não responde.
async function checkLicense(force) {
  const st = await getLicenseState();
  if (!st.licKey) return { valida: false, motivo: 'sem_chave' };

  // sempre tenta o servidor primeiro
  try {
    const deviceId = await getDeviceId();
    const cfg = await getConfig();
    const resp = await fetch(`${LICENSE_API}/validar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: st.licKey, device_id: deviceId, dominio: cfg.pdDomain || '' })
    });
    const json = await resp.json();
    // guarda o resultado fresco no cache (rede de segurança p/ quedas futuras)
    await setLicenseState({
      licValid: !!json.valida,
      licChecked: Date.now(),
      licData: json.dados || null
    });
    return json;
  } catch (e) {
    // servidor inacessível: usa o último resultado conhecido para não travar
    // o cliente por uma instabilidade momentânea de conexão.
    const cacheVal = st.licValid;
    const idadeCache = Date.now() - (st.licChecked || 0);
    const dentroDaTolerancia = idadeCache < LICENSE_CACHE_HOURS * 3600 * 1000;
    if (cacheVal != null && dentroDaTolerancia) {
      return { valida: cacheVal, motivo: 'offline_cache', dados: st.licData };
    }
    // sem cache utilizável ou cache muito antigo → não libera
    return { valida: false, motivo: 'offline_sem_cache' };
  }
}

function planLabel(dados) {
  if (!dados) return '';
  const map = { trial: 'Teste (7 dias)', mensal: 'Mensal', anual: 'Anual' };
  let txt = map[dados.plano] || dados.plano || '';
  if (dados.expira_em) {
    const d = new Date(dados.expira_em);
    if (!isNaN(d)) txt += ' - expira em ' + d.toLocaleDateString('pt-BR');
  }
  return txt;
}

async function gateInit() {
  const cfg = await getConfig();
  const r = await checkLicense(false);
  if (r.valida) {
    // licença válida (inclui carência: acesso mantido, mas com alerta)
    const crmProvider = cfg.crmProvider || 'pipedrive';
    const crmReady = crmProvider === 'hubspot' ? !!cfg.hubspotToken : (!!cfg.pdDomain && !!cfg.pdToken);
    if (!crmReady) showView('config');
    else showView('main');
    // mostra/esconde o aviso de carência no topo do fluxo principal
    const dados = r.dados || {};
    if (dados.em_carencia || r.carencia) showGraceBanner(dados);
    else hideGraceBanner();
    return true;
  }
  renderLicenseScreen(r);
  showView('license');
  return false;
}

function showGraceBanner(dados) {
  let banner = $('graceBanner');
  if (!banner) return;
  banner.innerHTML = '<b>Pagamento pendente.</b> Houve uma falha na cobranca da sua assinatura. ' +
    'Regularize seu cartao para nao perder o acesso. ' +
    '<button id="btnFixPayment" class="grace-btn">Atualizar pagamento</button>';
  banner.classList.remove('hidden');
  const btn = document.getElementById('btnFixPayment');
  if (btn) btn.addEventListener('click', openBillingPortal);
}

function hideGraceBanner() {
  const banner = $('graceBanner');
  if (banner) banner.classList.add('hidden');
}

// Abre o portal de cobrança da Stripe para o cliente atualizar o cartão
async function openBillingPortal() {
  try {
    const st = await getLicenseState();
    const resp = await fetch(`${LICENSE_API}/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: st.licKey })
    });
    const json = await resp.json();
    if (json.url) chrome.tabs.create({ url: json.url });
    else alert('Não foi possível abrir o portal de pagamento agora.');
  } catch (e) {
    alert('Erro de conexão ao abrir o portal de pagamento.');
  }
}

function renderLicenseScreen(r) {
  const st = $('licStatus');
  // por padrão, sem botão "Voltar" (só aparece quando aberta pela ✓ do header)
  $('btnLicBack').classList.add('hidden');
  const motivos = {
    sem_chave: '',
    nao_encontrada: 'Chave nao encontrada. Verifique e tente de novo.',
    expirada: 'Sua licenca expirou. Renove para continuar usando.',
    cancelada: 'Licenca cancelada. Assine novamente para reativar.',
    outro_dispositivo: 'Esta licenca esta ativa em outro dispositivo. Clique em "Ativar licenca" para transferi-la para este computador.',
    dominio_diferente: 'Esta licenca esta vinculada a outra conta do CRM. Use a conta original ou fale com o suporte para liberar.',
    limite_ativacoes: 'Limite de dispositivos atingido para esta licenca. Clique em "Ativar licenca" para usar neste computador ou fale com o suporte.',
    offline_sem_cache: 'Nao consegui validar sem conexao. Tente mais tarde.'
  };
  const msg = motivos[r.motivo];
  if (msg) { st.textContent = msg; st.className = 'lic-status err'; st.classList.remove('hidden'); }
  else { st.classList.add('hidden'); }
  savedLicKey = '';
  getLicenseState().then((s) => {
    savedLicKey = s.licKey || '';
    const el = $('licKey');
    if (!el.dataset.ph) el.dataset.ph = el.placeholder;
    el.value = '';
    el.dataset.dirty = '';
    el.oninput = onKeyInput;
    const prefix = $('keyPrefix');
    if (savedLicKey) {
      el.type = 'password';
      el.placeholder = '**** salvo (chave ativa)';
      if (prefix) prefix.classList.add('hidden');
    } else {
      el.type = 'text';
      el.placeholder = el.dataset.ph;
      if (prefix) prefix.classList.remove('hidden');
    }
  });
  applyLicenseVisibility(r);
}

// 18 + 19 + 16.1: controla a visibilidade dos blocos conforme o estado da licença
function applyLicenseVisibility(r) {
  const dados = r.dados || {};
  const plano = (dados.plano || '').toLowerCase();
  const valida = !!r.valida;
  const isTrial = plano === 'trial';
  const isPaid = valida && (plano === 'mensal' || plano === 'anual');
  const isTrialAtivo = valida && isTrial;
  const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? '' : 'none'; };

  if (isPaid) {
    show('licInput', false); show('trialSection', false); show('divOu', false);
  } else if (isTrialAtivo) {
    show('licInput', true); show('trialSection', false); show('divOu', false);
  } else {
    show('licInput', true); show('trialSection', true); show('divOu', true);
  }
  show('licPlans', true); show('divAssinar', true);

  // 16.1 — consentimento some após aceite (ou se a licença já é válida)
  chrome.storage.local.get(['agreedTerms'], (d) => {
    const accepted = !!d.agreedTerms || valida;
    const tc = $('termsCheck'); if (tc) tc.style.display = accepted ? 'none' : '';
  });

  // 19 — selo "(Contratado)" e alerta de upgrade (só para mensal ativo)
  const bm = $('badgeMensal'), ba = $('badgeAnual'), al = $('upgradeAlert');
  if (bm) bm.classList.toggle('hidden', !(isPaid && plano === 'mensal'));
  if (ba) ba.classList.toggle('hidden', !(isPaid && plano === 'anual'));
  if (al) al.classList.toggle('hidden', !(isPaid && plano === 'mensal'));
}

function formatCode(v) {
  v = String(v || '').toUpperCase().replace(/^CLAUDIACRM-/, '').replace(/[^0-9A-F]/g, '').slice(0, 12);
  const parts = [];
  for (let i = 0; i < v.length; i += 4) parts.push(v.slice(i, i + 4));
  return parts.join('-');
}
function onKeyInput() {
  const el = $('licKey');
  el.dataset.dirty = '1';
  if (el.type === 'text') el.value = formatCode(el.value);
}

async function activateLicense() {
  const el = $('licKey');
  let key = '';
  if (el.dataset.dirty || !savedLicKey) {
    const raw = el.value.trim();
    const digits = raw.toUpperCase().replace(/^CLAUDIACRM-/, '').replace(/[^0-9A-F]/g, '');
    if (digits.length === 12) key = 'CLAUDIACRM-' + digits.slice(0, 4) + '-' + digits.slice(4, 8) + '-' + digits.slice(8, 12);
    else if (/^CLAUDIACRM-/i.test(raw)) key = raw.toUpperCase();
    else key = raw;
  } else {
    key = savedLicKey || '';
  }
  const st = $('licStatus');
  if (!key) { st.textContent = 'Digite a chave.'; st.className = 'lic-status err'; st.classList.remove('hidden'); return; }
  await activateWithKey(key, st);
}

async function activateWithKey(key, st) {
  st = st || $('licStatus');
  st.textContent = 'Validando…'; st.className = 'lic-status info'; st.classList.remove('hidden');
  try {
    const deviceId = await getDeviceId();
    const cfg = await getConfig();
    // /ativar registra ESTE dispositivo (até o limite; senão libera o mais antigo)
    const resp = await fetch(`${LICENSE_API}/ativar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: key, device_id: deviceId, dominio: cfg.pdDomain || '' })
    });
    const r = await resp.json();
    if (r.valida) {
      await setLicenseState({ licKey: key, licValid: true, licChecked: Date.now(), licData: r.dados || null });
      st.textContent = 'Licenca ativa - ' + planLabel(r.dados);
      st.className = 'lic-status ok';
      setTimeout(gateInit, 900);
    } else {
      await setLicenseState({ licKey: key, licChecked: 0 });
      renderLicenseScreen(r);
    }
  } catch (e) {
    st.textContent = 'Erro de conexão ao ativar. Verifique sua internet.';
    st.className = 'lic-status err';
  }
}

async function startTrial() {
  const st = $('licCheckoutStatus');
  if (!$('agreeTerms').checked) {
    setStatus(st, '⚠ Para iniciar o teste, marque que concorda com a Política de Privacidade e os Termos de Uso.', 'err');
    return;
  }
  const email = ($('trialEmail').value || '').trim();
  const phone = ($('trialPhone').value || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setStatus(st, '⚠ Informe um e-mail válido para iniciar o teste.', 'err');
    return;
  }
  if (phone.replace(/\D/g, '').length < 10) {
    setStatus(st, '⚠ Informe seu WhatsApp com DDD para iniciar o teste.', 'err');
    return;
  }
  setStatus(st, 'Gerando seu teste de 7 dias…', 'info');
  try {
    const deviceId = await getDeviceId();
    const resp = await fetch(`${LICENSE_API}/trial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, email, telefone: phone, docsVersao: DOCS_VERSAO })
    });
    const json = await resp.json();
    if (json.ok) {
      // Fluxo OTP: enviamos um código por WhatsApp; cliente digita abaixo para ativar.
      setStatus(st, `✓ Teste criado! Enviamos um código de ativação de 8 dígitos para o seu WhatsApp. Digite-o abaixo para ativar. A chave também chega no seu e-mail após a ativação.`, 'ok');
      $('otpRow').classList.remove('hidden');
      $('otpEmail').value = email;
      $('otpCode').focus();
    } else if (json.erro === 'trial_ja_usado' || json.erro === 'email_ja_usou_trial') {
      setStatus(st, '⚠ ' + (json.mensagem || 'Teste já utilizado.') + ' Assine um plano para continuar.', 'err');
    } else if (json.erro === 'email_invalido') {
      setStatus(st, '⚠ ' + (json.mensagem || 'E-mail inválido.'), 'err');
    } else {
      setStatus(st, 'Não foi possível gerar o teste. Tente de novo.', 'err');
    }
  } catch (e) {
    setStatus(st, 'Erro de conexão ao gerar o teste.', 'err');
  }
}

async function openCheckout(plano) {
  const st = $('licCheckoutStatus');
  if (!$('agreeTerms').checked) {
    setStatus(st, '⚠ Para assinar, marque que concorda com a Política de Privacidade e os Termos de Uso.', 'err');
    return;
  }
  setStatus(st, 'Abrindo pagamento…', 'info');
  try {
    const resp = await fetch(`${LICENSE_API}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plano })
    });
    const json = await resp.json();
    if (json.url) {
      chrome.tabs.create({ url: json.url });
      setStatus(st, 'Após o pagamento, você receberá um código de ativação no WhatsApp. Volte aqui, clique em "Ativar com código recebido no WhatsApp" e informe o código.', 'info');
    } else {
      setStatus(st, 'Erro ao abrir o pagamento: ' + (json.erro || ''), 'err');
    }
  } catch (e) {
    setStatus(st, 'Erro de conexão ao abrir o pagamento.', 'err');
  }
}

const DEFAULT_AI_PROMPT = `Você é um Gerente Comercial sênior com ampla experiência em gestão de pipeline, inteligência de vendas e CRM. O seu objetivo é analisar o histórico de conversas fornecido (mensagens de WhatsApp, em texto ou em imagens/recortes de tela) e produzir um registro para o nosso CRM em DUAS partes, nesta ordem:

PARTE 1 ? TRANSCRI??O NA ?NTEGRA
- Transcreva a conversa COMPLETA, na ordem cronológica, sem resumir e sem omitir mensagens.
- Para cada mensagem use o formato: "Nome/Remetente (DD/MM/AAAA HH:MM): mensagem". Se a data ou hora não estiver visível, use o que houver (ex.: só a hora) e não invente.
- Para mídias, transcreva o marcador correspondente: [?udio], [Imagem], [anexo: nome.pdf]. Não tente adivinhar o conteúdo de áudios ou arquivos.
- Ao final da transcrição, insira uma linha com "---" antes de iniciar a PARTE 2.

PARTE 2 — RESUMO EXECUTIVO
Inicie a Parte 2 EXATAMENTE com este cabeçalho, preenchendo com os dados extraídos da própria conversa:
Conversa referente a: [nome da pessoa/contato]. Período: [DD/MM/AAAA] a [DD/MM/AAAA].
[Incluir a linha a seguir SOMENTE se houver imagens/recortes na análise:] As imagens constam anexadas no histórico.

Se o nome ou o período não puderem ser identificados com segurança no conteúdo, escreva "[pessoa não identificada]" ou "[período não identificado]" — NÃO invente.

Em seguida, deixe uma linha em branco e produza o resumo estritamente com os tópicos abaixo:

**Status do lead:**
- Em uma linha, classifique a temperatura do lead como Quente, Morno ou Frio, seguida de uma justificativa curta (ex: "Morno - demonstrou interesse, mas adiou a decisão por prioridades concorrentes.").

**Contexto:**
- Escreva uma única linha resumindo de forma direta o objetivo do contato (ex: "Follow-up sobre proposta da Perseus para a LabPub.").

**Pontos principais discutidos:**
- Liste em formato de tópicos (usando estritamente o sinal de hífen "-") as principais decisões, justificativas ou atualizações trazidas pelo cliente. Seja conciso e direto.

**Interesses, dores ou objeções do contato:**
- Identifique os sentimentos e barreiras do cliente utilizando a estrutura exata de sub-tópicos com hífen "-":
  - Interesse: [O que o contato gostou ou demonstrou valor]
  - Objeção/Pendente: [O principal motivo pelo qual a venda não avançou no momento ou prioridades concorrentes]

**Próximos passos / pendências:**
- Liste com hífen "-" a próxima ação clara e com prazo/data específica determinada na conversa. Caso nenhuma ação com prazo tenha sido acordada, registre: "- Nenhuma ação com prazo foi definida na conversa."

**Follow-up sugerido:**
- Data sugerida: indique uma data ou janela para o próximo contato. Derive-a de gatilhos reais da conversa (ex: cliente pediu para retomar "em outubro" -> sugira o início de outubro). Se não houver gatilho de prazo na conversa, sugira um intervalo padrão e sinalize que é uma estimativa (ex: "~7 dias (estimativa, sem prazo definido pelo cliente)").
- Canal sugerido: indique o canal mais adequado para a retomada (WhatsApp, ligação, e-mail ou reunião), com base no tom e no histórico da conversa.
- Abordagem sugerida: escreva 1 a 2 frases curtas com o ângulo recomendado para o próximo contato, conectando-o à principal objeção ou interesse identificado.

---
DIRETRIZES CR?TICAS (Siga ? risca):
1. Use os títulos principais do resumo exatamente em negrito (ex: **Status do lead:**, **Contexto:**, etc.).
2. Utilize exclusivamente o hífen "-" seguido de espaço para os itens de lista. Nunca use asteriscos como marcador de tópicos.
3. Não adicione textos de introdução ("Aqui está...") nem saudações. A resposta deve começar direto na PARTE 1 (transcrição) e terminar no último item de Follow-up sugerido.
4. Mantenha o tom profissional, corporativo e focado em fatos comerciais.
5. NÃO INVENTE informações. Baseie-se estritamente no que está na conversa. Quando um dado não estiver presente, registre "- Não informado na conversa." em vez de supor.
6. A conversa pode conter marcadores de mídia como [?udio], [Imagem] ou [anexo: arquivo.pdf]. Considere-os como contexto, mas não tente adivinhar o conteúdo da mídia.
7. Se a conversa não for de natureza comercial (ex: discussão técnica, suporte ou grupo interno), não force o enquadramento de vendas: preencha o "Status do lead" como "Não se aplica - conversa não comercial" e marque os tópicos sem informação correspondente como "- Não se aplica.".

Aqui está o histórico da conversa para análise:
[Cole as mensagens do WhatsApp aqui]`;

// Prompt 2 (simples): apenas transcrição na íntegra
const DEFAULT_AI_PROMPT2 = `Transcreva na íntegra o conteúdo das imagens/recortes a seguir (conversa de WhatsApp ou documento), na ordem cronológica, sem resumir e sem omitir nada.

- Para cada mensagem use o formato: "Nome/Remetente (DD/MM/AAAA HH:MM): mensagem". Se a data ou hora não estiver visível, use o que houver e não invente.
- Para mídias, transcreva o marcador correspondente: [?udio], [Imagem], [anexo: nome.pdf]. Não tente adivinhar o conteúdo de áudios ou arquivos.
- Não adicione comentários, resumo, títulos nem saudações. Responda apenas com a transcrição.

[Cole as mensagens do WhatsApp aqui]`;

async function getConfig() {
  return new Promise((res) => chrome.storage.sync.get(['crmProvider', 'pdDomain', 'pdToken', 'hubspotToken', 'geminiKey', 'aiPrompt', 'aiPrompt2', 'asaasKey', 'asaasEnv', 'zapsignToken', 'aiProvider', 'openaiKey', 'claudeKey', 'deepseekKey', 'geminiModel', 'openaiModel', 'claudeModel', 'deepseekModel'], res));
}
function showConfig(show) {
  // mostra config OU main (a tela de licença é controlada por showView)
  showView(show ? 'config' : 'main');
}
let savedSecrets = { pdToken: '', hubspotToken: '', geminiKey: '', asaasKey: '', zapsignToken: '', openaiKey: '', claudeKey: '', deepseekKey: '' };
function secretKey(id) {
  return id === 'cfgToken' ? 'pdToken'
    : id === 'cfgHubspotToken' ? 'hubspotToken'
    : id === 'cfgGemini' ? 'geminiKey'
    : id === 'cfgOpenai' ? 'openaiKey'
    : id === 'cfgClaude' ? 'claudeKey'
    : id === 'cfgDeepseek' ? 'deepseekKey'
    : id === 'cfgZapsignToken' ? 'zapsignToken'
    : 'asaasKey';
}

function toggleCrmConfig(provider) {
  document.querySelectorAll('.crm-config').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.crm !== provider);
  });
}
// Mostra só o campo de chave do provedor selecionado
function toggleAiKeyFields(prov) {
  document.querySelectorAll('.ai-key').forEach((el) => {
    el.style.display = (el.dataset.prov === prov) ? '' : 'none';
  });
}

function setupSecret(id, saved) {
  const el = $(id);
  if (!el.dataset.ph) el.dataset.ph = el.placeholder;
  el.type = 'password';
  el.value = '';
  el.dataset.dirty = '';
  el.placeholder = saved ? '•••• salvo (vazio = manter)' : el.dataset.ph;
  el.oninput = () => { el.dataset.dirty = '1'; };
  // reseta o botão "Mostrar" correspondente
  const btn = document.querySelector(`.secret-show[data-target="${id}"]`);
  if (btn) btn.textContent = 'Mostrar';
}

function readSecretField(el, saved) {
  const typed = (el.value || '').trim();
  if (typed) return typed;
  return saved || '';
}

async function openConfig(focusAsaas) {
  const cfg = await getConfig();
  const crmProvider = cfg.crmProvider || 'pipedrive';
  $('cfgCrmProvider').value = crmProvider;
  toggleCrmConfig(crmProvider);
  $('cfgDomain').value = cfg.pdDomain || '';
  $('cfgPrompt').value = cfg.aiPrompt || DEFAULT_AI_PROMPT;
  $('cfgPrompt2').value = cfg.aiPrompt2 || DEFAULT_AI_PROMPT2;
  $('cfgAsaasEnv').value = cfg.asaasEnv || 'producao';
  savedSecrets = {
    pdToken: cfg.pdToken || '', hubspotToken: cfg.hubspotToken || '', geminiKey: cfg.geminiKey || '', asaasKey: cfg.asaasKey || '',
    zapsignToken: cfg.zapsignToken || '',
    openaiKey: cfg.openaiKey || '', claudeKey: cfg.claudeKey || '', deepseekKey: cfg.deepseekKey || ''
  };
  setupSecret('cfgToken', savedSecrets.pdToken);
  setupSecret('cfgHubspotToken', savedSecrets.hubspotToken);
  setupSecret('cfgGemini', savedSecrets.geminiKey);
  setupSecret('cfgOpenai', savedSecrets.openaiKey);
  setupSecret('cfgClaude', savedSecrets.claudeKey);
  setupSecret('cfgDeepseek', savedSecrets.deepseekKey);
  setupSecret('cfgAsaas', savedSecrets.asaasKey);
  if ($('cfgZapsignToken')) setupSecret('cfgZapsignToken', savedSecrets.zapsignToken);
  $('cfgAiProvider').value = cfg.aiProvider || 'gemini';
  $('cfgGeminiModel').value = cfg.geminiModel || '';
  $('cfgOpenaiModel').value = cfg.openaiModel || '';
  $('cfgClaudeModel').value = cfg.claudeModel || '';
  $('cfgDeepseekModel').value = cfg.deepseekModel || '';
  toggleAiKeyFields($('cfgAiProvider').value);
  $('asaasTestMsg').textContent = '';
  updatePdApiLink();
  showConfig(true);
  if (focusAsaas) { const g = $('cfgAsaasGroup'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

$('btnConfig').addEventListener('click', async () => {
  // Só permite Configurações depois de uma licença válida criada e aplicada
  const ls = await getLicenseState();
  if (!ls.licValid) {
    const r = await checkLicense(false);
    renderLicenseScreen(r);
    showView('license');
    return;
  }
  openConfig(false);
});

// (Removido) Revelar chaves em tela não é permitido — chaves ficam sempre mascaradas.

// Botões "Voltar" → tela principal
$('btnCfgBack').addEventListener('click', () => showView('main'));
$('btnLicBack').addEventListener('click', () => showView('main'));

$('btnResetPrompt').addEventListener('click', () => {
  $('cfgPrompt').value = DEFAULT_AI_PROMPT;
});
$('btnResetPrompt2').addEventListener('click', () => {
  $('cfgPrompt2').value = DEFAULT_AI_PROMPT2;
});

// Mantém o link "Abrir página de API" apontando para o domínio do usuário
function updatePdApiLink() {
  const dom = ($('cfgDomain').value.trim() || 'app').replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/, '');
  const link = $('pdApiLink');
  if (link) link.href = `https://${dom || 'app'}.pipedrive.com/settings/api`;
}
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'cfgDomain') updatePdApiLink();
});
$('cfgAiProvider').addEventListener('change', (e) => toggleAiKeyFields(e.target.value));
if ($('cfgCrmProvider')) $('cfgCrmProvider').addEventListener('change', (e) => {
  toggleCrmConfig(e.target.value);
  newDealLoaded = false;
  newActivityLoaded = false;
});

function isHubSpotPrivateAppToken(token) {
  return /^pat-[a-z0-9]+-/i.test(String(token || '').trim());
}

function saveConfig() {
  const crmProvider = $('cfgCrmProvider').value || 'pipedrive';
  const pdDomain = $('cfgDomain').value.trim().replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/, '');
  const tokEl = $('cfgToken'), hubEl = $('cfgHubspotToken'), gemEl = $('cfgGemini'), asaEl = $('cfgAsaas');
  const zapEl = $('cfgZapsignToken');
  const oaiEl = $('cfgOpenai'), claEl = $('cfgClaude'), dsEl = $('cfgDeepseek');
  const pdToken = readSecretField(tokEl, savedSecrets.pdToken);
  const hubspotToken = readSecretField(hubEl, savedSecrets.hubspotToken);
  const geminiKey = readSecretField(gemEl, savedSecrets.geminiKey);
  const openaiKey = readSecretField(oaiEl, savedSecrets.openaiKey);
  const claudeKey = readSecretField(claEl, savedSecrets.claudeKey);
  const deepseekKey = readSecretField(dsEl, savedSecrets.deepseekKey);
  const asaasKey = readSecretField(asaEl, savedSecrets.asaasKey);
  const zapsignToken = zapEl ? readSecretField(zapEl, savedSecrets.zapsignToken) : '';
  const asaasEnv = $('cfgAsaasEnv').value || 'producao';
  const aiProvider = $('cfgAiProvider').value || 'gemini';
  const geminiModel = $('cfgGeminiModel').value.trim();
  const openaiModel = $('cfgOpenaiModel').value.trim();
  const claudeModel = $('cfgClaudeModel').value.trim();
  const deepseekModel = $('cfgDeepseekModel').value.trim();
  const aiPrompt = $('cfgPrompt').value.trim() || DEFAULT_AI_PROMPT;
  const aiPrompt2 = $('cfgPrompt2').value.trim() || DEFAULT_AI_PROMPT2;
  if (crmProvider === 'pipedrive' && (!pdDomain || !pdToken)) {
    const target = !pdDomain ? $('cfgDomain') : $('cfgToken');
    alert('Preencha a secao 1 - Pipedrive: dominio da conta e API token. Eles sao obrigatorios para salvar as configuracoes.');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => target.focus(), 250);
    return;
  }
  if (crmProvider === 'hubspot' && !hubspotToken) {
    alert('Preencha a secao 1 - HubSpot com o token de um aplicativo privado.');
    $('cfgHubspotToken').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => $('cfgHubspotToken').focus(), 250);
    return;
  }
  if (crmProvider === 'hubspot' && !isHubSpotPrivateAppToken(hubspotToken)) {
    alert('Essa chave parece ser uma Chave de acesso pessoal do HubSpot, e a API CRM recusou esse formato. Crie um Aplicativo antigo do tipo Privado e copie o token da aba Auth. O token normalmente começa com "pat-".');
    $('cfgHubspotToken').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => $('cfgHubspotToken').focus(), 250);
    return;
  }
  newDealLoaded = false;
  newActivityLoaded = false;
  chrome.storage.sync.set({ crmProvider, pdDomain, pdToken, hubspotToken, geminiKey, openaiKey, claudeKey, deepseekKey, aiProvider, geminiModel, openaiModel, claudeModel, deepseekModel, aiPrompt, aiPrompt2, asaasKey, asaasEnv, zapsignToken }, () => showConfig(false));
}
$('btnSaveConfig').addEventListener('click', saveConfig);
if ($('btnSaveConfigTop')) $('btnSaveConfigTop').addEventListener('click', saveConfig);

// ===== Botões da tela de licença =====
$('btnActivateLic').addEventListener('click', activateLicense);
$('licKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') activateLicense(); });
$('btnTrial').addEventListener('click', startTrial);
$('btnResendWa').addEventListener('click', resendByWhatsApp);
$('btnValidateOtp').addEventListener('click', validateOtp);
$('btnHaveCode').addEventListener('click', () => {
  $('otpRow').classList.remove('hidden');
  const pre = ($('trialEmail').value || '').trim();
  if (pre && !$('otpEmail').value) $('otpEmail').value = pre;
  $('otpEmail').focus();
});

// ===== Cancelamento de assinatura =====
$('btnAbrirCancel').addEventListener('click', abrirCancelamento);
$('btnConfirmCancel').addEventListener('click', confirmarCancelamento);

async function abrirCancelamento() {
  const box = $('cancelBox');
  const cont = $('cancelMotivos');
  box.classList.remove('hidden');
  cont.innerHTML = '<span style="font-size:12px;color:#5c7068">Carregando motivos…</span>';
  try {
    const resp = await fetch(`${LICENSE_API}/motivos-cancelamento`);
    const r = await resp.json();
    const motivos = (r && r.motivos) || [];
    if (!motivos.length) { cont.innerHTML = '<span style="font-size:12px;color:#5c7068">Nenhum motivo disponível.</span>'; return; }
    cont.innerHTML = motivos.map((m) =>
      `<label class="cancel-opt"><input type="radio" name="cmot" value="${m.id}" data-tipo="${esc(m.tipo)}"> ${esc(m.texto)}</label>`
    ).join('');
    cont.querySelectorAll('input[name="cmot"]').forEach((rd) => rd.addEventListener('change', () => {
      $('cancelTexto').classList.toggle('hidden', rd.dataset.tipo !== 'aberto');
    }));
  } catch (e) {
    cont.innerHTML = '<span style="font-size:12px;color:#b54">Erro ao carregar motivos.</span>';
  }
}

async function confirmarCancelamento() {
  const st = $('cancelStatus');
  const sel = document.querySelector('input[name="cmot"]:checked');
  if (!sel) { setStatus(st, '⚠ Selecione um motivo.', 'err'); return; }
  const aberto = sel.dataset.tipo === 'aberto';
  const motivoTexto = aberto ? ($('cancelTexto').value || '').trim() : '';
  if (aberto && !motivoTexto) { setStatus(st, '⚠ Descreva o motivo.', 'err'); return; }
  const state = await getLicenseState();
  const chave = state.licKey || '';
  if (!chave) { setStatus(st, '⚠ Não há licença ativa neste dispositivo para cancelar.', 'err'); return; }
  setStatus(st, 'Enviando solicitação…', 'info');
  try {
    const resp = await fetch(`${LICENSE_API}/cancelar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave, motivoId: sel.value, motivoTexto })
    });
    const r = await resp.json().catch(() => ({}));
    if (r.ok) {
      if (r.reembolso) setStatus(st, '✓ Solicitação registrada! Você está dentro dos 7 dias — pedimos o reembolso integral. O cancelamento e o reembolso serão confirmados por e-mail.', 'ok');
      else setStatus(st, '✓ Solicitação registrada! Sua assinatura não será renovada e você mantém o acesso até o fim do período pago. A confirmação chega por e-mail.', 'ok');
      $('btnConfirmCancel').disabled = true;
    } else if (r.erro === 'nao_encontrada') setStatus(st, '⚠ Licença não encontrada.', 'err');
    else setStatus(st, '⚠ Não foi possível registrar agora. Tente novamente.', 'err');
  } catch (e) {
    setStatus(st, 'Erro de conexão.', 'err');
  }
}

function otpEmailValue() {
  return (($('otpEmail').value || '').trim()) || (($('trialEmail').value || '').trim());
}

async function resendByWhatsApp() {
  const st = $('resendStatus');
  const email = otpEmailValue();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setStatus(st, '⚠ Informe o e-mail usado no teste/compra no campo acima.', 'err');
    return;
  }
  setStatus(st, 'Reenviando por WhatsApp…', 'info');
  try {
    const resp = await fetch(`${LICENSE_API}/reenviar-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const r = await resp.json().catch(() => ({}));
    if (r.ok) {
      setStatus(st, '✓ Enviamos um código de 8 dígitos para o seu WhatsApp. Digite-o abaixo para ativar sua licença.', 'ok');
      $('otpRow').classList.remove('hidden');
      $('otpEmail').value = email;
      $('otpCode').focus();
    } else if (r.erro === 'sem_telefone') setStatus(st, '⚠ Não há WhatsApp cadastrado para esse e-mail.', 'err');
    else if (r.erro === 'nao_encontrado') setStatus(st, '⚠ Não encontramos uma licença para esse e-mail.', 'err');
    else if (r.erro === 'aguarde') setStatus(st, '⚠ Aguarde um minuto antes de reenviar.', 'err');
    else setStatus(st, '⚠ Não foi possível reenviar agora. Tente novamente em instantes.', 'err');
  } catch (e) {
    setStatus(st, 'Erro de conexão. Verifique sua internet.', 'err');
  }
}

async function validateOtp() {
  const st = $('resendStatus');
  const email = otpEmailValue();
  const codigo = ($('otpCode').value || '').replace(/\D/g, '');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus(st, '⚠ Informe o e-mail usado no teste/compra.', 'err'); return; }
  if (codigo.length < 4) { setStatus(st, '⚠ Digite o código que chegou no seu WhatsApp.', 'err'); return; }
  setStatus(st, 'Validando código…', 'info');
  try {
    const resp = await fetch(`${LICENSE_API}/validar-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, codigo })
    });
    const r = await resp.json().catch(() => ({}));
    if (r.ok && r.chave) {
      setStatus(st, '✓ Código válido! Ativando sua licença…', 'ok');
      $('otpRow').classList.add('hidden');
      await activateWithKey(r.chave, st);
    } else if (r.erro === 'codigo_invalido') setStatus(st, '⚠ Código incorreto. Confira e tente de novo.', 'err');
    else if (r.erro === 'expirado') setStatus(st, '⚠ Código expirado. Clique em "reenviar por WhatsApp" para receber um novo.', 'err');
    else if (r.erro === 'sem_otp') setStatus(st, '⚠ Nenhum código pendente. Clique em "reenviar por WhatsApp" primeiro.', 'err');
    else setStatus(st, '⚠ Não foi possível validar agora. Tente novamente.', 'err');
  } catch (e) {
    setStatus(st, 'Erro de conexão. Verifique sua internet.', 'err');
  }
}
$('btnPlanMensal').addEventListener('click', () => openCheckout('mensal'));
$('btnPlanAnual').addEventListener('click', () => openCheckout('anual'));

// Botão 🔑 no header: mostra a tela de licença com o status atual
$('btnLicense').addEventListener('click', async () => {
  const r = await checkLicense(false);
  renderLicenseScreen(r);
  if (r.valida) {
    const st = $('licStatus');
      st.textContent = 'Licenca ativa - ' + planLabel(r.dados);
    st.className = 'lic-status ok';
    st.classList.remove('hidden');
    // veio do fluxo principal (licença válida) → permite voltar
    $('btnLicBack').classList.remove('hidden');
  }
  showView('license');
});

// ===== Upgrade Mensal -> Anual =====
function brl(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','); }
function renderUpgradeCalc(c) {
  return `
    <div class="up-row"><span>Plano atual</span><b>Mensal (${brl(c.valor_mensal)}/mes)</b></div>
    <div class="up-row"><span>Dias do ciclo</span><b>${c.dias_plano} dias</b></div>
    <div class="up-row"><span>Dias ja utilizados</span><b>${c.dias_utilizados} dias</b></div>
    <div class="up-row"><span>Dias de credito</span><b>${c.dias_credito} dias</b></div>
    <div class="up-row"><span>Valor por dia</span><b>${brl(c.valor_diario)}</b></div>
    <div class="up-row credit"><span>Credito proporcional</span><b>- ${brl(c.credito)}</b></div>
    <div class="up-row"><span>Plano Anual</span><b>${brl(c.valor_anual)}</b></div>
    <div class="up-row total"><span>Total a pagar hoje</span><b>${brl(c.valor_final)}</b></div>
    <p class="up-note">Regra de ${c.dias_plano} dias: credito = dias restantes x (valor mensal / ${c.dias_plano}).</p>`;
}
async function openUpgradeScreen() {
  showView('upgrade');
  const box = $('upgradeCalc');
  box.innerHTML = '<div class="up-loading">Calculando...</div>';
  $('btnUpgradeGo').classList.add('hidden');
  $('upgradeStatus').classList.add('hidden');
  try {
    const st = await getLicenseState();
    const resp = await fetch(`${LICENSE_API}/upgrade-preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: st.licKey })
    });
    const c = await resp.json();
    if (!c.ok) {
      box.innerHTML = '<div class="up-err">Não foi possível calcular o upgrade' + (c.motivo ? ' (' + c.motivo + ')' : '') + '.</div>';
      return;
    }
    box.innerHTML = renderUpgradeCalc(c);
    $('btnUpgradeGo').classList.remove('hidden');
  } catch (e) {
    box.innerHTML = '<div class="up-err">Erro de conexão ao calcular o upgrade.</div>';
  }
}
$('btnUpgradeInfo').addEventListener('click', openUpgradeScreen);
$('btnUpgradeBack').addEventListener('click', async () => {
  const r = await checkLicense(false);
  renderLicenseScreen(r);
  if (r.valida) { const s = $('licStatus'); s.textContent = 'Licenca ativa - ' + planLabel(r.dados); s.className = 'lic-status ok'; s.classList.remove('hidden'); $('btnLicBack').classList.remove('hidden'); }
  showView('license');
});
$('btnUpgradeGo').addEventListener('click', async () => {
  const st0 = $('upgradeStatus');
  setStatus(st0, 'Abrindo o checkout do plano anual…', 'info');
  try {
    const s = await getLicenseState();
    const resp = await fetch(`${LICENSE_API}/upgrade-checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: s.licKey })
    });
    const j = await resp.json();
    if (j.url) chrome.tabs.create({ url: j.url });
    else setStatus(st0, j.erro || 'Não foi possível iniciar o upgrade agora.', 'err');
  } catch (e) { setStatus(st0, 'Erro de conexão.', 'err'); }
});

// 16.1 — ao marcar o aceite, grava e esconde o bloco
const _agree = $('agreeTerms');
if (_agree) _agree.addEventListener('change', (e) => {
  if (e.target.checked) {
    chrome.storage.local.set({ agreedTerms: true });
    const tc = $('termsCheck'); if (tc) tc.style.display = 'none';
  }
});

// Inicialização: primeiro o gate de licença decide qual tela mostrar
(async () => { await gateInit(); })();

// Sair: limpa as credenciais salvas e volta para a tela de acesso
$('btnLogout').addEventListener('click', () => {
  if (!confirm('Sair? Suas credenciais de CRM serao removidas desta extensao.')) return;
  chrome.storage.sync.remove(['crmProvider', 'pdDomain', 'pdToken', 'hubspotToken', 'geminiKey', 'aiPrompt', 'zapsignToken'], () => {
    captured = null;
    selectedDeal = null;
    $('cfgDomain').value = '';
    $('cfgToken').value = '';
    if ($('cfgHubspotToken')) $('cfgHubspotToken').value = '';
    $('cfgGemini').value = '';
    if ($('cfgZapsignToken')) $('cfgZapsignToken').value = '';
    showConfig(true);
  });
});

// ===== Helpers =====
function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'status ' + type;
  el.classList.remove('hidden');
  try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
}
function updateSaveButton() {
  const hasContent = captured || localFiles.length > 0;
  $('btnSave').disabled = !(hasContent && selectedDeal);
}
async function pdUrl(path) {
  const cfg = await getConfig();
  if (!cfg.pdDomain || !cfg.pdToken) { showConfig(true); throw new Error('Configure o domínio e o API token primeiro.'); }
  const sep = path.includes('?') ? '&' : '?';
  return `https://${cfg.pdDomain}.pipedrive.com/api/v1${path}${sep}api_token=${cfg.pdToken}`;
}
async function pdFetch(path, options = {}) {
  const url = await pdUrl(path);
  const resp = await fetch(url, options);
  const json = await resp.json();
  if (!resp.ok || json.success === false) throw new Error(json.error || `Erro HTTP ${resp.status}`);
  return json;
}

async function currentCrm() {
  const cfg = await getConfig();
  if (!cfg.crmProvider && cfg.hubspotToken && (!cfg.pdDomain || !cfg.pdToken)) return 'hubspot';
  return cfg.crmProvider || 'pipedrive';
}

async function hsFetch(path, options = {}) {
  const cfg = await getConfig();
  if (!cfg.hubspotToken) { showConfig(true); throw new Error('Configure o token de app privado do HubSpot primeiro.'); }
  const resp = await fetch('https://api.hubapi.com' + path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: 'Bearer ' + cfg.hubspotToken }
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(hubSpotErrorMessage(json, resp.status));
  return json;
}

function hubSpotErrorMessage(json, status) {
  const raw = String((json && (json.message || json.error || json.error_description)) || '');
  const low = raw.toLowerCase();
  if (status === 401 || low.includes('oauth token') || low.includes('expired')) {
    return 'HubSpot recusou a chave. Use um token de Aplicativo privado: Desenvolvimento -> Aplicativos antigos -> Criar aplicativo legado -> Privado -> aba Auth -> Show token.';
  }
  if (status === 403 || low.includes('scope') || low.includes('permission')) {
    return 'HubSpot recusou por falta de permissao. Libere escopos de leitura e escrita para deals, contatos, empresas, notas, tarefas e arquivos.';
  }
  return raw || `Erro HTTP ${status}`;
}

const hsAssocCache = {};
async function hsAssocTypeId(from, to) {
  const key = `${from}:${to}`;
  if (hsAssocCache[key]) return hsAssocCache[key];
  const r = await hsFetch(`/crm/v4/associations/${from}/${to}/labels`);
  const item = (r.results || []).find((x) => x.category === 'HUBSPOT_DEFINED' && !x.label) ||
    (r.results || []).find((x) => x.category === 'HUBSPOT_DEFINED') ||
    (r.results || [])[0];
  if (!item) throw new Error(`Associacao HubSpot nao encontrada: ${from} -> ${to}`);
  hsAssocCache[key] = item.typeId;
  return item.typeId;
}

async function hsAssociation(from, to, toId) {
  return {
    to: { id: String(toId) },
    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: await hsAssocTypeId(from, to) }]
  };
}

async function hsSearchDeals(term) {
  return hsFetch('/crm/v3/objects/deals/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: term, limit: 10, properties: ['dealname', 'amount', 'pipeline', 'dealstage', 'closedate'] })
  });
}

async function hsCreateNote(dealId, html, attachmentIds = []) {
  const properties = { hs_timestamp: new Date().toISOString(), hs_note_body: html };
  if (attachmentIds.length) properties.hs_attachment_ids = attachmentIds.join(';');
  return hsFetch('/crm/v3/objects/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties, associations: [await hsAssociation('notes', 'deals', dealId)] })
  });
}

async function createDealNote(dealId, html, attachmentIds = []) {
  if (await currentCrm() === 'hubspot') return hsCreateNote(dealId, html, attachmentIds);
  return pdFetch('/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deal_id: dealId, content: html })
  });
}

async function hsCreateTask(dealId, { subject, body, due, done, type }) {
  return hsFetch('/crm/v3/objects/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: {
        hs_timestamp: due || new Date().toISOString(),
        hs_task_subject: subject,
        hs_task_body: body || '',
        hs_task_status: done ? 'COMPLETED' : 'NOT_STARTED',
        hs_task_priority: 'MEDIUM',
        hs_task_type: type || 'TODO'
      },
      associations: [await hsAssociation('tasks', 'deals', dealId)]
    })
  });
}

async function hsUploadFile(base64, mime, filename) {
  const fd = new FormData();
  fd.append('file', b64ToBlob(base64, mime), filename);
  fd.append('fileName', filename);
  fd.append('folderPath', '/ConectCRM');
  fd.append('options', JSON.stringify({ access: 'PRIVATE' }));
  return hsFetch('/files/v3/files', { method: 'POST', body: fd });
}

function hsAssociationIds(obj, associationName) {
  return (((obj.associations || {})[associationName] || {}).results || [])
    .map((x) => x.id)
    .filter(Boolean)
    .slice(0, 10);
}

async function hsBatchReadObjects(objectType, ids, properties) {
  if (!ids.length) return [];
  const r = await hsFetch(`/crm/v3/objects/${objectType}/batch/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties, inputs: ids.map((id) => ({ id })) })
  });
  return r.results || [];
}

function plainTextFromHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ===== 1. Capturar =====
// Gancho instalado no contexto da P?GINA (MAIN world), com 3 camadas:
// 1) intercepta URL.createObjectURL de blobs de áudio
// 2) no evento "play" de qualquer <audio>, copia os bytes do blob na hora
// 3) se o áudio não vier de blob (MediaSource), grava o stream durante o play
function pageBlobHook() {
  if (window.__waPdHooked) return;
  window.__waPdHooked = true;
  const orig = URL.createObjectURL.bind(URL);
  const entries = [];
  const seenSrc = new Set();

  const stats = { seen: 0, ok: 0, readErr: 0, skipped: 0 };

  function getLogEl() {
    let el = document.getElementById('__waPdBlobLog');
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/json';
      el.id = '__waPdBlobLog';
      (document.documentElement || document.body).appendChild(el);
    }
    return el;
  }
  function flush() {
    try {
      getLogEl().textContent = JSON.stringify({
        stats,
        items: entries.filter((e) => e.b64).slice(-12)
      });
    } catch (_) {}
  }
  // cria o elemento de log já na instalação — diagnóstico nunca verá "null"
  flush();

  // tipos que nos interessam: áudios e documentos
  function isRelevant(type) {
    if (!type) return false;
    if (type.startsWith('audio')) return true;
    return /^(application\/(pdf|zip|x-zip|msword|vnd\.|octet-stream)|text\/(csv|plain))/.test(type);
  }

  function logBlob(blob, origin) {
    try {
      stats.seen++;
      if (!blob || blob.size === 0 || blob.size > 25 * 1024 * 1024) { stats.skipped++; flush(); return; }
      // converte para base64 AQUI (mundo da página): o content script não lê
      // blobs criados neste contexto (restrição do MV3)
      const entry = { b64: null, type: blob.type || 'application/octet-stream', ts: Date.now(), origin };
      entries.push(entry);
      const r = new FileReader();
      r.onload = () => {
        const res = String(r.result || '');
        const c = res.indexOf(',');
        entry.b64 = c >= 0 ? res.slice(c + 1) : '';
        if (entry.b64) stats.ok++; else stats.readErr++;
        flush();
      };
      r.onerror = () => { stats.readErr++; flush(); };
      r.readAsDataURL(blob);
    } catch (_) { stats.readErr++; flush(); }
  }

  // Camada 1: createObjectURL
  URL.createObjectURL = function (obj) {
    const url = orig(obj);
    try {
      if (obj instanceof Blob && isRelevant(obj.type)) {
        logBlob(obj, 'createObjectURL');
      }
    } catch (_) {}
    return url;
  };

  // Camadas 2 e 3: evento play
  document.addEventListener('play', (ev) => {
    const el = ev.target;
    if (!el || el.tagName !== 'AUDIO') return;
    const src = el.currentSrc || el.src || '';
    if (seenSrc.has(src) && src) return;
    if (src) seenSrc.add(src);

    if (src.startsWith('blob:')) {
      // Camada 2: copia os bytes do blob imediatamente
      fetch(src)
        .then((r) => r.blob())
        .then((b) => logBlob(b, 'play-fetch'))
        .catch(() => {});
    } else if (typeof el.captureStream === 'function') {
      // Camada 3: grava o stream enquanto toca (MediaSource etc.)
      try {
        const stream = el.captureStream();
        const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          if (chunks.length) logBlob(new Blob(chunks, { type: 'audio/webm' }), 'recorded');
        };
        const stop = () => { try { rec.state !== 'inactive' && rec.stop(); } catch (_) {} };
        el.addEventListener('ended', stop, { once: true });
        el.addEventListener('pause', stop, { once: true });
        rec.start();
      } catch (_) {}
    }
  }, true);
}

// Pede ao service worker a lista de downloads recentes e tenta casar com os
// documentos pendentes (que têm nome mas não têm bytes). Casa por nome.
async function getRecentDownloads() {
  return new Promise((res) => {
    try {
      chrome.runtime.sendMessage({ type: 'getRecentDownloads' }, (resp) => {
        if (chrome.runtime.lastError) { res([]); return; }
        res((resp && resp.downloads) || []);
      });
    } catch (_) { res([]); }
  });
}

function normalizeName(s) {
  return (s || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]/g, '');
}

async function mergeDownloadsIntoMedia(data) {
  const pending = (data.media || []).filter((m) => m.error && m.kind === 'doc');
  if (pending.length === 0) return;
  const downloads = await getRecentDownloads();
  if (downloads.length === 0) return;

  const usedDl = new Set();
  pending.forEach((p) => {
    // o item pendente guarda o nome no label "📄 nome.pdf"
    const pName = (p.label || '').replace(/^📄\s*/, '').trim();
    const pn = normalizeName(pName);
    // procura download com nome igual/contido, ainda não usado e com bytes
    let match = downloads.find((d) =>
      !usedDl.has(d.id) && d.base64 &&
      (normalizeName(d.filename) === pn ||
       (pn && (normalizeName(d.filename).includes(pn) || pn.includes(normalizeName(d.filename))))));
    // fallback: se só houver um download não usado com bytes, usa-o
    if (!match) {
      const avail = downloads.filter((d) => !usedDl.has(d.id) && d.base64);
      if (avail.length === 1 && pending.length === 1) match = avail[0];
    }
    if (match) {
      usedDl.add(match.id);
      // transforma o item de erro em mídia disponível
      p.error = undefined;
      p.filename = match.filename;
      p.mime = match.mime;
      p.base64 = match.base64;
      p.size = Math.floor(match.base64.length * 0.75);
      p.label = '📄 ' + match.filename;
    }
  });
}

// ===== Arquivos locais anexados manualmente =====
let localFiles = []; // { name, mime, base64, size }

$('localFiles').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])];
  const list = $('localFileList');
  for (const f of files) {
    if (f.size > 25 * 1024 * 1024) {
      const li = document.createElement('li');
      li.className = 'media-err';
      li.textContent = `${f.name} — acima de 25 MB, ignorado`;
      list.appendChild(li);
      continue;
    }
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] || '');
        r.onerror = () => rej(new Error('read'));
        r.readAsDataURL(f);
      });
      const entry = { name: f.name, mime: f.type || 'application/octet-stream', base64, size: f.size };
      localFiles.push(entry);
      const li = document.createElement('li');
      const kb = Math.round(f.size / 1024);
      li.innerHTML = `<label><input type="checkbox" class="local-check" value="${localFiles.length - 1}" checked />
        📎 ${f.name} · ${kb} KB</label>`;
      list.appendChild(li);
    } catch (_) {
      const li = document.createElement('li');
      li.className = 'media-err';
      li.textContent = `${f.name} — falha ao ler`;
      list.appendChild(li);
    }
  }
  e.target.value = ''; // permite re-selecionar
  updateSaveButton();
});

function updateMsgCount() {
  const total = document.querySelectorAll('.msg-check').length;
  const sel = document.querySelectorAll('.msg-check:checked').length;
  const label = $('msgCountLabel');
  if (label) label.textContent = `${sel}/${total}`;
}

// Selecionar todas as mensagens
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'msgSelectAll') {
    document.querySelectorAll('.msg-check').forEach((c) => { c.checked = e.target.checked; });
    updateMsgCount();
  } else if (e.target && e.target.classList && e.target.classList.contains('msg-check')) {
    const all = [...document.querySelectorAll('.msg-check')];
    const allChecked = all.every((c) => c.checked);
    const sa = $('msgSelectAll');
    if (sa) sa.checked = allChecked;
    updateMsgCount();
  } else if (e.target && e.target.id === 'mediaSelectAll') {
    document.querySelectorAll('.media-check').forEach((c) => { c.checked = e.target.checked; });
  } else if (e.target && e.target.classList && e.target.classList.contains('media-check')) {
    const all = [...document.querySelectorAll('.media-check')];
    const sa = $('mediaSelectAll');
    if (sa && all.length) sa.checked = all.every((c) => c.checked);
  }
});

$('btnCapture').addEventListener('click', async () => {
  const limit = parseInt($('msgCount').value, 10) || 20;
  const dateVal = $('msgDate').value || '';
  const statusEl = $('captureStatus');
  setStatus(statusEl, 'Capturando… (mídias podem demorar alguns segundos)', 'info');
  $('mediaBlock').classList.add('hidden');
  $('mediaList').innerHTML = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.startsWith('https://web.whatsapp.com')) {
      setStatus(statusEl, 'Abra o WhatsApp Web (web.whatsapp.com) e a conversa desejada antes de capturar.', 'err');
      return;
    }

    // 1. Instala o gancho de áudio no contexto da página (idempotente)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: pageBlobHook
    });

    // 2. Passa parâmetros e roda a extração
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (l, d) => { window.__waPdLimit = l; window.__waPdDate = d; },
      args: [limit, dateVal]
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    const data = results && results[0] && results[0].result;

    if (!data || data.error === 'NO_CHAT') {
      setStatus(statusEl, 'Nenhuma conversa aberta. Clique em uma conversa no WhatsApp Web.', 'err');
      return;
    }
    if (data.error === 'NO_MESSAGES_IN_DATE') {
      setStatus(statusEl, 'Nenhuma mensagem encontrada até a data escolhida entre as carregadas. Role a conversa para cima para carregar mensagens mais antigas.', 'err');
      return;
    }
    if (data.error === 'EXCEPTION') {
      const d = data.debug ? ` (debug: ${JSON.stringify(data.debug)})` : '';
      setStatus(statusEl, 'Erro ao ler a conversa: ' + (data.message || 'desconhecido') + d, 'err');
      return;
    }
    if (data.error === 'NO_MESSAGES') {
      const d = data.debug ? ` (debug: ${JSON.stringify(data.debug)})` : '';
      setStatus(statusEl, 'Não encontrei mensagens visíveis. Role a conversa e tente de novo.' + d, 'err');
      return;
    }

    captured = data;

    // Casa documentos pendentes (sem bytes no DOM) com downloads recentes
    await mergeDownloadsIntoMedia(data);

    const okMedia = (data.media || []).filter((m) => !m.error).length;
    const pendingAudio = (data.media || []).filter((m) => m.error && m.kind === 'audio').length;
    const pendingDoc = (data.media || []).filter((m) => m.error && m.kind === 'doc').length;
    let capMsg = `✓ ${data.total} mensagens capturadas de "${data.chatName || 'conversa'}"`;
    if (okMedia) capMsg += ` · ${okMedia} mídia(s) disponível(is)`;
    if (pendingAudio) {
      capMsg += ` · ${pendingAudio} áudio(s) pendente(s): dê play e capture de novo`;
    }
    if (pendingDoc) capMsg += ` · ${pendingDoc} documento(s): salve em uma pasta e use "Escolher arquivos" abaixo`;
    if (!data.chatPhone) capMsg += ' · telefone: abra "Dados do contato" no WhatsApp e capture de novo';
    setStatus(statusEl, capMsg + '.', (pendingAudio || pendingDoc) ? 'info' : 'ok');

    // Lista de mensagens com checkbox individual
    const msgUl = $('msgList');
    msgUl.innerHTML = '';
    data.messages.forEach((m, idx) => {
      const li = document.createElement('li');
      const who = m.meta || (m.direction === 'out' ? 'Você: ' : 'Contato: ');
      li.innerHTML = `<label><input type="checkbox" class="msg-check" value="${idx}" checked />
        <span class="msg-text"><span class="msg-who">${esc(who)}</span>${esc(m.text)}</span></label>`;
      msgUl.appendChild(li);
    });
    $('msgBlock').classList.remove('hidden');
    $('msgSelectAll').checked = true;
    updateMsgCount();

    // Lista de mídias com checkboxes
    if ((data.media || []).length > 0) {
      const ul = $('mediaList');
      data.media.forEach((m) => {
        const li = document.createElement('li');
        if (m.error) {
          li.className = 'media-err';
          li.textContent = `${m.label} — ${m.error}`;
        } else {
          const kb = Math.round(m.size / 1024);
          li.innerHTML = `<label><input type="checkbox" class="media-check" value="${m.id}" />
            ${m.label} · ${kb} KB <span class="media-from">${m.fromMeta || ''}</span></label>`;
        }
        ul.appendChild(li);
      });
      $('mediaBlock').classList.remove('hidden');
    }

    if (data.chatName && !$('dealSearch').value) $('dealSearch').value = data.chatName;
    if (data.chatName && !$('ndPerson').value) $('ndPerson').value = data.chatName;
    if (data.chatPhone && !$('ndPhone').value) $('ndPhone').value = data.chatPhone;
    updateSaveButton();
  } catch (e) {
    setStatus(statusEl, 'Erro ao capturar: ' + e.message, 'err');
  }
});

// ===== 2. Buscar deal =====
$('btnSearch').addEventListener('click', searchDeals);
$('dealSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchDeals(); });

function selectDeal(id, title) {
  selectedDeal = { id, title };
  $('dealSelected').innerHTML = `<span>Deal selecionado: ${esc(title)}</span><button type="button" class="clear-deal" id="btnClearDeal" title="Limpar selecao" aria-label="Limpar selecao">x</button>`;
  $('dealSelected').classList.remove('hidden');
  $('dealResults').innerHTML = '';
  closeAllPdForms();
  const cb = $('btnClearDeal'); if (cb) cb.addEventListener('click', clearDeal);
  updateSaveButton();
  loadDealPanel(id);
}

function clearDeal() {
  selectedDeal = null;
  const ds = $('dealSelected'); ds.classList.add('hidden'); ds.innerHTML = '';
  const dp = $('dealPanel'); dp.classList.add('hidden'); dp.innerHTML = '';
  $('dealSearch').value = '';
  closeAllPdForms();
  updateSaveButton();
}

// ===== Func. 5: resumo do deal + atividades em aberto =====
async function loadDealPanel(dealId) {
  const panel = $('dealPanel');
  panel.classList.remove('hidden');
  panel.innerHTML = '<div class="dp-loading">Carregando resumo do deal…</div>';
  try {
    if (await currentCrm() === 'hubspot') {
      const d = await hsFetch(`/crm/v3/objects/deals/${dealId}?properties=dealname,amount,pipeline,dealstage,closedate,createdate&associations=contacts,companies,notes,tasks`);
      const p = d.properties || {};
      const taskIds = hsAssociationIds(d, 'tasks');
      const noteIds = hsAssociationIds(d, 'notes');
      let tasks = [], notes = [];
      try {
        tasks = await hsBatchReadObjects('tasks', taskIds, ['hs_task_subject', 'hs_task_status', 'hs_task_body', 'hs_timestamp']);
      } catch (_) {}
      try {
        notes = await hsBatchReadObjects('notes', noteIds, ['hs_note_body', 'hs_timestamp']);
      } catch (_) {}
      const byDateDesc = (a, b) => new Date((b.properties || {}).hs_timestamp || b.createdAt || 0) - new Date((a.properties || {}).hs_timestamp || a.createdAt || 0);
      tasks.sort(byDateDesc);
      notes.sort(byDateDesc);
      const fmtHsDate = (v) => v ? new Date(v).toLocaleString('pt-BR') : 'sem data';
      const taskHtml = tasks.length
        ? '<ul class="dp-acts">' + tasks.slice(0, 5).map((t) => {
            const tp = t.properties || {};
            const done = tp.hs_task_status === 'COMPLETED';
            return `<li class="dp-act ${done ? 'done' : ''}"><div class="dp-act-line">`
              + `<span class="dp-act-type">${done ? 'Concluida' : 'Aberta'}</span>`
              + `<span class="dp-act-subj">${esc(tp.hs_task_subject || '(sem assunto)')}</span>`
              + `<span class="dp-act-date">${esc(fmtHsDate(tp.hs_timestamp))}</span>`
              + `</div>${tp.hs_task_body ? `<div class="dp-empty">${esc(plainTextFromHtml(tp.hs_task_body))}</div>` : ''}</li>`;
          }).join('') + '</ul>'
        : '<div class="dp-empty">Nenhuma atividade encontrada.</div>';
      const noteHtml = notes.length
        ? '<ul class="dp-acts">' + notes.slice(0, 5).map((n) => {
            const np = n.properties || {};
            return `<li class="dp-act"><div class="dp-act-line">`
              + `<span class="dp-act-type">Nota</span>`
              + `<span class="dp-act-subj">${esc(plainTextFromHtml(np.hs_note_body || '').slice(0, 180) || '(sem conteudo)')}</span>`
              + `<span class="dp-act-date">${esc(fmtHsDate(np.hs_timestamp))}</span>`
              + `</div></li>`;
          }).join('') + '</ul>'
        : '<div class="dp-empty">Nenhuma nota encontrada.</div>';
      panel.innerHTML = `
        <div class="dp-title">Resumo do deal (HubSpot)</div>
        <table class="dp-table">
          <tr><td>Nome</td><td>${esc(p.dealname || selectedDeal.title || '-')}</td></tr>
          <tr><td>Valor</td><td>${esc(p.amount || '-')}</td></tr>
          <tr><td>Pipeline</td><td>${esc(p.pipeline || '-')}</td></tr>
          <tr><td>Etapa</td><td>${esc(p.dealstage || '-')}</td></tr>
          <tr><td>Fechamento</td><td>${esc(p.closedate ? new Date(p.closedate).toLocaleDateString('pt-BR') : '-')}</td></tr>
        </table>
        <div class="dp-title">Atividades no HubSpot (${tasks.length})</div>
        ${taskHtml}
        <div class="dp-title">Notas no HubSpot (${notes.length})</div>
        ${noteHtml}`;
      return;
    }

    const dealResp = await pdFetch(`/deals/${dealId}`);
    const d = dealResp.data || {};
    const actResp = await pdFetch(`/deals/${dealId}/activities?done=0&limit=20`);
    const acts = (actResp.data || []).filter((a) => !a.done);
    const typeNames = await getActivityTypeNames();

    // Busca telefone/email do contato
    let phone = '—', email = '—';
    const personId = d.person_id && d.person_id.value;
    if (personId) {
      try {
        const p = await pdFetch(`/persons/${personId}`);
        const pd = p.data || {};
        const firstVal = (arr) => Array.isArray(arr) && arr.length
          ? ((arr.find((x) => x.primary) || arr[0]).value || '—') : '—';
        phone = firstVal(pd.phone);
        email = firstVal(pd.email);
      } catch (_) {}
    }

    // Nome do funil e da etapa
    let pipelineName = '—';
    if (d.pipeline_id) {
      pipelineName = pipelineNameCache[d.pipeline_id] || '';
      if (!pipelineName) {
        try {
          const pi = await pdFetch(`/pipelines/${d.pipeline_id}`);
          pipelineName = (pi.data && pi.data.name) || ('funil ' + d.pipeline_id);
          pipelineNameCache[d.pipeline_id] = pipelineName;
        } catch (_) { pipelineName = 'funil ' + d.pipeline_id; }
      }
    }
    let stageName = '—';
    if (d.stage_id) {
      stageName = stageNameCache[d.stage_id] || '';
      if (!stageName) {
        try {
          const s = await pdFetch(`/stages/${d.stage_id}`);
          stageName = (s.data && s.data.name) || ('etapa ' + d.stage_id);
          stageNameCache[d.stage_id] = stageName;
        } catch (_) { stageName = 'etapa ' + d.stage_id; }
      }
    }

    const fmtMoney = (v, cur) => v ? `${cur || ''} ${Number(v).toLocaleString('pt-BR')}`.trim() : '—';
    const statusMap = { open: 'Aberto', won: 'Ganho', lost: 'Perdido', deleted: 'Excluído' };

    let html = '<div class="dp-title">📊 Resumo do deal</div>';
    html += '<table class="dp-table">';
    html += `<tr><td>Título</td><td>${esc(d.title || '—')}</td></tr>`;
    html += `<tr><td>Valor</td><td>${fmtMoney(d.value, d.currency)}</td></tr>`;
    html += `<tr><td>Status</td><td>${statusMap[d.status] || d.status || '—'}</td></tr>`;
    html += `<tr><td>Funil</td><td>${esc(pipelineName)}</td></tr>`;
    html += `<tr><td>Etapa</td><td>${esc(stageName)}</td></tr>`;
    html += `<tr><td>Organização</td><td>${esc((d.org_id && d.org_id.name) || '—')}</td></tr>`;
    html += `<tr><td>Contato</td><td>${esc((d.person_id && d.person_id.name) || '—')}</td></tr>`;
    html += `<tr><td>Telefone</td><td>${esc(phone)}</td></tr>`;
    html += `<tr><td>E-mail</td><td>${esc(email)}</td></tr>`;
    html += `<tr><td>Proprietário</td><td>${esc((d.user_id && d.user_id.name) || '—')}</td></tr>`;
    html += '</table>';

    html += `<div class="dp-title">📋 Atividades em aberto (<span id="dpActCount">${acts.length}</span>)</div>`;
    if (acts.length === 0) {
      html += '<div class="dp-empty">Nenhuma atividade em aberto.</div>';
    } else {
      html += '<ul class="dp-acts">';
      acts.forEach((a) => {
        const due = pdLocalDue(a.due_date, a.due_time);
        const dateBR = due.dueDate ? due.dueDate.split('-').reverse().join('/') : 'sem data';
        const timeBR = due.dueTime ? ' ' + due.dueTime : '';
        const overdue = due.dueDate && due.dueDate < localYmd(new Date());
        const typeName = typeNames[a.type] || a.type || 'Atividade';
        const noteText = (a.note || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        html += `<li class="dp-act ${overdue ? 'overdue' : ''}" data-act-id="${a.id}">`
          + `<div class="dp-act-line">`
          + `<span class="dp-act-type">${esc(typeName)}</span>`
          + `<span class="dp-act-subj">${esc(a.subject || '(sem assunto)')}</span>`
          + `<span class="dp-act-date">${dateBR}${timeBR}${overdue ? ' ⚠' : ''}</span>`
          + `</div>`
          + `<div class="dp-act-tools">`
          + `<textarea class="dp-note" rows="1" placeholder="Anotacao para esta atividade...">${esc(noteText)}</textarea>`
          + `<div class="dp-act-actions">`
          + `<label class="dp-done-lbl"><input type="checkbox" class="dp-done" /> Marcar como feita</label>`
          + `<button type="button" class="dp-note-save">Salvar anotacao</button>`
          + `</div>`
          + `<span class="dp-act-msg"></span>`
          + `</div>`
          + `</li>`;
      });
      html += '</ul>';
    }
    panel.innerHTML = html;
    wireActivityTools(panel);
  } catch (e) {
    panel.innerHTML = `<div class="dp-empty">Não foi possível carregar o resumo: ${esc(e.message)}</div>`;
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const stageNameCache = {};
const pipelineNameCache = {};

// Mapa key_string -> nome amigável dos tipos de atividade (como aparece no Pipedrive)
let activityTypeNames = null;
async function getActivityTypeNames() {
  if (activityTypeNames) return activityTypeNames;
  try {
    const r = await pdFetch('/activityTypes');
    const map = {};
    (r.data || []).forEach((t) => { if (t.key_string) map[t.key_string] = t.name; });
    activityTypeNames = map;
  } catch (_) { activityTypeNames = {}; }
  return activityTypeNames;
}

// Atualiza uma atividade no Pipedrive (anotação e/ou marcar como feita)
async function updateActivity(actId, payload) {
  return pdFetch(`/activities/${actId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

// Liga os controles de cada atividade: salvar anotação e marcar como feita
function wireActivityTools(panel) {
  panel.querySelectorAll('.dp-act').forEach((li) => {
    const actId = li.getAttribute('data-act-id');
    const note = li.querySelector('.dp-note');
    const chk = li.querySelector('.dp-done');
    const btn = li.querySelector('.dp-note-save');
    const msg = li.querySelector('.dp-act-msg');
    const setMsg = (t, cls) => { msg.textContent = t; msg.className = 'dp-act-msg ' + (cls || ''); };

    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true; setMsg('Salvando…', 'info');
      try {
        await updateActivity(actId, { note: note.value });
        setMsg('Anotacao salva', 'ok');
      } catch (e) {
        setMsg('Erro ao salvar: ' + e.message, 'err');
      } finally { btn.disabled = false; }
    });

    if (chk) chk.addEventListener('change', async () => {
      if (!chk.checked) return;
      chk.disabled = true; setMsg('Marcando como feita…', 'info');
      try {
        // marca como feita e já persiste a anotação digitada (se houver)
        await updateActivity(actId, { done: 1, note: note.value });
        li.classList.add('done');
        note.disabled = true; if (btn) btn.disabled = true;
        setMsg('Concluída ✓', 'ok');
        const cnt = panel.querySelector('#dpActCount');
        if (cnt) cnt.textContent = Math.max(0, (parseInt(cnt.textContent, 10) || 1) - 1);
      } catch (e) {
        chk.checked = false; chk.disabled = false;
        setMsg('Erro: ' + e.message, 'err');
      }
    });
  });
}

// ===== Painel de atividades do CRM =====
let activityBoardRows = [];
let activityBoardCrm = 'pipedrive';
let hubspotPortalId = null;

function localYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(ymd) {
  if (!ymd) return null;
  const p = String(ymd).split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !n)) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function activityPeriodRange() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const period = $('actPeriod') ? $('actPeriod').value : 'today';
  if (period === 'overdue') return { key: period, start: null, end: addDays(today, -1) };
  if (period === 'today') return { key: period, start: today, end: today };
  if (period === 'tomorrow') return { key: period, start: addDays(today, 1), end: addDays(today, 1) };
  if (period === 'week') {
    const dow = today.getDay() || 7;
    const start = addDays(today, 1 - dow);
    return { key: period, start, end: addDays(start, 6) };
  }
  let customStart = parseYmd($('actDateStart') && $('actDateStart').value);
  let customEnd = parseYmd($('actDateEnd') && $('actDateEnd').value);
  if (customStart && customEnd && customStart > customEnd) {
    const tmp = customStart;
    customStart = customEnd;
    customEnd = tmp;
  }
  return {
    key: period,
    start: customStart,
    end: customEnd
  };
}

function dateEndExclusive(d) {
  if (!d) return null;
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), 1);
}

function activityObjectName(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v.name || v.title || v.value || '';
}

function activityObjectId(v) {
  if (!v) return '';
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  return v.id || v.value || '';
}

function externalLinkHtml(url, label) {
  if (!url) return '';
  return `<a class="act-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
}

function pdLocalDue(date, time) {
  if (!date) return { dueDate: '', dueTime: '', dueMs: 0 };
  const hhmm = String(time || '').slice(0, 5);
  if (!hhmm) return { dueDate: date, dueTime: '', dueMs: new Date(`${date}T00:00:00`).getTime() || 0 };
  const dt = new Date(`${date}T${hhmm}:00Z`);
  if (isNaN(dt)) return { dueDate: date, dueTime: hhmm, dueMs: 0 };
  return {
    dueDate: localYmd(dt),
    dueTime: String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'),
    dueMs: dt.getTime()
  };
}

function activityDueMs(row) {
  if (row.dueMs) return row.dueMs;
  if (!row.dueDate) return 0;
  return new Date(`${row.dueDate}T${row.dueTime || '00:00'}:00`).getTime() || 0;
}

function isActivityInSelectedPeriod(row) {
  const range = activityPeriodRange();
  if (!row.dueDate) return range.key === 'custom' && !range.start && !range.end;
  const due = parseYmd(row.dueDate);
  if (!due) return false;
  if (range.key === 'overdue') return due < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  if (range.start && due < range.start) return false;
  if (range.end && due > range.end) return false;
  return true;
}

function formatActivityDate(row) {
  if (!row.dueDate) return 'Sem data';
  const p = row.dueDate.split('-');
  const br = p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : row.dueDate;
  return row.dueTime ? `${br} ${row.dueTime}` : br;
}

function isActivityOverdue(row) {
  if (row.done || !row.dueDate) return false;
  const today = localYmd(new Date());
  return row.dueDate < today;
}

function normalizePdActivity(a, typeNames) {
  const typeKey = a.type || '';
  const person = activityObjectName(a.person_id) || a.person_name || '';
  const deal = activityObjectName(a.deal_id) || a.deal_title || '';
  const dealId = activityObjectId(a.deal_id);
  const due = pdLocalDue(a.due_date, a.due_time);
  return {
    crm: 'pipedrive',
    id: String(a.id),
    dealId,
    done: !!(a.done || a.done_flag),
    subject: a.subject || '(sem assunto)',
    type: typeKey,
    typeLabel: typeNames[typeKey] || typeKey || 'Atividade',
    deal,
    person,
    dueDate: due.dueDate,
    dueTime: due.dueTime,
    dueMs: due.dueMs,
    raw: a
  };
}

async function pdListActivityBoardRows(doneFilter) {
  const cfg = await getConfig();
  const typeNames = await getActivityTypeNames();
  const rows = [];
  const limit = 100;
  let start = 0;
  let keepGoing = true;
  while (keepGoing && rows.length < 1000) {
    const doneParam = doneFilter === 'all' ? '' : `&done=${doneFilter === 'done' ? 1 : 0}`;
    const r = await pdFetch(`/activities?start=${start}&limit=${limit}${doneParam}`);
    rows.push(...((r.data || []).map((a) => {
      const row = normalizePdActivity(a, typeNames);
      if (cfg.pdDomain && row.dealId) row.dealUrl = `https://${cfg.pdDomain}.pipedrive.com/deal/${row.dealId}`;
      return row;
    })));
    const pag = r.additional_data && r.additional_data.pagination;
    keepGoing = !!(pag && pag.more_items_in_collection);
    start = pag && pag.next_start != null ? pag.next_start : start + limit;
  }
  return rows;
}

function hsTaskTypeLabel(type) {
  const map = { TODO: 'Tarefa', CALL: 'Ligação', EMAIL: 'E-mail' };
  return map[type] || type || 'Tarefa';
}

function normalizeHsTask(t) {
  const p = t.properties || {};
  const due = p.hs_timestamp ? new Date(p.hs_timestamp) : null;
  const done = p.hs_task_status === 'COMPLETED';
  return {
    crm: 'hubspot',
    id: String(t.id),
    dealId: '',
    done,
    subject: p.hs_task_subject || '(sem assunto)',
    type: p.hs_task_type || 'TODO',
    typeLabel: hsTaskTypeLabel(p.hs_task_type || 'TODO'),
    deal: '',
    person: '',
    dueDate: due && !isNaN(due) ? localYmd(due) : '',
    dueTime: due && !isNaN(due) ? String(due.getHours()).padStart(2, '0') + ':' + String(due.getMinutes()).padStart(2, '0') : '',
    dueMs: due && !isNaN(due) ? due.getTime() : 0,
    raw: t
  };
}

async function hsPortalId() {
  if (hubspotPortalId) return hubspotPortalId;
  const info = await hsFetch('/account-info/v3/details').catch(() => null);
  hubspotPortalId = info && (info.portalId || info.accountId || info.hubId);
  return hubspotPortalId;
}

async function hsSearchTaskBoardRows(doneFilter) {
  const range = activityPeriodRange();
  const filters = [];
  if (doneFilter === 'open') filters.push({ propertyName: 'hs_task_status', operator: 'NEQ', value: 'COMPLETED' });
  if (doneFilter === 'done') filters.push({ propertyName: 'hs_task_status', operator: 'EQ', value: 'COMPLETED' });
  if (range.key === 'overdue') {
    filters.push({ propertyName: 'hs_timestamp', operator: 'LT', value: String(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()) });
  } else if (range.start || range.end) {
    const start = range.start || new Date(2000, 0, 1);
    const end = dateEndExclusive(range.end || range.start || new Date());
    filters.push({ propertyName: 'hs_timestamp', operator: 'BETWEEN', value: String(start.getTime()), highValue: String(end.getTime() - 1) });
  }

  const rows = [];
  let after = undefined;
  do {
    const body = {
      limit: 100,
      properties: ['hs_task_subject', 'hs_task_status', 'hs_task_body', 'hs_timestamp', 'hs_task_type', 'hs_task_priority'],
      filterGroups: filters.length ? [{ filters }] : [],
      sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }]
    };
    if (after) body.after = after;
    const r = await hsFetch('/crm/v3/objects/tasks/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    rows.push(...((r.results || []).map(normalizeHsTask)));
    after = r.paging && r.paging.next && r.paging.next.after;
  } while (after && rows.length < 500);

  await hsEnrichTaskAssociations(rows);
  return rows;
}

async function hsEnrichTaskAssociations(rows) {
  const tasks = rows.slice(0, 100);
  if (!tasks.length) return;
  const details = await Promise.all(tasks.map(async (row) => {
    try {
      const d = await hsFetch(`/crm/v3/objects/tasks/${row.id}?properties=hs_task_subject&associations=deals,contacts`);
      return { row, detail: d };
    } catch (_) {
      return { row, detail: null };
    }
  }));
  const dealIds = [];
  const contactIds = [];
  details.forEach(({ detail }) => {
    if (!detail) return;
    dealIds.push(...hsAssociationIds(detail, 'deals'));
    contactIds.push(...hsAssociationIds(detail, 'contacts'));
  });
  const uniqueDealIds = [...new Set(dealIds)].slice(0, 100);
  const uniqueContactIds = [...new Set(contactIds)].slice(0, 100);
  const deals = await hsBatchReadObjects('deals', uniqueDealIds, ['dealname']).catch(() => []);
  const contacts = await hsBatchReadObjects('contacts', uniqueContactIds, ['firstname', 'lastname', 'email']).catch(() => []);
  const dealMap = Object.fromEntries(deals.map((d) => [d.id, (d.properties && d.properties.dealname) || '']));
  const contactMap = Object.fromEntries(contacts.map((c) => {
    const p = c.properties || {};
    const name = `${p.firstname || ''} ${p.lastname || ''}`.trim() || p.email || '';
    return [c.id, name];
  }));
  details.forEach(({ row, detail }) => {
    if (!detail) return;
    const dId = hsAssociationIds(detail, 'deals')[0];
    const cId = hsAssociationIds(detail, 'contacts')[0];
    if (dId) {
      row.dealId = dId;
      row.deal = dealMap[dId] || '';
    }
    if (cId) row.person = contactMap[cId] || '';
  });
  const portalId = await hsPortalId().catch(() => null);
  if (portalId) {
    rows.forEach((row) => {
      if (row.dealId) row.dealUrl = `https://app.hubspot.com/contacts/${portalId}/deal/${row.dealId}`;
    });
  }
}

async function listActivityBoardRows() {
  const crm = await currentCrm();
  activityBoardCrm = crm;
  const doneFilter = $('actDoneFilter') ? $('actDoneFilter').value : 'open';
  if (crm === 'hubspot') return hsSearchTaskBoardRows(doneFilter);
  return pdListActivityBoardRows(doneFilter);
}

function updateActivityTypeFilter(rows) {
  const sel = $('actTypeFilter');
  if (!sel) return;
  const current = sel.value;
  const types = [...new Map(rows.map((r) => [r.type || r.typeLabel, r.typeLabel || r.type || 'Atividade'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  sel.innerHTML = '<option value="">Todos os tipos</option>' +
    types.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  if (types.some(([value]) => value === current)) sel.value = current;
}

function filteredActivityBoardRows() {
  const type = $('actTypeFilter') ? $('actTypeFilter').value : '';
  return activityBoardRows
    .filter((r) => isActivityInSelectedPeriod(r))
    .filter((r) => !type || r.type === type || r.typeLabel === type)
    .sort((a, b) => activityDueMs(a) - activityDueMs(b));
}

function renderActivityBoard() {
  const box = $('actRows');
  const summary = $('actSummary');
  if (!box) return;
  const rows = filteredActivityBoardRows();
  const crmLabel = activityBoardCrm === 'hubspot' ? 'HubSpot' : 'Pipedrive';
  if (summary) summary.textContent = `${rows.length} atividade(s) em ${crmLabel}.`;
  if (!rows.length) {
    box.innerHTML = '<div class="act-empty">Nenhuma atividade encontrada para esse filtro.</div>';
    return;
  }
  box.innerHTML = rows.map((r) => {
    const overdue = isActivityOverdue(r);
    const dealHtml = r.deal
      ? `Negócio: ${esc(r.deal)}${externalLinkHtml(r.dealUrl, 'Abrir deal')}`
      : 'Negócio: -';
    return `<div class="act-card ${r.done ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-id="${esc(r.id)}" data-crm="${r.crm}">
      <div class="act-topline">
        <input class="act-complete" type="checkbox" ${r.done ? 'checked disabled' : ''} title="Marcar como concluída" />
        <div class="act-subject"><span class="act-type">${esc(r.typeLabel)}</span>${esc(r.subject)}</div>
        <div class="act-date ${overdue ? 'overdue' : ''}">${esc(formatActivityDate(r))}</div>
      </div>
      <div class="act-meta">
        <span title="${esc(r.deal || '')}">${dealHtml}</span>
        <span title="${esc(r.person || '')}">Contato: ${esc(r.person || '-')}</span>
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.act-complete').forEach((chk) => chk.addEventListener('change', completeActivityFromBoard));
  box.querySelectorAll('.act-link').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    chrome.tabs.create({ url: a.href });
  }));
}

async function loadActivityBoard() {
  const st = $('actStatus');
  if ($('actCustomRange')) $('actCustomRange').classList.toggle('hidden', $('actPeriod').value !== 'custom');
  setStatus(st, 'Buscando atividades...', 'info');
  $('btnActRefresh').disabled = true;
  try {
    activityBoardRows = await listActivityBoardRows();
    updateActivityTypeFilter(activityBoardRows);
    renderActivityBoard();
    setStatus(st, 'Atividades carregadas.', 'ok');
  } catch (e) {
    activityBoardRows = [];
    renderActivityBoard();
    setStatus(st, 'Erro ao buscar atividades: ' + e.message, 'err');
  } finally {
    $('btnActRefresh').disabled = false;
  }
}

async function completeActivityFromBoard(e) {
  const chk = e.currentTarget;
  if (!chk.checked) return;
  const card = chk.closest('.act-card');
  const id = card && card.dataset.id;
  const crm = card && card.dataset.crm;
  chk.disabled = true;
  try {
    if (crm === 'hubspot') {
      await hsFetch(`/crm/v3/objects/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { hs_task_status: 'COMPLETED' } })
      });
    } else {
      await updateActivity(id, { done: 1 });
    }
    const row = activityBoardRows.find((r) => r.id === id && r.crm === crm);
    if (row) row.done = true;
    card.classList.add('done');
    renderActivityBoard();
  } catch (err) {
    chk.checked = false;
    chk.disabled = false;
    setStatus($('actStatus'), 'Erro ao concluir atividade: ' + err.message, 'err');
  }
}

function initActivityBoard() {
  if (!$('btnActivities')) return;
  $('btnActivities').addEventListener('click', async () => {
    const ls = await getLicenseState();
    if (!ls.licValid) { const r = await checkLicense(false); renderLicenseScreen(r); showView('license'); return; }
    showView('activities');
    loadActivityBoard();
  });
  $('btnActBack').addEventListener('click', () => showView('main'));
  $('btnActRefresh').addEventListener('click', loadActivityBoard);
  $('actPeriod').addEventListener('change', () => {
    $('actCustomRange').classList.toggle('hidden', $('actPeriod').value !== 'custom');
    if ($('actPeriod').value === 'custom' && !$('actDateStart').value && !$('actDateEnd').value) {
      const today = localYmd(new Date());
      $('actDateStart').value = today;
      $('actDateEnd').value = today;
    }
    loadActivityBoard();
  });
  $('actDoneFilter').addEventListener('change', loadActivityBoard);
  $('actTypeFilter').addEventListener('change', renderActivityBoard);
  $('actDateStart').addEventListener('change', loadActivityBoard);
  $('actDateEnd').addEventListener('change', loadActivityBoard);
}

// ===== Consulta de CNPJ =====
const CNPJ_PROVIDERS = [
  { name: 'BrasilAPI', url: (cnpj) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, normalize: normalizeCnpjBrasilApi },
  { name: 'Minha Receita', url: (cnpj) => `https://minhareceita.org/${cnpj}`, normalize: normalizeCnpjBrasilApi },
  { name: 'ReceitaWS', url: (cnpj) => `https://www.receitaws.com.br/v1/cnpj/${cnpj}`, normalize: normalizeCnpjReceitaWs }
];
let lastCnpjLookup = null;
let pendingCnpjDealNote = null;

function cnpjDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatCnpjDisplay(value) {
  const digits = cnpjDigits(value);
  if (digits.length !== 14) return value || '';
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatCnpjInput(value) {
  const digits = cnpjDigits(value).slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function isValidCnpj(cnpj) {
  if (!/^\d{14}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calcDigit = (base) => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0);
    const rest = sum % 11;
    return rest < 2 ? '0' : String(11 - rest);
  };
  const d1 = calcDigit(cnpj.slice(0, 12));
  const d2 = calcDigit(cnpj.slice(0, 12) + d1);
  return cnpj.endsWith(d1 + d2);
}

function cnpjFormatCep(value) {
  const digits = cnpjDigits(value);
  if (digits.length !== 8) return value || '';
  return digits.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2-$3');
}

function cnpjFormatPhone(value) {
  const digits = cnpjDigits(value);
  if (!digits) return '';
  if (digits.length === 10) return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  if (digits.length === 11) return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  return value || '';
}

function cnpjFormatCnae(value) {
  const digits = cnpjDigits(value);
  if (digits.length !== 7) return value ? String(value) : '';
  return digits.replace(/^(\d{2})(\d{2})(\d)(\d{2})$/, '$1.$2-$3-$4');
}

function cnpjToBrDate(value) {
  if (!value) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
}

function cnpjToMoney(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function cnpjBoolLabel(value) {
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  return '';
}

function cnpjJoin(values, separator) {
  return values.filter(Boolean).join(separator);
}

function normalizeCnpjBrasilApi(data) {
  return {
    cnpj: formatCnpjDisplay(data.cnpj),
    razaoSocial: data.razao_social || '',
    nomeFantasia: data.nome_fantasia || '',
    situacao: data.descricao_situacao_cadastral || '',
    tipo: data.descricao_identificador_matriz_filial || '',
    abertura: cnpjToBrDate(data.data_inicio_atividade),
    porte: data.porte || '',
    naturezaJuridica: data.natureza_juridica || '',
    capitalSocial: cnpjToMoney(data.capital_social),
    simples: cnpjBoolLabel(data.opcao_pelo_simples),
    simplesDesde: cnpjToBrDate(data.data_opcao_pelo_simples),
    mei: cnpjBoolLabel(data.opcao_pelo_mei),
    meiDesde: cnpjToBrDate(data.data_opcao_pelo_mei),
    cnaePrincipal: { codigo: cnpjFormatCnae(data.cnae_fiscal), descricao: data.cnae_fiscal_descricao || '' },
    cnaesSecundarios: (data.cnaes_secundarios || []).map((item) => ({
      codigo: cnpjFormatCnae(item.codigo),
      descricao: item.descricao || ''
    })),
    endereco: {
      logradouro: cnpjJoin([data.descricao_tipo_de_logradouro, data.logradouro], ' '),
      numero: data.numero || '',
      complemento: data.complemento || '',
      bairro: data.bairro || '',
      municipio: data.municipio || '',
      uf: data.uf || '',
      cep: cnpjFormatCep(data.cep)
    },
    contato: {
      telefone1: cnpjFormatPhone(data.ddd_telefone_1),
      telefone2: cnpjFormatPhone(data.ddd_telefone_2),
      email: data.email || ''
    },
    qsa: (data.qsa || []).map((socio) => ({
      nome: socio.nome_socio || '',
      qualificacao: socio.qualificacao_socio || '',
      faixaEtaria: socio.faixa_etaria || '',
      entradaSociedade: cnpjToBrDate(socio.data_entrada_sociedade),
      documentoMascarado: socio.cnpj_cpf_do_socio || ''
    }))
  };
}

function normalizeCnpjReceitaWs(data) {
  return {
    cnpj: data.cnpj || '',
    razaoSocial: data.nome || '',
    nomeFantasia: data.fantasia || '',
    situacao: data.situacao || '',
    tipo: data.tipo || '',
    abertura: data.abertura || '',
    porte: data.porte || '',
    naturezaJuridica: data.natureza_juridica || '',
    capitalSocial: cnpjToMoney(data.capital_social),
    simples: cnpjBoolLabel(data.simples && data.simples.optante),
    simplesDesde: data.simples && data.simples.data_opcao || '',
    mei: cnpjBoolLabel(data.simei && data.simei.optante),
    meiDesde: data.simei && data.simei.data_opcao || '',
    cnaePrincipal: {
      codigo: data.atividade_principal && data.atividade_principal[0] && data.atividade_principal[0].code || '',
      descricao: data.atividade_principal && data.atividade_principal[0] && data.atividade_principal[0].text || ''
    },
    cnaesSecundarios: (data.atividades_secundarias || []).map((item) => ({ codigo: item.code || '', descricao: item.text || '' })),
    endereco: {
      logradouro: data.logradouro || '',
      numero: data.numero || '',
      complemento: data.complemento || '',
      bairro: data.bairro || '',
      municipio: data.municipio || '',
      uf: data.uf || '',
      cep: data.cep || ''
    },
    contato: { telefone1: data.telefone || '', telefone2: '', email: data.email || '' },
    qsa: (data.qsa || []).map((socio) => ({ nome: socio.nome || '', qualificacao: socio.qual || '', faixaEtaria: '', entradaSociedade: '', documentoMascarado: '' }))
  };
}

function cnpjDeepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (Array.isArray(value)) {
      if (!(target[key] || []).length && value.length) target[key] = value;
      continue;
    }
    if (value && typeof value === 'object') {
      if (!target[key]) target[key] = {};
      cnpjDeepMerge(target[key], value);
      continue;
    }
    if (value && !target[key]) target[key] = value;
  }
}

function mergeCnpjSocios(socios) {
  const byName = new Map();
  socios.forEach((socio) => {
    if (!socio.nome) return;
    const key = socio.nome.toUpperCase();
    const current = byName.get(key) || {};
    cnpjDeepMerge(current, socio);
    byName.set(key, current);
  });
  return [...byName.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function mergeCnpjData(items) {
  const merged = {};
  items.forEach((item) => cnpjDeepMerge(merged, item));
  merged.qsa = mergeCnpjSocios(items.flatMap((item) => item.qsa || []));
  const cnaeMap = new Map();
  items.flatMap((item) => item.cnaesSecundarios || []).forEach((item) => {
    const key = `${item.codigo}|${item.descricao}`.trim();
    if (key && !cnaeMap.has(key)) cnaeMap.set(key, item);
  });
  merged.cnaesSecundarios = [...cnaeMap.values()];
  return merged;
}

async function consultarCnpj(rawCnpj) {
  const cnpj = cnpjDigits(rawCnpj);
  if (!isValidCnpj(cnpj)) return { ok: false, error: 'CNPJ inválido. Informe 14 dígitos válidos.' };
  const settled = await Promise.allSettled(CNPJ_PROVIDERS.map(async (provider) => {
    const response = await fetch(provider.url(cnpj), { headers: { Accept: 'application/json' } });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = { raw: text }; }
    if (!response.ok || payload && payload.status === 'ERROR') {
      throw new Error(payload && payload.message || `${provider.name}: erro HTTP ${response.status}`);
    }
    return { source: provider.name, raw: payload, data: provider.normalize(payload) };
  }));
  const results = settled.map((item, index) => item.status === 'fulfilled'
    ? item.value
    : { source: CNPJ_PROVIDERS[index].name, error: item.reason && item.reason.message || 'Falha na consulta' });
  const validResults = results.filter((item) => item.data);
  if (!validResults.length) return { ok: false, error: 'Nenhuma API retornou dados para este CNPJ.', results };
  return { ok: true, cnpj: formatCnpjDisplay(cnpj), merged: mergeCnpjData(validResults.map((item) => item.data)), results };
}

function cnpjCodeText(item) {
  if (!item) return '';
  return [item.codigo, item.descricao].filter(Boolean).join(' - ');
}

function cnpjCityUf(address) {
  if (!address) return '';
  return [address.municipio, address.uf].filter(Boolean).join('/');
}

function cnpjSection(title, fields) {
  const rows = fields.filter(([, value]) => value).map(([label, value]) =>
    `<div class="cnpj-field"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
  return rows ? `<section class="cnpj-section"><h2>${esc(title)}</h2><dl class="cnpj-fields">${rows}</dl></section>` : '';
}

function cnpjListSection(title, items, emptyText, renderItem) {
  const body = items.length
    ? `<ul class="cnpj-list">${items.map((item) => `<li>${renderItem(item)}</li>`).join('')}</ul>`
    : `<p class="cnpj-muted">${esc(emptyText)}</p>`;
  return `<section class="cnpj-section"><h2>${esc(title)}</h2>${body}</section>`;
}

function cnpjNoteLine(label, value) {
  return value ? `<b>${esc(label)}:</b> ${esc(value)}` : '';
}

function buildCnpjNoteHtml(company, sources) {
  const cnaePrincipal = cnpjCodeText(company.cnaePrincipal);
  const endereco = company.endereco || {};
  const contato = company.contato || {};
  const address = [
    endereco.logradouro,
    endereco.numero,
    endereco.complemento,
    endereco.bairro,
    cnpjCityUf(endereco),
    endereco.cep
  ].filter(Boolean).join(', ');
  const socios = (company.qsa || []).slice(0, 10).map((socio) => {
    const details = [socio.qualificacao, socio.documentoMascarado ? `Doc.: ${socio.documentoMascarado}` : ''].filter(Boolean).join(' | ');
    return `${socio.nome}${details ? ` (${details})` : ''}`;
  });
  const sourceText = (sources || []).map((source) => source.error
    ? `${source.source}: falhou (${source.error})`
    : `${source.source}: dados retornados`);

  return [
    '<b>Consulta de CNPJ - ConectCRM</b>',
    cnpjNoteLine('CNPJ', company.cnpj),
    cnpjNoteLine('Razão social', company.razaoSocial),
    cnpjNoteLine('Nome fantasia', company.nomeFantasia),
    cnpjNoteLine('Situação', company.situacao),
    cnpjNoteLine('Tipo', company.tipo),
    cnpjNoteLine('Abertura', company.abertura),
    cnpjNoteLine('Porte', company.porte),
    cnpjNoteLine('Natureza jurídica', company.naturezaJuridica),
    cnpjNoteLine('Capital social', company.capitalSocial),
    cnaePrincipal ? `<br><b>CNAE principal:</b> ${esc(cnaePrincipal)}` : '',
    address ? `<b>Endereço:</b> ${esc(address)}` : '',
    cnpjNoteLine('Telefone', contato.telefone1),
    cnpjNoteLine('Telefone 2', contato.telefone2),
    cnpjNoteLine('E-mail', contato.email),
    cnpjNoteLine('Simples', company.simples),
    cnpjNoteLine('Simples desde', company.simplesDesde),
    cnpjNoteLine('MEI/SIMEI', company.mei),
    cnpjNoteLine('MEI/SIMEI desde', company.meiDesde),
    socios.length ? `<br><b>Sócios / QSA:</b><br>${socios.map((s) => `- ${esc(s)}`).join('<br>')}` : '',
    sourceText.length ? `<br><b>Fontes consultadas:</b><br>${sourceText.map((s) => `- ${esc(s)}`).join('<br>')}` : ''
  ].filter(Boolean).join('<br>');
}

function cnpjOrganizationName(company) {
  return [company.nomeFantasia, company.razaoSocial].filter(Boolean).join(' | ') || company.razaoSocial || company.nomeFantasia || '';
}

function cnpjDealTitle(company) {
  return company.nomeFantasia || company.razaoSocial || 'Novo deal';
}

function cnpjAddressText(company) {
  const endereco = company.endereco || {};
  return [
    endereco.logradouro,
    endereco.numero,
    endereco.complemento,
    endereco.bairro,
    cnpjCityUf(endereco),
    endereco.cep
  ].filter(Boolean).join(', ');
}

function cnpjFirstPartnerName(company) {
  const partner = (company.qsa || []).find((socio) => socio && socio.nome);
  return partner ? partner.nome : '';
}

async function savePendingCnpjNoteForDeal(dealId) {
  if (!pendingCnpjDealNote) return false;
  const note = pendingCnpjDealNote;
  await createDealNote(dealId, buildCnpjNoteHtml(note.company, note.sources));
  pendingCnpjDealNote = null;
  return true;
}

async function prefillNewDealFromCnpj(contactName) {
  const st = $('cnpjStatus');
  if (!lastCnpjLookup || !lastCnpjLookup.merged) {
    setStatus(st, 'Faça uma consulta de CNPJ antes de criar o deal.', 'err');
    return;
  }
  const company = lastCnpjLookup.merged;
  const finalContact = String(contactName || '').trim();
  if (!finalContact) {
    $('cnpjContactPrompt').classList.remove('hidden');
    $('cnpjContactName').focus();
    setStatus(st, 'Informe o contato para continuar.', 'err');
    return;
  }

  pendingCnpjDealNote = { company, sources: lastCnpjLookup.results };
  chosenPerson.id = null;
  chosenOrg.id = null;
  showView('main');
  closeAllPdForms();
  $('btnNewDeal').classList.add('active');
  await openNewDealForm();

  $('ndPerson').value = finalContact;
  $('ndOrg').value = cnpjOrganizationName(company);
  if ($('ndOrgAddress')) $('ndOrgAddress').value = cnpjAddressText(company);
  $('ndTitle').value = cnpjDealTitle(company);
  const contato = company.contato || {};
  $('ndPhone').value = contato.telefone1 || contato.telefone2 || '';
  $('ndEmail').value = contato.email || '';
  setStatus($('newDealStatus'), 'Dados do CNPJ preenchidos. Revise e clique em "Criar deal" para salvar.', 'info');
  try { $('newDealForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
}

function startCnpjDealCreation() {
  const company = lastCnpjLookup && lastCnpjLookup.merged;
  if (!company) {
    setStatus($('cnpjStatus'), 'Faça uma consulta de CNPJ antes de criar o deal.', 'err');
    return;
  }
  const partnerName = cnpjFirstPartnerName(company);
  if (partnerName) {
    $('cnpjContactPrompt').classList.add('hidden');
    prefillNewDealFromCnpj(partnerName);
    return;
  }
  $('cnpjContactPrompt').classList.remove('hidden');
  $('cnpjContactName').value = '';
  $('cnpjContactName').focus();
}

async function saveCnpjNoteToDeal() {
  const st = $('cnpjStatus');
  if (!lastCnpjLookup || !lastCnpjLookup.merged) {
    setStatus(st, 'Faça uma consulta de CNPJ antes de salvar.', 'err');
    return;
  }
  if (!selectedDeal) {
    setStatus(st, 'Selecione um deal na tela principal antes de salvar a anotação.', 'err');
    return;
  }
  const btn = $('btnCnpjSaveDeal');
  if (btn) btn.disabled = true;
  setStatus(st, 'Salvando anotação no deal...', 'info');
  try {
    await createDealNote(selectedDeal.id, buildCnpjNoteHtml(lastCnpjLookup.merged, lastCnpjLookup.results));
    setStatus(st, `Consulta de CNPJ salva como anotação no deal "${selectedDeal.title}".`, 'ok');
    loadDealPanel(selectedDeal.id);
  } catch (e) {
    setStatus(st, 'Erro ao salvar anotação: ' + e.message, 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderCnpjResult(company, sources) {
  const box = $('cnpjResult');
  const html = [
    `<div class="cnpj-actions">
      <button type="button" id="btnCnpjCreateDeal" class="primary">Criar novo deal com estes dados</button>
      <button type="button" id="btnCnpjSaveDeal" class="primary">Salvar como anotação no deal</button>
      <small>${selectedDeal ? `Deal selecionado: ${esc(selectedDeal.title)}` : 'Selecione um deal na tela principal antes de salvar.'}</small>
    </div>`,
    cnpjSection('Cadastro', [
      ['CNPJ', company.cnpj],
      ['Razão social', company.razaoSocial],
      ['Nome fantasia', company.nomeFantasia],
      ['Situação', company.situacao],
      ['Tipo', company.tipo],
      ['Abertura', company.abertura],
      ['Porte', company.porte],
      ['Natureza', company.naturezaJuridica],
      ['Capital social', company.capitalSocial]
    ]),
    cnpjSection('Atividade principal', [
      ['CNAE', cnpjCodeText(company.cnaePrincipal)]
    ]),
    cnpjListSection('CNAEs secundários', company.cnaesSecundarios || [], 'Nenhum CNAE secundário retornado.', (item) => esc(cnpjCodeText(item))),
    cnpjSection('Endereço', [
      ['Logradouro', company.endereco && company.endereco.logradouro],
      ['Número', company.endereco && company.endereco.numero],
      ['Complemento', company.endereco && company.endereco.complemento],
      ['Bairro', company.endereco && company.endereco.bairro],
      ['Cidade/UF', cnpjCityUf(company.endereco)],
      ['CEP', company.endereco && company.endereco.cep]
    ]),
    cnpjSection('Contato e regime', [
      ['Telefone', company.contato && company.contato.telefone1],
      ['Telefone 2', company.contato && company.contato.telefone2],
      ['E-mail', company.contato && company.contato.email],
      ['Simples', company.simples],
      ['Simples desde', company.simplesDesde],
      ['MEI/SIMEI', company.mei],
      ['MEI/SIMEI desde', company.meiDesde]
    ]),
    cnpjListSection('Sócios / QSA', company.qsa || [], 'Nenhum sócio retornado pelas APIs.', (socio) => {
      const details = [
        socio.qualificacao,
        socio.faixaEtaria ? `Faixa etária: ${socio.faixaEtaria}` : '',
        socio.entradaSociedade ? `Entrada: ${socio.entradaSociedade}` : '',
        socio.documentoMascarado ? `Doc.: ${socio.documentoMascarado}` : ''
      ].filter(Boolean).join(' | ');
      return `<strong>${esc(socio.nome)}</strong>${details ? `<br><span class="cnpj-muted">${esc(details)}</span>` : ''}`;
    }),
    cnpjListSection('Fontes consultadas', sources || [], 'Nenhuma fonte consultada.', (source) =>
      esc(source.error ? `${source.source}: falhou (${source.error})` : `${source.source}: dados retornados`))
  ].join('');
  box.innerHTML = html;
  box.classList.remove('hidden');
  const createBtn = $('btnCnpjCreateDeal');
  if (createBtn) createBtn.addEventListener('click', startCnpjDealCreation);
  const btn = $('btnCnpjSaveDeal');
  if (btn) btn.addEventListener('click', saveCnpjNoteToDeal);
}

async function runCnpjSearch() {
  const st = $('cnpjStatus');
  const input = $('cnpjInput');
  lastCnpjLookup = null;
  $('cnpjContactPrompt').classList.add('hidden');
  $('cnpjResult').classList.add('hidden');
  $('cnpjResult').innerHTML = '';
  $('btnCnpjSearch').disabled = true;
  setStatus(st, 'Consultando CNPJ...', 'info');
  try {
    const response = await consultarCnpj(input.value);
    if (!response.ok) {
      setStatus(st, response.error || 'Não foi possível consultar.', 'err');
      return;
    }
    lastCnpjLookup = response;
    renderCnpjResult(response.merged, response.results);
    setStatus(st, 'Consulta concluída.', 'ok');
  } catch (e) {
    setStatus(st, 'Erro na consulta: ' + e.message, 'err');
  } finally {
    $('btnCnpjSearch').disabled = false;
  }
}

function initCnpjLookup() {
  if (!$('btnCnpj')) return;
  $('btnCnpj').addEventListener('click', async () => {
    const ls = await getLicenseState();
    if (!ls.licValid) { const r = await checkLicense(false); renderLicenseScreen(r); showView('license'); return; }
    showView('cnpj');
  });
  $('btnCnpjBack').addEventListener('click', () => showView('main'));
  $('btnCnpjSearch').addEventListener('click', runCnpjSearch);
  $('btnCnpjConfirmDeal').addEventListener('click', () => prefillNewDealFromCnpj($('cnpjContactName').value));
  $('cnpjInput').addEventListener('input', () => { $('cnpjInput').value = formatCnpjInput($('cnpjInput').value); });
  $('cnpjInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runCnpjSearch(); } });
  $('cnpjContactName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); prefillNewDealFromCnpj($('cnpjContactName').value); } });
}

async function searchDeals() {
  const term = $('dealSearch').value.trim();
  const list = $('dealResults');
  list.innerHTML = '';
  if (term.length < 2) { list.innerHTML = '<li>Digite pelo menos 2 caracteres.</li>'; return; }
  const crm = await currentCrm();
  list.innerHTML = `<li>Buscando no ${crm === 'hubspot' ? 'HubSpot' : 'Pipedrive'}...</li>`;
  try {
    if (crm === 'hubspot') {
      const json = await hsSearchDeals(term);
      const items = json.results || [];
      list.innerHTML = '';
      if (items.length === 0) {
        list.innerHTML = '<li>Nenhum deal encontrado no HubSpot. Voce pode criar um novo abaixo.</li>';
        openNewDealForm();
        return;
      }
      items.forEach((item) => {
        const li = document.createElement('li');
        const p = item.properties || {};
        const title = p.dealname || `Deal ${item.id}`;
        const meta = [p.amount ? `Valor: ${p.amount}` : '', p.dealstage ? `Etapa: ${p.dealstage}` : ''].filter(Boolean).join(' | ');
        li.innerHTML = `<strong>${esc(title)}</strong>${meta ? `<span class="org">${esc(meta)}</span>` : ''}`;
        li.addEventListener('click', () => selectDeal(item.id, title));
        list.appendChild(li);
      });
      return;
    }

    const json = await pdFetch(`/deals/search?term=${encodeURIComponent(term)}&limit=10`);
    const items = (json.data && json.data.items) || [];
    list.innerHTML = '';
    if (items.length === 0) {
      list.innerHTML = '<li>Nenhum deal encontrado. Voce pode criar um novo abaixo.</li>';
      openNewDealForm();
      return;
    }
    items.forEach(({ item }) => {
      const li = document.createElement('li');
      const org = item.organization ? item.organization.name : (item.person ? item.person.name : '');
      li.innerHTML = `<strong>${item.title}</strong>${org ? `<span class="org">${org}</span>` : ''}`;
      li.addEventListener('click', () => selectDeal(item.id, item.title));
      list.appendChild(li);
    });
  } catch (e) {
    list.innerHTML = `<li>Erro: ${e.message}</li>`;
  }
}

// ===== Novo deal =====
// ===== Botões de ação (Novo deal / Atividade / Nota) com toggle (acordeão) =====
const PD_FORMS = {
  deal: { form: 'newDealForm', btn: 'btnNewDeal', open: openNewDealForm },
  activity: { form: 'newActivityForm', btn: 'btnNewActivity', open: openNewActivityForm },
  note: { form: 'newNoteForm', btn: 'btnNewNote', open: openNewNoteForm }
};
function closeAllPdForms() {
  Object.values(PD_FORMS).forEach(({ form, btn }) => {
    const f = $(form); if (f) f.classList.add('hidden');
    const b = $(btn); if (b) b.classList.remove('active');
  });
}
function togglePdForm(which) {
  const cfg = PD_FORMS[which];
  const isOpen = !$(cfg.form).classList.contains('hidden');
  closeAllPdForms();
  if (!isOpen) {            // estava fechado → abre (e fecha os outros)
    $(cfg.btn).classList.add('active');
    cfg.open();
  }
}
$('btnNewDeal').addEventListener('click', () => togglePdForm('deal'));
$('btnNewActivity').addEventListener('click', () => togglePdForm('activity'));
$('btnNewNote').addEventListener('click', () => togglePdForm('note'));

let newDealLoaded = false;
let hsPipelineStages = {};
async function loadHubSpotDealFormData() {
  const pipes = await hsFetch('/crm/v3/pipelines/deals');
  const pipeSel = $('ndPipeline');
  pipeSel.innerHTML = '';
  hsPipelineStages = {};
  (pipes.results || []).forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.label || p.id;
    pipeSel.appendChild(o);
    hsPipelineStages[p.id] = p.stages || [];
  });
  pipeSel.onchange = () => loadStages(pipeSel.value);
  if (pipeSel.value) await loadStages(pipeSel.value);

  const ownerSel = $('ndOwner');
  ownerSel.innerHTML = '<option value="">Sem proprietario</option>';
  try {
    const owners = await hsFetch('/crm/v3/owners?limit=100');
    (owners.results || []).forEach((u) => {
      const o = document.createElement('option');
      o.value = u.id; o.textContent = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;
      ownerSel.appendChild(o);
    });
  } catch (_) {}
  $('ndLabel').innerHTML = '<option value="">HubSpot nao usa etiqueta aqui</option>';
  $('ndChannel').innerHTML = '<option value="">HubSpot nao usa canal aqui</option>';
}
async function openNewDealForm() {
  $('newDealForm').classList.remove('hidden');
  if (!$('ndTitle').value && captured && captured.chatName) {
    $('ndTitle').value = captured.chatName;
    if (!$('ndPerson').value) $('ndPerson').value = captured.chatName;
  }
  if (newDealLoaded) return;
  const st = $('newDealStatus');
  setStatus(st, 'Carregando funis, etiquetas e usuários…', 'info');
  try {
    if (await currentCrm() === 'hubspot') {
      await loadHubSpotDealFormData();
      newDealLoaded = true;
      st.classList.add('hidden');
      return;
    }

    // Funis
    const pipes = await pdFetch('/pipelines');
    const pipeSel = $('ndPipeline');
    pipeSel.innerHTML = '';
    (pipes.data || []).forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      pipeSel.appendChild(o);
    });
    pipeSel.addEventListener('change', () => loadStages(pipeSel.value));
    if (pipeSel.value) await loadStages(pipeSel.value);

    // Usuários (proprietário)
    const users = await pdFetch('/users');
    const ownerSel = $('ndOwner');
    ownerSel.innerHTML = '';
    (users.data || []).filter((u) => u.active_flag).forEach((u) => {
      const o = document.createElement('option');
      o.value = u.id; o.textContent = u.name;
      if (u.is_you) o.selected = true;
      ownerSel.appendChild(o);
    });

    // Campos do deal: etiqueta (label) e Canal de origem
    const fields = await pdFetch('/dealFields');
    const labelField = (fields.data || []).find((f) => f.key === 'label');
    if (labelField && labelField.options) {
      const sel = $('ndLabel');
      labelField.options.forEach((op) => {
        const o = document.createElement('option');
        o.value = op.id; o.textContent = op.label;
        sel.appendChild(o);
      });
    }
    const channelField = (fields.data || []).find((f) =>
      /canal de origem/i.test(f.name || '')
    );
    if (channelField) {
      channelFieldKey = channelField.key;
      const sel = $('ndChannel');
      (channelField.options || []).forEach((op) => {
        const o = document.createElement('option');
        o.value = op.id; o.textContent = op.label;
        sel.appendChild(o);
      });
      if (!channelField.options) {
        // campo de texto livre: troca select por input
        sel.outerHTML = '<input id="ndChannel" type="text" placeholder="Ex.: WhatsApp" />';
      }
    } else {
      $('ndChannel').innerHTML = '<option value="">Campo não encontrado na conta</option>';
    }

    newDealLoaded = true;
    st.classList.add('hidden');
  } catch (e) {
    setStatus(st, 'Erro ao carregar dados: ' + e.message, 'err');
  }
}

async function loadStages(pipelineId) {
  const sel = $('ndStage');
  sel.innerHTML = '<option>Carregando…</option>';
  if (await currentCrm() === 'hubspot') {
    sel.innerHTML = '';
    (hsPipelineStages[pipelineId] || []).forEach((s) => {
      const o = document.createElement('option');
      o.value = s.id; o.textContent = s.label || s.id;
      sel.appendChild(o);
    });
    return;
  }

  const json = await pdFetch(`/stages?pipeline_id=${pipelineId}`);
  sel.innerHTML = '';
  (json.data || []).forEach((s) => {
    stageNameCache[s.id] = s.name;
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.name;
    sel.appendChild(o);
  });
}

// ===== Autocomplete anti-duplicação (Pessoa / Organização) =====
const chosenPerson = { id: null };
const chosenOrg = { id: null };

function setupAutocomplete({ inputId, boxId, endpoint, chosenRef, kind, onPick }) {
  const input = $(inputId), box = $(boxId);
  if (!input || !box) return;
  let timer = null;
  input.addEventListener('input', async () => {
    chosenRef.id = null; // editar invalida a escolha anterior
    const term = input.value.trim();
    clearTimeout(timer);
    if (await currentCrm() === 'hubspot') {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    if (term.length < 2) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.innerHTML = '<li class="ac-loading">Buscando no Pipedrive…</li>';
    box.classList.remove('hidden');
    timer = setTimeout(() => buscar(term), 300);
  });
  input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 180));
  input.addEventListener('focus', () => { if (box.innerHTML && input.value.trim().length >= 2) box.classList.remove('hidden'); });

  async function buscar(term) {
    try {
      const fields = kind === 'person' ? 'name,email,phone' : 'name';
      const r = await pdFetch(`${endpoint}?term=${encodeURIComponent(term)}&fields=${fields}&limit=6`);
      const items = (r.data && r.data.items) ? r.data.items.map((x) => x.item).filter(Boolean) : [];
      render(items, term);
    } catch (e) {
      box.innerHTML = `<li class="ac-item ac-new" data-id="" data-name="${esc(term)}">＋ Criar novo: “${esc(term)}?</li>`;
      bindItems([], box);
    }
  }
  function subtitle(it) {
    if (kind === 'person') {
      const org = it.organization ? it.organization.name : '';
      const phone = (it.phones && it.phones[0]) ? it.phones[0] : '';
      const mail = (it.emails && it.emails[0]) ? it.emails[0] : '';
      return [org, phone || mail].filter(Boolean).join(' · ');
    }
    return it.address || (it.owner ? ('Resp.: ' + (it.owner.name || '')) : '');
  }
  function render(items, term) {
    let html = items.map((it) =>
      `<li class="ac-item" data-id="${it.id}" data-name="${esc(it.name || '')}">${esc(it.name || '')}` +
      (subtitle(it) ? `<span class="ac-sub">${esc(subtitle(it))}</span>` : '') + `</li>`
    ).join('');
    html += `<li class="ac-item ac-new" data-id="" data-name="${esc(term)}">＋ Criar novo: “${esc(term)}?</li>`;
    box.innerHTML = html;
    box.classList.remove('hidden');
    bindItems(items, box);
  }
  function bindItems(items, box) {
    box.querySelectorAll('.ac-item').forEach((li) => li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const id = li.getAttribute('data-id');
      const name = li.getAttribute('data-name');
      input.value = name;
      chosenRef.id = id ? parseInt(id, 10) : null;
      box.classList.add('hidden');
      const raw = id ? items.find((x) => String(x.id) === id) : null;
      if (onPick) onPick(raw);
    }));
  }
}

// Ao escolher uma pessoa existente, preenche os campos para conferência
function preencherPessoa(p) {
  if (!p) return;
  if (p.organization && p.organization.name && !$('ndOrg').value.trim()) {
    $('ndOrg').value = p.organization.name;
    chosenOrg.id = p.organization.id || null;
  }
  if ((p.phones && p.phones[0]) && !$('ndPhone').value.trim()) $('ndPhone').value = p.phones[0];
  if ((p.emails && p.emails[0]) && !$('ndEmail').value.trim()) $('ndEmail').value = p.emails[0];
}

setupAutocomplete({ inputId: 'ndPerson', boxId: 'ndPersonAc', endpoint: '/persons/search', chosenRef: chosenPerson, kind: 'person', onPick: preencherPessoa });
setupAutocomplete({ inputId: 'ndOrg', boxId: 'ndOrgAc', endpoint: '/organizations/search', chosenRef: chosenOrg, kind: 'org' });

function splitNameForHubSpot(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstname: parts.shift() || name || '', lastname: parts.join(' ') };
}

async function hsCreateDealFromForm(personName, title) {
  const associations = [];
  const email = $('ndEmail').value.trim();
  const phone = $('ndPhone').value.trim();
  if (personName || email || phone) {
    const nm = splitNameForHubSpot(personName);
    const contact = await hsFetch('/crm/v3/objects/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { firstname: nm.firstname, lastname: nm.lastname, email, phone } })
    });
    associations.push(await hsAssociation('deals', 'contacts', contact.id));
  }
  const orgName = $('ndOrg').value.trim();
  if (orgName) {
    const orgAddress = $('ndOrgAddress') ? $('ndOrgAddress').value.trim() : '';
    const properties = { name: orgName };
    if (orgAddress) properties.address = orgAddress;
    const company = await hsFetch('/crm/v3/objects/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties })
    });
    associations.push(await hsAssociation('deals', 'companies', company.id));
  }
  const properties = {
    dealname: title,
    pipeline: $('ndPipeline').value || undefined,
    dealstage: $('ndStage').value || undefined,
    hubspot_owner_id: $('ndOwner').value || undefined
  };
  Object.keys(properties).forEach((k) => properties[k] === undefined && delete properties[k]);
  return hsFetch('/crm/v3/objects/deals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties, associations })
  });
}

$('btnCreateDeal').addEventListener('click', async () => {
  const st = $('newDealStatus');
  const personName = $('ndPerson').value.trim();
  const title = $('ndTitle').value.trim();
  if (!personName || !title) {
    setStatus(st, 'Preencha ao menos a Pessoa de contato e o Título.', 'err');
    return;
  }
  setStatus(st, 'Criando…', 'info');
  $('btnCreateDeal').disabled = true;
  try {
    if (await currentCrm() === 'hubspot') {
      const deal = await hsCreateDealFromForm(personName, title);
      chosenPerson.id = null; chosenOrg.id = null;
      selectDeal(deal.id, title);
      try {
        const savedCnpjNote = await savePendingCnpjNoteForDeal(deal.id);
        setStatus(st, `Deal "${title}" criado no HubSpot${savedCnpjNote ? ' e anotação do CNPJ salva' : ''}.`, 'ok');
      } catch (noteErr) {
        setStatus(st, `Deal "${title}" criado, mas a anotação do CNPJ não foi salva: ${noteErr.message}`, 'err');
      }
      return;
    }

    // 1. Organização: usa a existente escolhida (anti-duplicação) ou cria nova
    let orgId = chosenOrg.id || null;
    const orgName = $('ndOrg').value.trim();
    const orgAddress = $('ndOrgAddress') ? $('ndOrgAddress').value.trim() : '';
    if (!orgId && orgName) {
      const orgBody = { name: orgName };
      if (orgAddress) orgBody.address = orgAddress;
      const org = await pdFetch('/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orgBody)
      });
      orgId = org.data.id;
    } else if (orgId && orgAddress) {
      await pdFetch(`/organizations/${orgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: orgAddress })
      });
    }

    // 2. Pessoa: usa a existente escolhida ou cria nova
    let personId = chosenPerson.id || null;
    if (!personId) {
      const personBody = { name: personName };
      if (orgId) personBody.org_id = orgId;
      const phone = $('ndPhone').value.trim();
      const email = $('ndEmail').value.trim();
      if (phone) personBody.phone = [{ value: phone, primary: true, label: 'work' }];
      if (email) personBody.email = [{ value: email, primary: true, label: 'work' }];
      const person = await pdFetch('/persons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(personBody)
      });
      personId = person.data.id;
    }

    // 3. Deal
    const dealBody = {
      title,
      person_id: personId,
      pipeline_id: parseInt($('ndPipeline').value, 10) || undefined,
      stage_id: parseInt($('ndStage').value, 10) || undefined,
      user_id: parseInt($('ndOwner').value, 10) || undefined
    };
    if (orgId) dealBody.org_id = orgId;
    const labelVal = $('ndLabel').value;
    if (labelVal) dealBody.label = parseInt(labelVal, 10);
    const channelEl = $('ndChannel');
    const channelVal = channelEl ? channelEl.value : '';
    if (channelFieldKey && channelVal) dealBody[channelFieldKey] = channelVal;

    const deal = await pdFetch('/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dealBody)
    });

    chosenPerson.id = null; chosenOrg.id = null;
    selectDeal(deal.data.id, deal.data.title);
    try {
      const savedCnpjNote = await savePendingCnpjNoteForDeal(deal.data.id);
      setStatus(st, `✓ Deal "${deal.data.title}" criado${savedCnpjNote ? ' + anotação do CNPJ salva' : ''}.`, 'ok');
    } catch (noteErr) {
      setStatus(st, `✓ Deal "${deal.data.title}" criado, mas a anotação do CNPJ não foi salva: ${noteErr.message}`, 'err');
    }
  } catch (e) {
    setStatus(st, 'Erro ao criar deal: ' + e.message, 'err');
  } finally {
    $('btnCreateDeal').disabled = false;
  }
});

// ===== Criar nova atividade (vinculada ao deal selecionado) =====
let newActivityLoaded = false;

async function openNewActivityForm() {
  const form = $('newActivityForm');
  const st = $('newActivityStatus');
  form.classList.remove('hidden');

  if (!selectedDeal) {
    $('naDealInfo').innerHTML = '⚠ Selecione um deal acima para vincular a atividade.';
    $('btnCreateActivity').disabled = true;
    return;
  }
  $('btnCreateActivity').disabled = false;
  $('naDealInfo').innerHTML = `Vinculada ao deal: <b>${esc(selectedDeal.title)}</b>`;

  // data padrão = hoje (local)
  if (!$('naDate').value) {
    const d = new Date();
    $('naDate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  if (newActivityLoaded) return;
  setStatus(st, 'Carregando tipos de atividade…', 'info');
  try {
    if (await currentCrm() === 'hubspot') {
      $('naType').innerHTML = '<option value="TODO">Tarefa</option><option value="CALL">Ligacao</option><option value="EMAIL">E-mail</option>';
      const ownerSel = $('naOwner');
      ownerSel.innerHTML = '<option value="">Sem proprietario</option>';
      try {
        const owners = await hsFetch('/crm/v3/owners?limit=100');
        (owners.results || []).forEach((u) => {
          const o = document.createElement('option');
          o.value = u.id; o.textContent = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;
          ownerSel.appendChild(o);
        });
      } catch (_) {}
      newActivityLoaded = true;
      st.classList.add('hidden');
      return;
    }

    // Tipos de atividade cadastrados no Pipedrive
    const types = await pdFetch('/activityTypes');
    const typeSel = $('naType');
    typeSel.innerHTML = '';
    (types.data || [])
      .filter((t) => t.active_flag !== false)
      .sort((a, b) => (a.order_nr || 0) - (b.order_nr || 0))
      .forEach((t) => {
        const o = document.createElement('option');
        o.value = t.key_string; o.textContent = t.name;
        typeSel.appendChild(o);
      });

    // Proprietário (usuários ativos)
    const users = await pdFetch('/users');
    const ownerSel = $('naOwner');
    ownerSel.innerHTML = '';
    (users.data || []).filter((u) => u.active_flag).forEach((u) => {
      const o = document.createElement('option');
      o.value = u.id; o.textContent = u.name;
      if (u.is_you) o.selected = true;
      ownerSel.appendChild(o);
    });

    newActivityLoaded = true;
    st.classList.add('hidden');
  } catch (e) {
    setStatus(st, 'Erro ao carregar tipos de atividade: ' + e.message, 'err');
  }
}

$('btnCreateActivity').addEventListener('click', async () => {
  const st = $('newActivityStatus');
  if (!selectedDeal) {
    setStatus(st, 'Selecione um deal acima para vincular a atividade.', 'err');
    return;
  }
  const subject = $('naSubject').value.trim();
  if (!subject) {
    setStatus(st, 'Informe o assunto da atividade.', 'err');
    return;
  }
  setStatus(st, 'Criando atividade…', 'info');
  $('btnCreateActivity').disabled = true;
  try {
    const dateVal = $('naDate').value;
    const timeVal = $('naTime').value;
    const body = { deal_id: selectedDeal.id, subject };
    if ($('naType').value) body.type = $('naType').value;

    if (dateVal && timeVal) {
      // converte data+hora local -> UTC (Pipedrive guarda due_time em UTC)
      const [y, m, d] = dateVal.split('-').map(Number);
      const [hh, mi] = timeVal.split(':').map(Number);
      const local = new Date(y, m - 1, d, hh, mi);
      body.due_date = local.toISOString().slice(0, 10);
      body.due_time = local.toISOString().slice(11, 16);
    } else if (dateVal) {
      body.due_date = dateVal;
    }

    const durVal = parseInt($('naDuration').value, 10);
    if (durVal) body.duration = `${String(Math.floor(durVal / 60)).padStart(2, '0')}:${String(durVal % 60).padStart(2, '0')}`;
    const note = $('naNote').value.trim();
    if (note) body.note = note;
    const ownerVal = parseInt($('naOwner').value, 10);
    if (ownerVal) body.user_id = ownerVal;
    if ($('naDone').checked) body.done = 1;

    if (await currentCrm() === 'hubspot') {
      let due = new Date().toISOString();
      if (dateVal && timeVal) due = new Date(`${dateVal}T${timeVal}:00`).toISOString();
      else if (dateVal) due = new Date(`${dateVal}T09:00:00`).toISOString();
      await hsCreateTask(selectedDeal.id, {
        subject,
        body: note,
        due,
        done: $('naDone').checked,
        type: $('naType').value || 'TODO'
      });
      setStatus(st, `Atividade "${subject}" criada no HubSpot.`, 'ok');
      $('naSubject').value = ''; $('naNote').value = ''; $('naTime').value = ''; $('naDone').checked = false;
      loadDealPanel(selectedDeal.id);
      return;
    }

    await pdFetch('/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    setStatus(st, `✓ Atividade "${subject}" criada.`, 'ok');
    // limpa os campos de uso único e recarrega o painel do deal
    $('naSubject').value = ''; $('naNote').value = ''; $('naTime').value = ''; $('naDone').checked = false;
    loadDealPanel(selectedDeal.id);
  } catch (e) {
    setStatus(st, 'Erro ao criar atividade: ' + e.message, 'err');
  } finally {
    $('btnCreateActivity').disabled = false;
  }
});

// ===== Criar nova nota (vinculada ao deal selecionado) =====
function openNewNoteForm() {
  $('newNoteForm').classList.remove('hidden');
  const info = $('noteDealInfo');
  if (!selectedDeal) {
    info.innerHTML = '⚠ Selecione um deal acima para registrar a nota.';
    $('btnCreateNote').disabled = true;
    return;
  }
  $('btnCreateNote').disabled = false;
  info.innerHTML = `Vinculada ao deal: <b>${esc(selectedDeal.title)}</b>`;
}

$('btnCreateNote').addEventListener('click', async () => {
  const st = $('newNoteStatus');
  if (!selectedDeal) { setStatus(st, '⚠ Selecione um deal acima para registrar a nota.', 'err'); return; }
  const content = ($('noteContent').value || '').trim();
  if (!content) { setStatus(st, '⚠ Escreva a anotação.', 'err'); return; }
  $('btnCreateNote').disabled = true;
  setStatus(st, 'Salvando nota…', 'info');
  try {
    // Pipedrive aceita HTML simples; preserva quebras de linha
    const html = esc(content).replace(/\n/g, '<br>');
    await createDealNote(selectedDeal.id, html);
    setStatus(st, '✓ Nota registrada no deal!', 'ok');
    $('noteContent').value = '';
    loadDealPanel(selectedDeal.id);
  } catch (e) {
    setStatus(st, 'Erro ao salvar nota: ' + e.message, 'err');
  } finally {
    $('btnCreateNote').disabled = false;
  }
});

// ===== 3. Gravar =====
document.querySelectorAll('input[name="saveType"]').forEach((r) =>
  r.addEventListener('change', () => {
    $('activitySubjectWrap').classList.toggle('hidden', r.value !== 'activity' || !r.checked);
  })
);

// ?ndices das mensagens marcadas (checkbox por mensagem)
function selectedMsgIndexes() {
  const set = new Set();
  document.querySelectorAll('.msg-check:checked').forEach((c) => set.add(parseInt(c.value, 10)));
  return set;
}

function buildContent(selectedMediaIds) {
  const nl = '<br>';
  const idxSet = selectedMsgIndexes();
  const chosen = captured.messages.filter((m, i) => idxSet.has(i));
  const header = `Conversa WhatsApp${captured.chatName ? ' — ' + captured.chatName : ''} (${chosen.length} mensagens)${nl}${nl}`;
  const mediaById = {};
  (captured.media || []).forEach((m) => { mediaById[m.id] = m; });
  const body = chosen
    .map((m) => {
      let line = `${m.meta || (m.direction === 'out' ? 'Você: ' : 'Contato: ')}${m.text}`;
      (m.mediaIds || []).forEach((id) => {
        if (selectedMediaIds.has(id) && mediaById[id] && mediaById[id].filename) {
          line += ` [anexo: ${mediaById[id].filename}]`;
        }
      });
      return line;
    })
    .join(nl);
  return header + body;
}

async function uploadFile(dealId, base64, mime, filename) {
  if (await currentCrm() === 'hubspot') {
    const uploaded = await hsUploadFile(base64, mime, filename);
    await hsCreateNote(dealId, `Arquivo anexado: ${esc(filename)}`, [uploaded.id]);
    return;
  }

  const url = await pdUrl('/files');
  const fd = new FormData();
  fd.append('deal_id', dealId);
  fd.append('file', b64ToBlob(base64, mime), filename);
  const resp = await fetch(url, { method: 'POST', body: fd });
  const json = await resp.json();
  if (!resp.ok || json.success === false) throw new Error(json.error || `Erro HTTP ${resp.status}`);
}
async function uploadMedia(dealId, media) {
  return uploadFile(dealId, media.base64, media.mime, media.filename);
}

// Traduz mensagens de erro do Gemini para pt-BR (mantém o original se desconhecida)
function traduzErroGemini(raw, status) {
  const m = String(raw || '').toLowerCase();
  if (m.includes('high demand') || m.includes('overloaded') || status === 503)
    return 'O modelo do Gemini está sobrecarregado no momento. Isso costuma ser temporário — tente novamente em alguns instantes.';
  if (m.includes('quota') || m.includes('rate limit') || m.includes('resource has been exhausted') || status === 429)
    return 'Limite de uso da API do Gemini atingido. Aguarde um pouco e tente novamente, ou verifique a cota da sua chave.';
  if (m.includes('api key not valid') || m.includes('api_key_invalid') || m.includes('invalid api key') || m.includes('permission denied') || status === 403)
    return 'A API Key do Gemini é inválida ou não tem permissão. Confira a chave nas configurações (⚙).';
  if (m.includes('not found') || m.includes('is not found for api version') || status === 404)
    return 'Modelo do Gemini não encontrado/indisponível para esta chave. Tente novamente mais tarde.';
  if (m.includes('safety') || m.includes('blocked'))
    return 'O conteúdo foi bloqueado pelos filtros de segurança do Gemini.';
  if (m.includes('deadline') || m.includes('timeout') || m.includes('timed out') || status === 504)
    return 'O Gemini demorou demais para responder (tempo esgotado). Tente novamente.';
  if (m.includes('internal') || status === 500)
    return 'Erro interno do Gemini. Tente novamente em instantes.';
  if (status === 400 && (m.includes('image') || m.includes('payload') || m.includes('size')))
    return 'A requisição ao Gemini foi rejeitada (possível imagem muito grande). Tente com menos recortes ou imagens menores.';
  // desconhecida: mantém o original, mas em contexto pt-BR
  return raw ? ('Erro do Gemini: ' + raw) : ('Erro do Gemini (HTTP ' + status + ').');
}

// Tradutor genérico (para qualquer provedor) — recebe o nome do provedor
function traduzErroIA(prov, raw, status) {
  const m = String(raw || '').toLowerCase();
  if (m.includes('high demand') || m.includes('overloaded') || m.includes('capacity') || status === 503)
    return `O ${prov} está sobrecarregado no momento. Isso costuma ser temporário — tente novamente em alguns instantes.`;
  if (m.includes('quota') || m.includes('rate limit') || m.includes('exhausted') || m.includes('insufficient') || m.includes('billing') || status === 429)
    return `Limite de uso (ou créditos) da API do ${prov} atingido. Verifique a cota/saldo da sua chave e tente novamente.`;
  if (m.includes('api key') || m.includes('api_key') || m.includes('invalid key') || m.includes('incorrect api key') || m.includes('authentication') || m.includes('unauthorized') || m.includes('permission denied') || status === 401 || status === 403)
    return `A API Key do ${prov} é inválida ou sem permissão. Confira a chave nas configurações (⚙).`;
  if (m.includes('not found') || m.includes('does not exist') || m.includes('model') && m.includes('not') || status === 404)
    return `Modelo do ${prov} não encontrado/indisponível para esta chave. Tente novamente mais tarde.`;
  if (m.includes('safety') || m.includes('blocked') || m.includes('content policy'))
    return `O conteúdo foi bloqueado pelos filtros de segurança do ${prov}.`;
  if (m.includes('deadline') || m.includes('timeout') || m.includes('timed out') || status === 504)
    return `O ${prov} demorou demais para responder (tempo esgotado). Tente novamente.`;
  if (status === 500 || m.includes('internal'))
    return `Erro interno do ${prov}. Tente novamente em instantes.`;
  if (status === 400 && (m.includes('image') || m.includes('payload') || m.includes('too large') || m.includes('size')))
    return `A requisição ao ${prov} foi rejeitada (possível imagem muito grande). Tente com menos recortes ou imagens menores.`;
  return raw ? (`Erro do ${prov}: ` + raw) : (`Erro do ${prov} (HTTP ${status}).`);
}

// ===== Roteador de IA: monta a requisição conforme o provedor escolhido =====
const AI_DEFAULT_MODELS = { gemini: 'gemini-2.5-flash', openai: 'gpt-4.1-mini', claude: 'claude-sonnet-4-6', deepseek: 'deepseek-chat' };
const AI_LABELS = { gemini: 'Gemini', openai: 'OpenAI', claude: 'Claude', deepseek: 'DeepSeek' };

async function aiGenerate(promptText, base64Images) {
  const cfg = await getConfig();
  const prov = cfg.aiProvider || 'gemini';
  const keys = { gemini: cfg.geminiKey, openai: cfg.openaiKey, claude: cfg.claudeKey, deepseek: cfg.deepseekKey };
  const key = (keys[prov] || '').trim();
  if (!key) throw new Error(`Configure a API Key do ${AI_LABELS[prov]} nas configurações (⚙) ou troque o provedor de IA.`);
  const customModels = { gemini: cfg.geminiModel, openai: cfg.openaiModel, claude: cfg.claudeModel, deepseek: cfg.deepseekModel };
  const model = ((customModels[prov] || '').trim()) || AI_DEFAULT_MODELS[prov];
  const imgs = base64Images || [];
  if (prov === 'gemini') return callGemini(key, model, promptText, imgs);
  if (prov === 'claude') return callClaude(key, model, promptText, imgs);
  // OpenAI e DeepSeek usam o mesmo formato (Chat Completions)
  const url = prov === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.deepseek.com/chat/completions';
  return callOpenAILike(url, key, model, promptText, imgs, AI_LABELS[prov]);
}

async function callGemini(key, model, prompt, imgs) {
  const parts = [{ text: prompt }];
  imgs.forEach((b) => parts.push({ inline_data: { mime_type: 'image/png', data: b } }));
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ parts }] }) });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(traduzErroIA('Gemini', json.error && json.error.message, resp.status));
  const t = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text;
  if (!t) throw new Error('O Gemini não retornou um resultado.');
  return t.trim();
}

async function callOpenAILike(url, key, model, prompt, imgs, label) {
  const content = [{ type: 'text', text: prompt }];
  imgs.forEach((b) => content.push({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + b } }));
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 2000 })
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(traduzErroIA(label, json.error && (json.error.message || json.error), resp.status));
  const t = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!t) throw new Error(`O ${label} não retornou um resultado.`);
  return String(t).trim();
}

async function callClaude(key, model, prompt, imgs) {
  const content = [{ type: 'text', text: prompt }];
  imgs.forEach((b) => content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b } }));
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content }] })
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(traduzErroIA('Claude', json.error && (json.error.message || json.error), resp.status));
  const t = json.content && json.content[0] && json.content[0].text;
  if (!t) throw new Error('O Claude não retornou um resultado.');
  return String(t).trim();
}

// Conversa em texto puro (sem HTML) para enviar ao Gemini — só as selecionadas
function conversationPlainText() {
  if (!captured) return '';
  const idxSet = selectedMsgIndexes();
  return captured.messages
    .filter((m, i) => idxSet.has(i))
    .map((m) => `${m.meta || (m.direction === 'out' ? 'Você: ' : 'Contato: ')}${m.text}`)
    .join('\n');
}

// Func. 1: resume a conversa de texto usando o provedor de IA configurado
async function summarizeWithGemini(plainText, chatName) {
  const cfg = await getConfig();
  const base = (cfg.aiPrompt && cfg.aiPrompt.trim()) || DEFAULT_AI_PROMPT;
  const convoBlock = (chatName ? `Conversa com: ${chatName}\n\n` : '') + plainText;
  const placeholder = '[Cole as mensagens do WhatsApp aqui]';
  const prompt = base.includes(placeholder) ? base.replace(placeholder, convoBlock) : (base + '\n\n--- CONVERSA ---\n' + convoBlock);
  return aiGenerate(prompt, []);
}

// ===== Recortes de tela =====
let selectedClips = new Set();

function getLocal(key) { return new Promise((r) => chrome.storage.local.get(key, r)); }
function setLocal(obj) { return new Promise((r) => chrome.storage.local.set(obj, r)); }

async function loadClips() {
  const tray = $('clipTray');
  if (!tray) return;
  const clips = (await getLocal('clips')).clips || [];
  tray.innerHTML = '';
  clips.forEach((c) => { if (!selectedClips.has(c.id)) selectedClips.add(c.id); });
  [...selectedClips].forEach((id) => { if (!clips.find((c) => c.id === id)) selectedClips.delete(id); });
  if (!clips.length) { $('clipActions').classList.add('hidden'); const pp = $('clipPromptPick'); if (pp) pp.classList.add('hidden'); return; }
  clips.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'clip-thumb' + (selectedClips.has(c.id) ? ' sel' : '');
    div.innerHTML = `<img src="data:image/png;base64,${c.base64}" alt="recorte"><span class="clip-check">✓</span><button class="clip-del" title="Remover">✕</button>`;
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('clip-del')) return;
      if (selectedClips.has(c.id)) selectedClips.delete(c.id); else selectedClips.add(c.id);
      div.classList.toggle('sel');
    });
    div.querySelector('.clip-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      const arr = ((await getLocal('clips')).clips || []).filter((x) => x.id !== c.id);
      await setLocal({ clips: arr });
      selectedClips.delete(c.id);
      loadClips();
    });
    tray.appendChild(div);
  });
  $('clipActions').classList.remove('hidden');
  const pp = $('clipPromptPick'); if (pp) pp.classList.remove('hidden');
}

async function selectedClipImages() {
  const clips = (await getLocal('clips')).clips || [];
  return clips.filter((c) => selectedClips.has(c.id)).map((c) => c.base64);
}

// Resumo/transcrição multimodal conforme o prompt escolhido (1 = análise, 2 = transcrição)
async function summarizeImagesWithGemini(base64Images, whichPrompt) {
  const cfg = await getConfig();
  const usar2 = String(whichPrompt) === '2';
  const base = usar2
    ? ((cfg.aiPrompt2 && cfg.aiPrompt2.trim()) || DEFAULT_AI_PROMPT2)
    : ((cfg.aiPrompt && cfg.aiPrompt.trim()) || DEFAULT_AI_PROMPT);
  const tail = usar2
    ? '\n\nTranscreva as imagens a seguir.'
    : '\n\nAnalise as imagens a seguir (recortes de tela de uma conversa/documento) e produza o resumo solicitado.';
  const promptTxt = base.replace('[Cole as mensagens do WhatsApp aqui]', '(veja as imagens em anexo)') + tail;
  return aiGenerate(promptTxt, base64Images || []);
}

if ($('btnNewClip')) {
  $('btnNewClip').addEventListener('click', () => {
    setStatus($('clipStatus'), 'Abrindo o seletor… arraste o retângulo na página. Reabra a extensão para ver o recorte.', 'info');
    chrome.runtime.sendMessage({ type: 'clip-start' }, (r) => {
      if (chrome.runtime.lastError) return; // popup fechou ao clicar na página — normal
      if (r && r.ok) { loadClips(); setStatus($('clipStatus'), `✓ Recorte adicionado (${r.count}).`, 'ok'); }
      else if (r && r.canceled) setStatus($('clipStatus'), 'Recorte cancelado.', 'info');
      else if (r && r.error) setStatus($('clipStatus'), '⚠ ' + r.error, 'err');
    });
  });

  $('btnClipSummarize').addEventListener('click', async () => {
    const st = $('clipStatus');
    const imgs = await selectedClipImages();
    if (!imgs.length) { setStatus(st, '⚠ Selecione ao menos um recorte.', 'err'); return; }
    const cfg = await getConfig();
    const lbl = AI_LABELS[cfg.aiProvider || 'gemini'] || 'IA';
    const which = (document.querySelector('input[name="clipPrompt"]:checked') || {}).value || '1';
    $('btnClipSummarize').disabled = true;
    setStatus(st, `${which === '2' ? 'Transcrevendo' : 'Resumindo'} as imagens com o ${lbl}…`, 'info');
    try {
      const text = await summarizeImagesWithGemini(imgs, which);
      const ta = $('clipSummary'); ta.value = text; ta.classList.remove('hidden');
      setStatus(st, '✓ Pronto. Revise o texto e clique em enviar.', 'ok');
    } catch (e) { setStatus(st, 'Erro: ' + e.message, 'err'); }
    finally { $('btnClipSummarize').disabled = false; }
  });

  $('btnClipSend').addEventListener('click', async () => {
    const st = $('clipStatus');
    if (!selectedDeal) { setStatus(st, '⚠ Selecione um deal em "2 · Deal de destino" primeiro.', 'err'); return; }
    const clips = (await getLocal('clips')).clips || [];
    const chosen = clips.filter((c) => selectedClips.has(c.id));
    if (!chosen.length) { setStatus(st, '⚠ Selecione ao menos um recorte.', 'err'); return; }
    $('btnClipSend').disabled = true;
    setStatus(st, `Enviando ${chosen.length} recorte(s) ao Pipedrive…`, 'info');
    try {
      let i = 1;
      for (const c of chosen) { await uploadFile(selectedDeal.id, c.base64, 'image/png', `recorte-${Date.now()}-${i}.png`); i++; }
      const summary = ($('clipSummary').value || '').trim();
      if (summary) {
        const html = esc(summary).replace(/\n/g, '<br>');
        await createDealNote(selectedDeal.id, html);
      }
      const remaining = clips.filter((c) => !selectedClips.has(c.id));
      await setLocal({ clips: remaining });
      selectedClips.clear();
      $('clipSummary').value = ''; $('clipSummary').classList.add('hidden');
      loadClips();
      if (typeof loadDealPanel === 'function') loadDealPanel(selectedDeal.id);
      setStatus(st, `OK - ${chosen.length} recorte(s) anexado(s) ao deal${summary ? ' + nota com o resumo' : ''}.`, 'ok');
    } catch (e) { setStatus(st, 'Erro ao enviar: ' + e.message, 'err'); }
    finally { $('btnClipSend').disabled = false; }
  });

  // init: mostra resultado do último recorte (caso o popup tenha fechado) + carrega o tray
  (async () => {
    try {
      const d = await getLocal('clipLast');
      if (d.clipLast) {
        const r = d.clipLast;
        if (r.ok) setStatus($('clipStatus'), `✓ Recorte adicionado (${r.count}).`, 'ok');
        else if (r.error) setStatus($('clipStatus'), '⚠ ' + r.error, 'err');
        chrome.storage.local.remove('clipLast');
      }
    } catch (_) {}
    loadClips();
  })();
}

// ===== Anexar arquivos ao deal (com transcrição de áudio por IA) =====
let attachedFiles = []; // { name, mime, base64, size, isAudio }

function isAudioFile(f) {
  return /^audio\//i.test(f.mime || '') || /\.(ogg|opus|mp3|m4a|aac|wav|amr|oga)$/i.test(f.name || '');
}

// Transcreve um áudio usando o provedor de IA configurado (Gemini via inline_data; OpenAI via Whisper)
async function transcribeAudioWithAI(base64, mime, filename) {
  const cfg = await getConfig();
  const prov = cfg.aiProvider || 'gemini';
  if (prov === 'gemini') {
    const key = (cfg.geminiKey || '').trim();
    if (!key) throw new Error('Configure a API Key do Gemini (⚙).');
    const model = (cfg.geminiModel || '').trim() || AI_DEFAULT_MODELS.gemini;
    const parts = [
      { text: 'Transcreva este áudio na íntegra, em português do Brasil. Responda apenas com a transcrição, sem comentários nem rótulos.' },
      { inline_data: { mime_type: mime || 'audio/ogg', data: base64 } }
    ];
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ parts }] }) });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(traduzErroIA('Gemini', json.error && json.error.message, resp.status));
    const t = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text;
    if (!t) throw new Error('O Gemini não retornou transcrição.');
    return t.trim();
  }
  if (prov === 'openai') {
    const key = (cfg.openaiKey || '').trim();
    if (!key) throw new Error('Configure a API Key da OpenAI (⚙).');
    const fd = new FormData();
    fd.append('file', b64ToBlob(base64, mime || 'audio/ogg'), filename || 'audio.ogg');
    fd.append('model', 'whisper-1');
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key }, body: fd });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(traduzErroIA('OpenAI', json.error && (json.error.message || json.error), resp.status));
    if (!json.text) throw new Error('A OpenAI não retornou transcrição.');
    return String(json.text).trim();
  }
  throw new Error(`O provedor ${AI_LABELS[prov]} não transcreve áudio. Troque para Gemini ou OpenAI nas configurações (⚙).`);
}

if ($('attachFiles')) {
  const refreshAttachUI = () => {
    const list = $('attachList');
    list.innerHTML = '';
    attachedFiles.forEach((f, i) => {
      const li = document.createElement('li');
      const kb = Math.round(f.size / 1024);
      li.innerHTML = `<label><input type="checkbox" class="attach-check" data-i="${i}" checked /> ${f.isAudio ? '🎤' : '📎'} ${esc(f.name)} · ${kb} KB</label> <button class="attach-del" data-i="${i}" title="Remover">✕</button>`;
      list.appendChild(li);
    });
    list.querySelectorAll('.attach-del').forEach((b) => b.addEventListener('click', () => {
      attachedFiles.splice(Number(b.dataset.i), 1); refreshAttachUI();
    }));
    const hasAny = attachedFiles.length > 0;
    const hasAudio = attachedFiles.some((f) => f.isAudio);
    $('attachActions').classList.toggle('hidden', !hasAny);
    $('btnAttachTranscribe').classList.toggle('hidden', !hasAudio);
  };

  $('attachFiles').addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    const st = $('attachStatus');
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { setStatus(st, `⚠ ${f.name} acima de 25 MB, ignorado.`, 'err'); continue; }
      try {
        const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('read')); r.readAsDataURL(f); });
        const entry = { name: f.name, mime: f.type || 'application/octet-stream', base64, size: f.size };
        entry.isAudio = isAudioFile(entry);
        attachedFiles.push(entry);
      } catch (_) { setStatus(st, `⚠ Falha ao ler ${f.name}.`, 'err'); }
    }
    e.target.value = '';
    refreshAttachUI();
  });

  $('btnAttachTranscribe').addEventListener('click', async () => {
    const st = $('attachStatus');
    const audios = attachedFiles.filter((f) => f.isAudio);
    if (!audios.length) { setStatus(st, '⚠ Nenhum áudio selecionado.', 'err'); return; }
    const cfg = await getConfig();
    const lbl = AI_LABELS[cfg.aiProvider || 'gemini'] || 'IA';
    $('btnAttachTranscribe').disabled = true;
    setStatus(st, `Transcrevendo ${audios.length} áudio(s) com o ${lbl}…`, 'info');
    try {
      const partes = [];
      for (const a of audios) {
        const t = await transcribeAudioWithAI(a.base64, a.mime, a.name);
        partes.push(audios.length > 1 ? `[${a.name}]\n${t}` : t);
      }
      const ta = $('attachTranscript');
      ta.value = partes.join('\n\n'); ta.classList.remove('hidden');
      setStatus(st, '✓ Transcrição pronta. Revise e clique em "Anexar ao deal" (vira nota + anexa o áudio).', 'ok');
    } catch (e) { setStatus(st, 'Erro: ' + e.message, 'err'); }
    finally { $('btnAttachTranscribe').disabled = false; }
  });

  $('btnAttachSend').addEventListener('click', async () => {
    const st = $('attachStatus');
    if (!selectedDeal) { setStatus(st, '⚠ Selecione um deal em "2 · Deal de destino" primeiro.', 'err'); return; }
    const checked = [...document.querySelectorAll('.attach-check')].filter((c) => c.checked).map((c) => attachedFiles[Number(c.dataset.i)]).filter(Boolean);
    if (!checked.length) { setStatus(st, '⚠ Selecione ao menos um arquivo.', 'err'); return; }
    $('btnAttachSend').disabled = true;
    setStatus(st, `Anexando ${checked.length} arquivo(s) ao deal…`, 'info');
    try {
      let sent = 0;
      for (const f of checked) { await uploadFile(selectedDeal.id, f.base64, f.mime, f.name); sent++; }
      const transcript = ($('attachTranscript').value || '').trim();
      if (transcript) {
        const html = esc(transcript).replace(/\n/g, '<br>');
        await createDealNote(selectedDeal.id, 'Transcricao de audio:<br><br>' + html);
      }
      attachedFiles = [];
      $('attachTranscript').value = ''; $('attachTranscript').classList.add('hidden');
      refreshAttachUI();
      if (typeof loadDealPanel === 'function') loadDealPanel(selectedDeal.id);
      setStatus(st, `✓ ${sent} arquivo(s) anexado(s)${transcript ? ' + nota com a transcrição' : ''}.`, 'ok');
    } catch (e) { setStatus(st, 'Erro ao anexar: ' + e.message, 'err'); }
    finally { $('btnAttachSend').disabled = false; }
  });
}
// ===== ZapSign - assinatura eletronica =====
const ZAPSIGN_API = 'https://api.zapsign.com.br/api/v1';
let sigSigners = [];
let sigLastDoc = null;

function zapsignConfiguredMessage() {
  return 'Configure o API token da ZapSign nas configuracoes antes de usar assinatura eletronica.';
}

async function zapsignFetch(path, options = {}) {
  const cfg = await getConfig();
  const token = (cfg.zapsignToken || '').trim();
  if (!token) throw new Error(zapsignConfiguredMessage());
  const headers = { ...(options.headers || {}), Authorization: 'Bearer ' + token };
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const resp = await fetch(ZAPSIGN_API + path, { ...options, headers });
  const text = await resp.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text }; }
  if (!resp.ok) {
    const msg = json.detail || json.message || json.error || json.raw || `Erro HTTP ${resp.status}`;
    if (resp.status === 401 || resp.status === 403) throw new Error('ZapSign recusou o token. Confira a chave nas configuracoes.');
    throw new Error(String(msg));
  }
  return json;
}

function sigSetStatus(msg, type) {
  const st = $('sigStatus');
  if (st) setStatus(st, msg, type);
}

function sigSwitchTab(tab) {
  const send = tab === 'send';
  $('sigSendPanel').classList.toggle('hidden', !send);
  $('sigTrackPanel').classList.toggle('hidden', send);
  $('btnSigTabSend').classList.toggle('active', send);
  $('btnSigTabTrack').classList.toggle('active', !send);
}

function sigRenderSigners() {
  const list = $('sigSignerList');
  if (!list) return;
  if (!sigSigners.length) {
    list.innerHTML = '<small class="sig-small">Nenhum signatario adicionado.</small>';
    return;
  }
  list.innerHTML = sigSigners.map((s, i) => `
    <div class="sig-signer">
      <div><strong>${esc(s.name)}</strong><small>${esc(s.email || s.phone || '')}</small></div>
      <button type="button" data-i="${i}" title="Remover">x</button>
    </div>
  `).join('');
  list.querySelectorAll('button[data-i]').forEach((btn) => btn.addEventListener('click', () => {
    sigSigners.splice(Number(btn.dataset.i), 1);
    sigRenderSigners();
  }));
}

function sigNormalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return {};
  if (digits.startsWith('55') && digits.length > 11) return { phone_country: '55', phone_number: digits.slice(2) };
  return { phone_country: '55', phone_number: digits };
}

function sigBuildSigner(s, index) {
  const phone = sigNormalizePhone(s.phone);
  const out = {
    name: s.name,
    email: s.email || '',
    send_automatic_email: !!($('sigAutoEmail') && $('sigAutoEmail').checked && s.email),
    send_automatic_whatsapp: !!($('sigAutoWhatsapp') && $('sigAutoWhatsapp').checked && phone.phone_number)
  };
  if (phone.phone_number) Object.assign(out, phone);
  if ($('sigOrder') && $('sigOrder').checked) out.order_group = index + 1;
  return out;
}

function sigAddSignerFromForm() {
  const name = ($('sigSignerName').value || '').trim();
  const email = ($('sigSignerEmail').value || '').trim();
  const phone = ($('sigSignerPhone').value || '').trim();
  if (!name) { sigSetStatus('Informe o nome do signatario.', 'err'); return false; }
  if (!email && !phone) { sigSetStatus('Informe e-mail ou WhatsApp do signatario.', 'err'); return false; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { sigSetStatus('Informe um e-mail valido.', 'err'); return false; }
  sigSigners.push({ name, email, phone });
  $('sigSignerName').value = '';
  $('sigSignerEmail').value = '';
  $('sigSignerPhone').value = '';
  sigRenderSigners();
  return true;
}

function sigReadFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Nao foi possivel ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

async function sigLoadTemplates() {
  const sel = $('sigTemplate');
  sel.innerHTML = '<option value="">Carregando...</option>';
  try {
    const r = await zapsignFetch('/templates/?page=1');
    const items = (r.results || []).filter((t) => t.active !== false);
    sel.innerHTML = items.length
      ? items.map((t) => `<option value="${esc(t.token || t.id)}">${esc(t.name || t.token || t.id)}</option>`).join('')
      : '<option value="">Nenhum template ativo</option>';
    sigSetStatus(`${items.length} template(s) carregado(s).`, 'ok');
  } catch (e) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
    sigSetStatus('Erro ao carregar templates: ' + e.message, 'err');
  }
}

async function sigSaveLocalDoc(doc) {
  const data = await getLocal('zapsignDocs');
  const arr = Array.isArray(data.zapsignDocs) ? data.zapsignDocs : [];
  const token = doc.token || doc.doc_token;
  const item = { token, name: doc.name || doc.original_file || $('sigDocName').value || 'Documento', status: doc.status || 'pending', createdAt: new Date().toISOString() };
  const next = [item, ...arr.filter((x) => x.token !== token)].slice(0, 25);
  await setLocal({ zapsignDocs: next });
}

async function sigCreateFromUpload() {
  const file = ($('sigFile').files || [])[0];
  if (!file) throw new Error('Selecione um PDF ou DOCX.');
  const lower = (file.name || '').toLowerCase();
  if (!/(\.pdf|\.docx)$/.test(lower)) throw new Error('Use um arquivo PDF ou DOCX.');
  const base64 = await sigReadFileAsBase64(file);
  const name = ($('sigDocName').value || file.name).trim();
  const body = {
    name,
    lang: 'pt-br',
    signature_order_active: !!($('sigOrder') && $('sigOrder').checked),
    signers: sigSigners.map(sigBuildSigner),
    external_id: selectedDeal ? `conectcrm-deal-${selectedDeal.id}` : undefined
  };
  if (lower.endsWith('.docx')) body.base64_docx = base64;
  else body.base64_pdf = base64;
  return zapsignFetch('/docs/', { method: 'POST', body: JSON.stringify(body) });
}

async function sigCreateFromTemplate() {
  const templateId = $('sigTemplate').value;
  if (!templateId) throw new Error('Selecione um template ZapSign.');
  const first = sigSigners[0];
  if (!first) throw new Error('Adicione ao menos um signatario.');
  const phone = sigNormalizePhone(first.phone);
  const body = {
    template_id: templateId,
    signer_name: first.name,
    signer_email: first.email || undefined,
    signer_phone_country: phone.phone_country,
    signer_phone_number: phone.phone_number,
    send_automatic_email: !!($('sigAutoEmail') && $('sigAutoEmail').checked && first.email),
    send_automatic_whatsapp: !!($('sigAutoWhatsapp') && $('sigAutoWhatsapp').checked && phone.phone_number),
    lang: 'pt-br'
  };
  if (($('sigDocName').value || '').trim()) body.name = $('sigDocName').value.trim();
  return zapsignFetch('/models/create-doc/', { method: 'POST', body: JSON.stringify(body) });
}

async function sigSendDocument() {
  if (!sigSigners.length && (($('sigSignerName').value || '').trim() || ($('sigSignerEmail').value || '').trim() || ($('sigSignerPhone').value || '').trim())) {
    if (!sigAddSignerFromForm()) return;
  }
  if (!sigSigners.length) { sigSetStatus('Adicione ao menos um signatario.', 'err'); return; }
  $('btnSigSend').disabled = true;
  sigSetStatus('Enviando documento para a ZapSign...', 'info');
  try {
    const created = $('sigSource').value === 'template' ? await sigCreateFromTemplate() : await sigCreateFromUpload();
    sigLastDoc = created;
    await sigSaveLocalDoc(created);
    const token = created.token || created.doc_token;
    let msg = `Documento enviado para assinatura. Token: ${token || 'indisponivel'}.`;
    if ($('sigSource').value === 'template' && sigSigners.length > 1) msg += ' Observacao: neste primeiro fluxo, template envia o primeiro signatario informado.';
    sigSetStatus(msg, 'ok');
    if (selectedDeal && token) {
      await createDealNote(selectedDeal.id, `Documento enviado para assinatura pela ZapSign:<br>${esc(created.name || $('sigDocName').value || 'Documento')}<br>Token: ${esc(token)}`);
    }
  } catch (e) {
    sigSetStatus('Erro: ' + e.message, 'err');
  } finally {
    $('btnSigSend').disabled = false;
  }
}

function sigStatusLabel(status) {
  const map = { pending: 'Pendente', signed: 'Assinado', refused: 'Recusado', canceled: 'Cancelado', new: 'Novo', 'link-opened': 'Link aberto' };
  return map[status] || status || 'Indefinido';
}

function sigRenderDocDetails(doc) {
  sigLastDoc = doc;
  const box = $('sigDocDetails');
  const token = doc.token || doc.doc_token;
  const signers = doc.signers || [];
  const signedUrl = doc.signed_file || doc.signed_file_url || '';
  const badgeClass = doc.status === 'signed' ? 'signed' : 'pending';
  box.innerHTML = `
    <div class="sig-detail-head">
      <div><strong>${esc(doc.name || 'Documento')}</strong><small>Token: ${esc(token || '')}</small></div>
      <span class="sig-badge ${badgeClass}">${esc(sigStatusLabel(doc.status))}</span>
    </div>
    <span class="sub-label strong">Signatarios</span>
    <div class="sig-signer-list">
      ${signers.length ? signers.map((s) => `<div class="sig-signer"><div><strong>${esc(s.name || s.email || s.phone_number || 'Signatario')}</strong><small>${esc(s.email || s.phone_number || '')}</small></div><span class="sig-badge ${s.status === 'signed' ? 'signed' : 'pending'}">${esc(sigStatusLabel(s.status))}</span></div>`).join('') : '<small class="sig-small">Sem signatarios retornados.</small>'}
    </div>
    <div class="sig-actions">
      <button type="button" id="btnSigResend">Reenviar links</button>
      <button type="button" id="btnSigSaveNote">Salvar nota no CRM</button>
      <button type="button" id="btnSigDownload" ${signedUrl ? '' : 'disabled'}>Baixar assinado</button>
      <button type="button" id="btnSigShareWa" ${signedUrl ? '' : 'disabled'}>Enviar link no WhatsApp</button>
    </div>
  `;
  box.classList.remove('hidden');
  $('btnSigResend').addEventListener('click', () => sigResendLinks(token));
  $('btnSigSaveNote').addEventListener('click', () => sigSaveNoteToCrm(doc));
  $('btnSigDownload').addEventListener('click', () => sigDownloadSigned(doc));
  $('btnSigShareWa').addEventListener('click', () => sigShareSignedWhatsApp(doc));
}

async function sigGetDoc(token) {
  const doc = await zapsignFetch(`/docs/${encodeURIComponent(token)}/`);
  await sigSaveLocalDoc(doc);
  sigRenderDocDetails(doc);
  sigSetStatus('Status atualizado.', 'ok');
}

async function sigSearchDocs() {
  const q = ($('sigSearch').value || '').trim();
  if (!q) { await sigListRecent(); return; }
  if (/^[a-zA-Z0-9_-]{10,}$/.test(q) && !q.includes(' ')) {
    try { await sigGetDoc(q); return; } catch (_) {}
  }
  try {
    const r = await zapsignFetch('/docs/?page=1');
    const docs = (r.results || []).filter((d) => String(d.name || '').toLowerCase().includes(q.toLowerCase()));
    sigRenderDocList(docs);
    sigSetStatus(docs.length ? `${docs.length} documento(s) encontrado(s).` : 'Nenhum documento encontrado.', docs.length ? 'ok' : 'info');
  } catch (e) {
    sigSetStatus('Erro ao buscar: ' + e.message, 'err');
  }
}

function sigRenderDocList(docs) {
  const box = $('sigDocsList');
  box.innerHTML = (docs || []).slice(0, 12).map((d) => {
    const token = d.token || d.doc_token;
    return `<button type="button" class="sig-doc-item" data-token="${esc(token || '')}"><strong>${esc(d.name || 'Documento')}</strong><small>${esc(sigStatusLabel(d.status))} - ${esc(token || '')}</small></button>`;
  }).join('') || '<small class="sig-small">Nenhum documento para exibir.</small>';
  box.querySelectorAll('[data-token]').forEach((btn) => btn.addEventListener('click', () => sigGetDoc(btn.dataset.token)));
}

async function sigListRecent() {
  try {
    const r = await zapsignFetch('/docs/?page=1');
    sigRenderDocList(r.results || []);
    sigSetStatus('Documentos recentes carregados.', 'ok');
  } catch (e) {
    const local = await getLocal('zapsignDocs');
    if (Array.isArray(local.zapsignDocs) && local.zapsignDocs.length) {
      sigRenderDocList(local.zapsignDocs);
      sigSetStatus('Nao consegui consultar a ZapSign agora. Mostrei o historico local.', 'info');
    } else {
      sigSetStatus('Erro ao listar documentos: ' + e.message, 'err');
    }
  }
}

async function sigResendLinks(token) {
  if (!token) { sigSetStatus('Documento sem token para reenviar.', 'err'); return; }
  try {
    await zapsignFetch(`/docs/${encodeURIComponent(token)}/resend-notifications-bulk/`, { method: 'POST' });
    sigSetStatus('Links de assinatura reenviados pela ZapSign.', 'ok');
  } catch (e) {
    sigSetStatus('Erro ao reenviar: ' + e.message, 'err');
  }
}

async function sigSaveNoteToCrm(doc) {
  if (!selectedDeal) { sigSetStatus('Selecione um deal antes de salvar nota no CRM.', 'err'); return; }
  const token = doc.token || doc.doc_token || '';
  const signers = (doc.signers || []).map((s) => `${esc(s.name || s.email || 'Signatario')}: ${esc(sigStatusLabel(s.status))}`).join('<br>');
  const signed = doc.signed_file || doc.signed_file_url || '';
  const html = `ZapSign - documento ${esc(doc.name || '')}<br>Status: ${esc(sigStatusLabel(doc.status))}<br>Token: ${esc(token)}${signers ? '<br><br>Signatarios:<br>' + signers : ''}${signed ? '<br><br>Arquivo assinado: ' + esc(signed) : ''}`;
  try {
    await createDealNote(selectedDeal.id, html);
    sigSetStatus('Nota salva no CRM.', 'ok');
  } catch (e) {
    sigSetStatus('Erro ao salvar nota no CRM: ' + e.message, 'err');
  }
}

function sigDownloadSigned(doc) {
  const url = doc.signed_file || doc.signed_file_url || '';
  if (!url) { sigSetStatus('Documento ainda nao possui arquivo assinado.', 'err'); return; }
  const name = (doc.name || 'documento-assinado').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  chrome.downloads.download({ url, filename: `${name}.pdf`, saveAs: true });
}

function sigShareSignedWhatsApp(doc) {
  const url = doc.signed_file || doc.signed_file_url || '';
  if (!url) { sigSetStatus('Documento ainda nao possui arquivo assinado.', 'err'); return; }
  const text = `Documento assinado: ${doc.name || ''}\n${url}`;
  chrome.tabs.create({ url: 'https://web.whatsapp.com/send?text=' + encodeURIComponent(text) });
}

function sigInitUi() {
  if (!$('btnSignature')) return;
  sigRenderSigners();
  $('btnSignature').addEventListener('click', async () => {
    const ls = await getLicenseState();
    if (!ls.licValid) { const r = await checkLicense(false); renderLicenseScreen(r); showView('license'); return; }
    showView('signature');
  });
  $('btnSigBack').addEventListener('click', () => showView('main'));
  $('btnSigTabSend').addEventListener('click', () => sigSwitchTab('send'));
  $('btnSigTabTrack').addEventListener('click', () => sigSwitchTab('track'));
  $('btnSigAddSigner').addEventListener('click', sigAddSignerFromForm);
  $('btnSigSend').addEventListener('click', sigSendDocument);
  $('btnSigSearch').addEventListener('click', sigSearchDocs);
  $('btnSigRecent').addEventListener('click', sigListRecent);
  $('btnSigLoadTemplates').addEventListener('click', sigLoadTemplates);
  $('sigSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') sigSearchDocs(); });
  $('sigSource').addEventListener('change', async (e) => {
    const isTemplate = e.target.value === 'template';
    $('sigFileRow').classList.toggle('hidden', isTemplate);
    $('sigTemplateRow').classList.toggle('hidden', !isTemplate);
    if (isTemplate && !$('sigTemplate').options.length) await sigLoadTemplates();
  });
}
sigInitUi();
initActivityBoard();
initCnpjLookup();

const MICROSOFT_CLIENT_ID = 'a1831519-7677-413a-be79-726b20328d12';
const MICROSOFT_SCOPES = 'openid profile email offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite';
const MICROSOFT_REDIRECT_PATH = 'microsoft';
let googleToken = null;
let googleEmail = null;
let microsoftToken = null;
let microsoftEmail = null;
let microsoftTokenExpiresAt = 0;
let microsoftCanCreateTeams = false;

function gAuth(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Sem token'));
        return;
      }
      resolve(token);
    });
  });
}

async function gFetch(url, options = {}) {
  if (!googleToken) googleToken = await gAuth(false).catch(() => null);
  if (!googleToken) throw new Error('Conecte o Google Agenda primeiro.');
  const opt = { ...options, headers: { ...(options.headers || {}), Authorization: 'Bearer ' + googleToken } };
  let resp = await fetch(url, opt);
  if (resp.status === 401) {
    // token expirado: remove do cache e tenta renovar
    await new Promise((r) => chrome.identity.removeCachedAuthToken({ token: googleToken }, r));
    googleToken = await gAuth(true);
    opt.headers.Authorization = 'Bearer ' + googleToken;
    resp = await fetch(url, opt);
  }
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json.error && json.error.message) || `Erro HTTP ${resp.status}`);
  return json;
}

function storageLocalGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageLocalSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function base64Url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64Url(bytes).slice(0, len);
}

async function sha256Base64Url(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return base64Url(buf);
}

function launchWebAuth(url) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Login cancelado'));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

function microsoftRedirectUri() {
  return chrome.identity.getRedirectURL(MICROSOFT_REDIRECT_PATH);
}

async function saveMicrosoftToken(json) {
  microsoftToken = json.access_token || null;
  microsoftTokenExpiresAt = Date.now() + ((json.expires_in || 3600) - 60) * 1000;
  await storageLocalSet({
    msAccessToken: microsoftToken,
    msRefreshToken: json.refresh_token || undefined,
    msExpiresAt: microsoftTokenExpiresAt
  });
}

async function exchangeMicrosoftToken(body) {
  const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error_description || json.error || `Erro HTTP ${resp.status}`);
  await saveMicrosoftToken(json);
  return json;
}

async function microsoftAuth(interactive) {
  const cached = await storageLocalGet(['msAccessToken', 'msRefreshToken', 'msExpiresAt']);
  if (cached.msAccessToken && cached.msExpiresAt && cached.msExpiresAt > Date.now()) {
    microsoftToken = cached.msAccessToken;
    microsoftTokenExpiresAt = cached.msExpiresAt;
    return microsoftToken;
  }
  if (cached.msRefreshToken) {
    try {
      await exchangeMicrosoftToken({
        client_id: MICROSOFT_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: cached.msRefreshToken,
        scope: MICROSOFT_SCOPES
      });
      return microsoftToken;
    } catch (_) {}
  }
  if (!interactive) throw new Error('Conecte o Outlook primeiro.');

  const redirectUri = microsoftRedirectUri();
  const verifier = randomString(96);
  const challenge = await sha256Base64Url(verifier);
  const state = randomString(32);
  const authUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  }).toString();
  const finalUrl = new URL(await launchWebAuth(authUrl));
  if (finalUrl.searchParams.get('state') !== state) throw new Error('Falha de seguranca no login Microsoft.');
  const err = finalUrl.searchParams.get('error_description') || finalUrl.searchParams.get('error');
  if (err) throw new Error(err);
  const code = finalUrl.searchParams.get('code');
  if (!code) throw new Error('A Microsoft nao retornou o codigo de autorizacao.');
  await exchangeMicrosoftToken({
    client_id: MICROSOFT_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: MICROSOFT_SCOPES
  });
  return microsoftToken;
}

async function mFetch(path, options = {}) {
  if (!microsoftToken || microsoftTokenExpiresAt <= Date.now()) microsoftToken = await microsoftAuth(false);
  const opt = { ...options, headers: { ...(options.headers || {}), Authorization: 'Bearer ' + microsoftToken } };
  let resp = await fetch('https://graph.microsoft.com/v1.0' + path, opt);
  if (resp.status === 401) {
    microsoftToken = await microsoftAuth(true);
    opt.headers.Authorization = 'Bearer ' + microsoftToken;
    resp = await fetch('https://graph.microsoft.com/v1.0' + path, opt);
  }
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json.error && json.error.message) || `Erro HTTP ${resp.status}`);
  return json;
}

async function detectMicrosoftTeamsSupport() {
  microsoftCanCreateTeams = false;
  try {
    const cal = await mFetch('/me/calendar?$select=allowedOnlineMeetingProviders,defaultOnlineMeetingProvider');
    const allowed = cal.allowedOnlineMeetingProviders || [];
    microsoftCanCreateTeams = allowed.includes('teamsForBusiness') || cal.defaultOnlineMeetingProvider === 'teamsForBusiness';
  } catch (_) {
    microsoftCanCreateTeams = false;
  }
  return microsoftCanCreateTeams;
}

function currentScheduleProvider() {
  return $('schProvider') ? $('schProvider').value : 'google';
}

function updateScheduleProviderUI() {
  const provider = currentScheduleProvider();
  const isOutlook = provider === 'outlook';
  const connected = isOutlook ? !!microsoftToken : !!googleToken;
  $('btnGoogleLogin').classList.toggle('hidden', isOutlook);
  if ($('btnOutlookLogin')) $('btnOutlookLogin').classList.toggle('hidden', !isOutlook);
  $('btnGoogleLogin').classList.toggle('hidden', isOutlook || connected);
  if ($('btnOutlookLogin')) $('btnOutlookLogin').classList.toggle('hidden', !isOutlook || connected);
  if ($('btnGoogleSwitch')) $('btnGoogleSwitch').classList.toggle('hidden', isOutlook || !connected);
  if ($('btnOutlookSwitch')) $('btnOutlookSwitch').classList.toggle('hidden', !isOutlook || !connected);
  $('googleAuth').classList.remove('hidden');
  $('schedForm').classList.toggle('hidden', !connected);
  if ($('schMeetLabel')) {
    $('schMeetLabel').textContent = isOutlook
      ? (connected && !microsoftCanCreateTeams ? 'Teams indisponivel para esta conta Outlook' : 'Criar link do Teams quando disponivel')
      : 'Criar link do Google Meet';
  }
  if ($('schMeet')) {
    $('schMeet').disabled = isOutlook && connected && !microsoftCanCreateTeams;
    if (isOutlook && connected && !microsoftCanCreateTeams) $('schMeet').checked = false;
  }
  if ($('schGuestHint')) $('schGuestHint').textContent = isOutlook
    ? (connected && !microsoftCanCreateTeams
      ? 'Cada convidado recebe o convite por e-mail automaticamente. Esta conta Outlook nao permite criar link do Teams pela extensao.'
      : 'Cada convidado recebe o convite por e-mail automaticamente (com o link do Teams, quando disponivel). Enter ou virgula confirma cada um.')
    : 'Cada convidado recebe o convite por e-mail automaticamente (com o link do Meet). Enter ou virgula confirma cada um.';
  $('slotList').innerHTML = '';
}

async function refreshOutlookStateSilently() {
  try {
    microsoftToken = await microsoftAuth(false);
    if (microsoftToken) await detectMicrosoftTeamsSupport();
  } catch (_) {
    microsoftToken = null;
    microsoftTokenExpiresAt = 0;
    microsoftCanCreateTeams = false;
  } finally {
    updateScheduleProviderUI();
  }
}

function switchScheduleProvider(provider) {
  if ($('schProvider')) $('schProvider').value = provider;
  chrome.storage.local.set({ scheduleProvider: provider });
  updateScheduleProviderUI();
}

function afterCalendarConnected() {
  updateScheduleProviderUI();
  $('schedForm').classList.remove('hidden');
  if (captured && captured.chatName && !$('schTitle').value) {
    $('schTitle').value = 'Reunião - ' + captured.chatName;
  }
  if (!$('schEmail').value) prefillContactEmail();
}

async function clearGoogleCalendarAuth() {
  if (!googleToken) googleToken = await gAuth(false).catch(() => null);
  if (googleToken) await new Promise((r) => chrome.identity.removeCachedAuthToken({ token: googleToken }, r));
  googleToken = null;
  googleEmail = null;
}

async function clearMicrosoftCalendarAuth() {
  microsoftToken = null;
  microsoftEmail = null;
  microsoftTokenExpiresAt = 0;
  microsoftCanCreateTeams = false;
  await new Promise((resolve) => chrome.storage.local.remove(['msAccessToken', 'msRefreshToken', 'msExpiresAt'], resolve));
}

$('btnGoogleLogin').addEventListener('click', async () => {
  const st = $('googleStatus');
  setStatus(st, 'Conectando…', 'info');
  try {
    googleToken = await gAuth(true);
    // descobre o email logado
    try {
      const info = await gFetch('https://www.googleapis.com/oauth2/v2/userinfo');
      googleEmail = info.email || null;
    } catch (_) {}
    setStatus(st, `✓ Conectado${googleEmail ? ' como ' + googleEmail : ''}.`, 'ok');
    switchScheduleProvider('google');
    afterCalendarConnected();
    // pré-preenche título e email a partir do contexto
    if (captured && captured.chatName && !$('schTitle').value) {
      $('schTitle').value = 'Reunião - ' + captured.chatName;
    }
    if (!$('schEmail').value) prefillContactEmail();
  } catch (e) {
    const idHint = chrome.runtime && chrome.runtime.id ? ` ID da extensao: ${chrome.runtime.id}.` : '';
    const clientHint = e.message.includes('client') ? ` Crie no Google Cloud um OAuth Client do tipo Extensao do Chrome usando esse ID e substitua o client_id no manifest.json.${idHint}` : '';
    setStatus(st, 'Erro ao conectar Google Agenda: ' + e.message + clientHint, 'err');
  }
});

// ===== Convidados (múltiplos e-mails como chips) =====
if ($('btnOutlookLogin')) $('btnOutlookLogin').addEventListener('click', async () => {
  const st = $('googleStatus');
  setStatus(st, 'Conectando Outlook...', 'info');
  try {
    microsoftToken = await microsoftAuth(true);
    try {
      const me = await mFetch('/me?$select=mail,userPrincipalName');
      microsoftEmail = me.mail || me.userPrincipalName || null;
    } catch (_) {}
    await detectMicrosoftTeamsSupport();
    setStatus(st, `Outlook conectado${microsoftEmail ? ' como ' + microsoftEmail : ''}${microsoftCanCreateTeams ? ' com Teams disponivel' : ' sem suporte a Teams automatico'}.`, 'ok');
    switchScheduleProvider('outlook');
    afterCalendarConnected();
    if (captured && captured.chatName && !$('schTitle').value) {
      $('schTitle').value = 'Reunião - ' + captured.chatName;
    }
    if (!$('schEmail').value) prefillContactEmail();
  } catch (e) {
    setStatus(st, 'Erro ao conectar Outlook: ' + e.message + '. Cadastre no Microsoft Entra o URI: ' + microsoftRedirectUri(), 'err');
  }
});

if ($('btnGoogleSwitch')) $('btnGoogleSwitch').addEventListener('click', async () => {
  const st = $('googleStatus');
  setStatus(st, 'Trocando conta Google...', 'info');
  try {
    await clearGoogleCalendarAuth();
    updateScheduleProviderUI();
    $('btnGoogleLogin').click();
  } catch (e) {
    setStatus(st, 'Erro ao trocar conta Google: ' + e.message, 'err');
  }
});

if ($('btnOutlookSwitch')) $('btnOutlookSwitch').addEventListener('click', async () => {
  const st = $('googleStatus');
  setStatus(st, 'Trocando conta Outlook...', 'info');
  try {
    await clearMicrosoftCalendarAuth();
    updateScheduleProviderUI();
    $('btnOutlookLogin').click();
  } catch (e) {
    setStatus(st, 'Erro ao trocar conta Outlook: ' + e.message, 'err');
  }
});

if ($('schProvider')) {
  chrome.storage.local.get(['scheduleProvider'], (d) => {
    if (d.scheduleProvider === 'google' || d.scheduleProvider === 'outlook') $('schProvider').value = d.scheduleProvider;
    if ($('schProvider').value === 'outlook') {
      refreshOutlookStateSilently();
    } else updateScheduleProviderUI();
  });
  $('schProvider').addEventListener('change', () => {
    const provider = currentScheduleProvider();
    chrome.storage.local.set({ scheduleProvider: provider });
    if ($('googleStatus')) $('googleStatus').classList.add('hidden');
    if (provider === 'outlook') {
      refreshOutlookStateSilently();
    } else updateScheduleProviderUI();
  });
}

let guestEmails = [];

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function renderGuestChips() {
  const box = $('guestChips');
  box.innerHTML = '';
  guestEmails.forEach((email, i) => {
    const chip = document.createElement('span');
    chip.className = 'guest-chip';
    chip.innerHTML = `${esc(email)} <button type="button" data-i="${i}" aria-label="Remover">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      guestEmails.splice(i, 1);
      renderGuestChips();
    });
    box.appendChild(chip);
  });
}

function addGuestFromInput() {
  const inp = $('schEmail');
  const raw = inp.value.trim().replace(/[,;]+$/, '').trim();
  if (!raw) return;
  if (!isValidEmail(raw)) {
    inp.classList.add('invalid');
    setTimeout(() => inp.classList.remove('invalid'), 1200);
    return;
  }
  if (!guestEmails.includes(raw)) {
    guestEmails.push(raw);
    renderGuestChips();
  }
  inp.value = '';
}

$('schEmail').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
    e.preventDefault();
    addGuestFromInput();
  } else if (e.key === 'Backspace' && !$('schEmail').value && guestEmails.length) {
    guestEmails.pop();
    renderGuestChips();
  }
});
$('schEmail').addEventListener('blur', addGuestFromInput);

// Busca o e-mail da pessoa do deal selecionado, se houver
async function prefillContactEmail() {
  if (!selectedDeal) return;
  try {
    const d = await pdFetch(`/deals/${selectedDeal.id}`);
    const personId = d.data && d.data.person_id && d.data.person_id.value;
    if (!personId) return;
    const p = await pdFetch(`/persons/${personId}`);
    const emails = p.data && p.data.email;
    const primary = Array.isArray(emails) ? (emails.find((e) => e.primary) || emails[0]) : null;
    if (primary && primary.value && !guestEmails.includes(primary.value)) {
      guestEmails.push(primary.value);
      renderGuestChips();
    }
  } catch (_) {}
}

// Listar horários livres no dia (freeBusy → calcula o complemento)
async function getScheduleBusyRanges(provider, date) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayStart = new Date(`${date}T08:00:00`);
  const dayEnd = new Date(`${date}T19:00:00`);
  if (provider === 'outlook') {
    const params = new URLSearchParams({
      startDateTime: dayStart.toISOString(),
      endDateTime: dayEnd.toISOString(),
      '$select': 'subject,start,end,showAs'
    });
    const view = await mFetch(`/me/calendar/calendarView?${params}`);
    const busy = (view.value || [])
      .filter((e) => !['free', 'workingElsewhere'].includes(e.showAs))
      .map((e) => ({ start: e.start && e.start.dateTime, end: e.end && e.end.dateTime }))
      .filter((e) => e.start && e.end);
    return { dayStart, dayEnd, busy };
  }
  const fb = await gFetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      timeZone: tz,
      items: [{ id: 'primary' }]
    })
  });
  const busy = (fb.calendars && fb.calendars.primary && fb.calendars.primary.busy) || [];
  return { dayStart, dayEnd, busy };
}

$('btnFindSlots').addEventListener('click', async () => {
  const date = $('schDate').value;
  const slotEl = $('slotList');
  if (!date) { slotEl.innerHTML = '<div class="slot-empty">Escolha uma data primeiro.</div>'; return; }
  slotEl.innerHTML = '<div class="slot-empty">Buscando…</div>';
  try {
    const dur = parseInt($('schDuration').value, 10);
    const { dayStart, dayEnd, busy } = await getScheduleBusyRanges(currentScheduleProvider(), date);
    const slots = computeFreeSlots(dayStart, dayEnd, busy, dur);
    if (slots.length === 0) {
      slotEl.innerHTML = '<div class="slot-empty">Nenhum horário livre encontrado (8h–19h).</div>';
      return;
    }
    slotEl.innerHTML = '';
    slots.forEach((s) => {
      const hh = String(s.getHours()).padStart(2, '0');
      const mm = String(s.getMinutes()).padStart(2, '0');
      const btn = document.createElement('button');
      btn.className = 'slot-btn';
      btn.textContent = `${hh}:${mm}`;
      btn.addEventListener('click', () => { $('schTime').value = `${hh}:${mm}`; highlightSlot(btn); });
      slotEl.appendChild(btn);
    });
  } catch (e) {
    slotEl.innerHTML = `<div class="slot-empty">Erro: ${esc(e.message)}</div>`;
  }
});

function computeFreeSlots(dayStart, dayEnd, busy, durMin) {
  const slots = [];
  const step = 30 * 60000;      // grade de 30 min
  const dur = durMin * 60000;
  const busyRanges = busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]);
  for (let t = dayStart.getTime(); t + dur <= dayEnd.getTime(); t += step) {
    const slotEnd = t + dur;
    const overlaps = busyRanges.some(([bs, be]) => t < be && slotEnd > bs);
    if (!overlaps) slots.push(new Date(t));
  }
  return slots;
}

function highlightSlot(btn) {
  document.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('sel'));
  btn.classList.add('sel');
}

function microsoftTimeZone() {
  const iana = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const map = {
    'America/Sao_Paulo': 'E. South America Standard Time',
    'America/Fortaleza': 'SA Eastern Standard Time',
    'America/Recife': 'SA Eastern Standard Time',
    'America/Manaus': 'SA Western Standard Time',
    'America/Cuiaba': 'Central Brazilian Standard Time',
    'America/Rio_Branco': 'SA Pacific Standard Time'
  };
  return map[iana] || 'UTC';
}

function graphLocalDateTime(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

function outlookAttendeesFromEmails(guests) {
  return guests.map((email) => ({
    emailAddress: { address: email, name: email },
    type: 'required'
  }));
}

function missingOutlookGuests(event, guests) {
  const got = new Set(((event && event.attendees) || [])
    .map((a) => a.emailAddress && a.emailAddress.address)
    .filter(Boolean)
    .map((email) => email.toLowerCase()));
  return guests.filter((email) => !got.has(email.toLowerCase()));
}

async function createProviderEvent(provider, title, start, end, guests, wantMeet, reminder) {
  if (provider === 'outlook') {
    const tz = microsoftTimeZone();
    const attendees = outlookAttendeesFromEmails(guests);
    const event = {
      subject: title,
      body: {
        contentType: 'HTML',
        content: 'Reuniao agendada pelo ConectCRM.' + (guests.length ? '<br><br>Convidados: ' + guests.join(', ') : '')
      },
      start: { dateTime: graphLocalDateTime(start), timeZone: tz },
      end: { dateTime: graphLocalDateTime(end), timeZone: tz },
      attendees,
      responseRequested: true,
      allowNewTimeProposals: true
    };
    if (reminder === 'none') {
      event.isReminderOn = false;
    } else if (reminder !== '') {
      event.isReminderOn = true;
      event.reminderMinutesBeforeStart = parseInt(reminder, 10);
    }
    if (wantMeet) {
      event.isOnlineMeeting = true;
      event.onlineMeetingProvider = 'teamsForBusiness';
    }
    let created;
    let onlineWarning = '';
    const selfGuests = microsoftEmail ? guests.filter((email) => email.toLowerCase() === microsoftEmail.toLowerCase()) : [];
    const selfWarning = selfGuests.length ? ` (o e-mail ${selfGuests.join(', ')} e a conta Outlook conectada; o Outlook pode nao enviar convite separado para o proprio organizador.)` : '';
    try {
      created = await mFetch('/me/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: `outlook.timezone="${tz}"` },
        body: JSON.stringify(event)
      });
    } catch (e) {
      if (wantMeet) throw new Error('A Microsoft nao permitiu criar o link do Teams para esta conta. Use "Trocar conta Outlook" para autorizar novamente e confirme a permissao OnlineMeetings.ReadWrite no Entra.');
      throw e;
    }
    let attendeeWarning = '';
    const missing = missingOutlookGuests(created, guests);
    if (missing.length && created.id) {
      const updated = await mFetch(`/me/events/${encodeURIComponent(created.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: `outlook.timezone="${tz}"` },
        body: JSON.stringify({ attendees })
      });
      created = updated && updated.id ? updated : created;
      const stillMissing = missingOutlookGuests(created, guests);
      if (stillMissing.length) attendeeWarning = ` (confira no Outlook: convidado(s) nao confirmados no evento: ${stillMissing.join(', ')})`;
    }
    const link = (created.onlineMeeting && created.onlineMeeting.joinUrl) || created.onlineMeetingUrl || '';
    if (wantMeet && !link) {
      if (created.id) {
        try { await mFetch(`/me/events/${encodeURIComponent(created.id)}`, { method: 'DELETE' }); } catch (_) {}
      }
      throw new Error('O Outlook criou o evento sem habilitar o Teams. O evento foi cancelado para evitar agendamento incompleto. Use "Trocar conta Outlook" e autorize novamente; se persistir, verifique se a conta permite Teams pelo Microsoft Graph.');
    }
    return { link, linkLabel: 'Teams', warning: onlineWarning + attendeeWarning + selfWarning };
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const event = {
    summary: title,
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz }
  };
  if (guests.length) event.attendees = guests.map((email) => ({ email }));
  if (wantMeet) {
    event.conferenceData = {
      createRequest: {
        requestId: 'wapd-' + Date.now(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    };
  }
  if (reminder === 'none') {
    event.reminders = { useDefault: false, overrides: [] };
  } else if (reminder !== '') {
    const mins = parseInt(reminder, 10);
    event.reminders = { useDefault: false, overrides: [
      { method: 'popup', minutes: mins },
      { method: 'email', minutes: mins }
    ] };
  }
  const params = new URLSearchParams({ sendUpdates: 'all' });
  if (wantMeet) params.set('conferenceDataVersion', '1');
  const created = await gFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) }
  );
  const link = created.hangoutLink ||
    (created.conferenceData && created.conferenceData.entryPoints &&
      (created.conferenceData.entryPoints.find((e) => e.entryPointType === 'video') || {}).uri) || '';
  return { link, linkLabel: 'Google Meet', warning: '' };
}

$('btnCreateEvent').addEventListener('click', async () => {
  const st = $('schStatus');
  const title = $('schTitle').value.trim();
  const date = $('schDate').value;
  const time = $('schTime').value;
  const dur = parseInt($('schDuration').value, 10);
  if (!title || !date || !time) {
    setStatus(st, 'Preencha título, data e horário.', 'err');
    return;
  }
  if (($('schLogPipe').checked || $('schNote').checked) && !selectedDeal) {
    setStatus(st, 'Selecione um deal em "2 - Deal de destino" antes de criar o agendamento, ou desmarque as opcoes de registrar atividade/nota no deal.', 'err');
    const dealSearch = $('dealSearch');
    if (dealSearch) {
      dealSearch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => dealSearch.focus(), 250);
    }
    return;
  }
  setStatus(st, 'Criando agendamento…', 'info');
  $('btnCreateEvent').disabled = true;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + dur * 60000);
    // garante que um e-mail digitado e não confirmado também entre
    addGuestFromInput();
    const guests = guestEmails.slice();
    const wantMeet = $('schMeet').checked;
    const provider = currentScheduleProvider();
    let meetLink = '';
    let meetLabel = provider === 'outlook' ? 'Teams' : 'Google Meet';
    let providerWarning = '';

    if (provider === 'outlook') {
      const createdInfo = await createProviderEvent(provider, title, start, end, guests, wantMeet, $('schReminder').value);
      meetLink = createdInfo.link || '';
      meetLabel = createdInfo.linkLabel || meetLabel;
      providerWarning = createdInfo.warning || '';
    } else {
    const event = {
      summary: title,
      start: { dateTime: start.toISOString(), timeZone: tz },
      end: { dateTime: end.toISOString(), timeZone: tz }
    };
    if (guests.length) event.attendees = guests.map((email) => ({ email }));
    if (wantMeet) {
      event.conferenceData = {
        createRequest: {
          requestId: 'wapd-' + Date.now(),
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      };
    }

    // Notificação / lembrete
    const rem = $('schReminder').value;
    if (rem === 'none') {
      event.reminders = { useDefault: false, overrides: [] };
    } else if (rem !== '') {
      const mins = parseInt(rem, 10);
      event.reminders = { useDefault: false, overrides: [
        { method: 'popup', minutes: mins },
        { method: 'email', minutes: mins }
      ] };
    }

    const params = new URLSearchParams({ sendUpdates: 'all' });
    if (wantMeet) params.set('conferenceDataVersion', '1');
    const created = await gFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) }
    );

    meetLink = created.hangoutLink ||
      (created.conferenceData && created.conferenceData.entryPoints &&
        (created.conferenceData.entryPoints.find((e) => e.entryPointType === 'video') || {}).uri) || '';

    }
    let msg = `${provider === 'outlook' ? 'Outlook' : 'Google Agenda'}: reuniao criada para ${date} as ${time}.`;
    if (meetLink) msg += ` ${meetLabel}: ${meetLink}`;
    if (providerWarning) msg += providerWarning;

    // Registrar como atividade no Pipedrive
    if ($('schLogPipe').checked && selectedDeal) {
      try {
        // Pipedrive armazena due_date/due_time em UTC. 'start' é o horário local
        // escolhido; convertemos para UTC para a atividade exibir o horário certo.
        const utcDate = start.toISOString().slice(0, 10);   // AAAA-MM-DD em UTC
        const utcTime = start.toISOString().slice(11, 16);  // HH:MM em UTC
        if (await currentCrm() === 'hubspot') {
          await hsCreateTask(selectedDeal.id, {
            subject: title,
            body: (meetLink ? `${meetLabel}: ${meetLink}<br>` : '') + (guests.length ? `Convidados: ${guests.join(', ')}` : ''),
            due: start.toISOString(),
            done: false,
            type: 'TODO'
          });
        } else {
          await pdFetch('/activities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deal_id: selectedDeal.id,
              subject: title,
              type: 'meeting',
              due_date: utcDate,
              due_time: utcTime,
              duration: `${String(Math.floor(dur / 60)).padStart(2, '0')}:${String(dur % 60).padStart(2, '0')}`,
              note: (meetLink ? `${meetLabel}: ${meetLink}<br>` : '') + (guests.length ? `Convidados: ${guests.join(', ')}` : '')
            })
          });
        }
        msg += ' Registrado no deal.';
        if (selectedDeal) loadDealPanel(selectedDeal.id); // atualiza a lista de atividades
      } catch (pe) {
        msg += ' (falha ao registrar no deal: ' + pe.message + ')';
      }
    }
    // Gravar como nota no deal (precisa de deal selecionado)
    if ($('schNote').checked) {
      if (!selectedDeal) {
        msg += ' (nota não gravada: selecione um deal em "2 · Deal de destino")';
      } else {
        try {
          const dataFmt = `${date.split('-').reverse().join('/')} às ${time}`;
          const linhas = [
            `Reunião agendada: ${esc(title)}`,
            `Data/hora: ${dataFmt} (${dur} min)`,
            meetLink ? `${meetLabel}: ${meetLink}` : '',
            guests.length ? `Convidados: ${esc(guests.join(', '))}` : ''
          ].filter(Boolean);
          await createDealNote(selectedDeal.id, linhas.join('<br>'));
          msg += ' Nota gravada no deal.';
          loadDealPanel(selectedDeal.id);
        } catch (ne) {
          msg += ' (falha ao gravar nota: ' + ne.message + ')';
        }
      }
    }
    setStatus(st, msg, 'ok');
  } catch (e) {
    setStatus(st, 'Erro: ' + e.message, 'err');
  } finally {
    $('btnCreateEvent').disabled = false;
  }
});

$('btnSave').addEventListener('click', async () => {
  const statusEl = $('saveStatus');
  const type = document.querySelector('input[name="saveType"]:checked').value;
  const checks = document.querySelectorAll('.media-check:checked');
  const selectedMediaIds = new Set([...checks].map((c) => parseInt(c.value, 10)));
  const localChecks = document.querySelectorAll('.local-check:checked');
  const selectedLocal = [...localChecks].map((c) => localFiles[parseInt(c.value, 10)]).filter(Boolean);
  setStatus(statusEl, 'Gravando…', 'info');
  $('btnSave').disabled = true;

  try {
    // conteúdo da nota: conversa capturada + lista de anexos locais
    let content = captured ? buildContent(selectedMediaIds) : '';

    // Func. 1: se marcado, substitui o texto completo por um resumo da IA
    if (captured && $('useAiSummary').checked) {
      setStatus(statusEl, 'Gerando resumo com IA…', 'info');
      try {
        const summary = await summarizeWithGemini(conversationPlainText(), captured.chatName);
        const header = `Resumo IA — Conversa WhatsApp${captured.chatName ? ' — ' + captured.chatName : ''} (${captured.total} mensagens)`;
        // converte **negrito** do markdown para <b> e quebras de linha para <br>
        const summaryHtml = summary
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
          .replace(/\n/g, '<br>');
        content = `<b>${header}</b><br><br>` + summaryHtml;
      } catch (aiErr) {
        setStatus(statusEl, 'Erro no resumo IA: ' + aiErr.message + ' — gravando texto completo.', 'err');
        // segue com o texto completo já em "content"
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    if (selectedLocal.length) {
      const list = selectedLocal.map((f) => `[anexo: ${f.name}]`).join('<br>');
      content = content
        ? content + '<br><br>Arquivos anexados:<br>' + list
        : 'Arquivos anexados ao deal:<br>' + list;
    }

    if (type === 'note') {
      await createDealNote(selectedDeal.id, content);
    } else {
      const subject = $('activitySubject').value.trim() ||
        `Conversa WhatsApp${captured && captured.chatName ? ' — ' + captured.chatName : ''}`;
      if (await currentCrm() === 'hubspot') {
        await hsCreateTask(selectedDeal.id, {
          subject,
          body: content,
          due: new Date().toISOString(),
          done: true,
          type: 'CALL'
        });
      } else {
        await pdFetch('/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deal_id: selectedDeal.id,
            subject,
            type: 'call',
            done: 1,
            due_date: new Date().toISOString().slice(0, 10),
            note: content
          })
        });
      }
    }

    // Upload das mídias capturadas + arquivos locais
    const mediaById = {};
    (captured ? captured.media || [] : []).forEach((m) => { mediaById[m.id] = m; });
    const totalFiles = selectedMediaIds.size + selectedLocal.length;
    let sent = 0, failed = 0, done = 0;
    for (const id of selectedMediaIds) {
      const m = mediaById[id];
      if (!m || !m.base64) continue;
      done++;
      setStatus(statusEl, `Enviando arquivo ${done} de ${totalFiles}…`, 'info');
      try { await uploadMedia(selectedDeal.id, m); sent++; }
      catch (e) { failed++; }
    }
    for (const f of selectedLocal) {
      done++;
      setStatus(statusEl, `Enviando arquivo ${done} de ${totalFiles}…`, 'info');
      try { await uploadFile(selectedDeal.id, f.base64, f.mime, f.name); sent++; }
      catch (e) { failed++; }
    }

    const what = captured ? (type === 'note' ? 'Nota gravada' : 'Atividade registrada') : 'Nota gravada';
    let msg = `✓ ${what} no deal "${selectedDeal.title}".`;
    if (sent) msg += ` ${sent} arquivo(s) anexado(s).`;
    if (failed) msg += ` ${failed} falharam.`;
    setStatus(statusEl, msg, failed ? 'info' : 'ok');
  } catch (e) {
    setStatus(statusEl, 'Erro ao gravar: ' + e.message, 'err');
  } finally {
    $('btnSave').disabled = false;
  }
});

// ============================================================
//  COBRANÇAS (ASAAS) — BYOK direto da extensão  (v1.19)
// ============================================================
function asaasBase(env) { return env === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3'; }

async function asaasFetch(path, opts) {
  const cfg = await getConfig();
  if (!cfg.asaasKey) throw new Error('Configure a chave do ASAAS nas Configurações.');
  const resp = await fetch(asaasBase(cfg.asaasEnv) + path, Object.assign({}, opts, {
    headers: Object.assign({ 'Content-Type': 'application/json', 'access_token': cfg.asaasKey }, (opts && opts.headers) || {})
  }));
  let json = {};
  try { json = await resp.json(); } catch (_) {}
  if (!resp.ok) {
    const msg = (json && json.errors && json.errors.map((e) => e.description).join(' · ')) || ('Erro HTTP ' + resp.status);
    throw new Error(msg);
  }
  return json;
}

const onlyDigits = (s) => (s || '').replace(/\D/g, '');
function brToNumber(s) { return parseFloat(String(s || '').replace(/\./g, '').replace(',', '.')); }
function fmtMoney(n) { return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDateBR(iso) { if (!iso) return ''; const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; }

// Testar conexão ASAAS (na config)
$('btnTestAsaas').addEventListener('click', async () => {
  const msg = $('asaasTestMsg');
  const keyEl = $('cfgAsaas');
  const key = (keyEl.dataset.dirty ? keyEl.value.trim() : '') || savedSecrets.asaasKey || '';
  if (!key) { msg.textContent = 'Informe a chave primeiro.'; return; }
  msg.textContent = 'Testando…';
  try {
    const env = $('cfgAsaasEnv').value || 'producao';
    const resp = await fetch(asaasBase(env) + '/myAccount', { headers: { 'access_token': key } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const acc = await resp.json();
    msg.textContent = '✓ Conectado' + (acc && acc.name ? ' · ' + acc.name : '');
  } catch (e) { msg.textContent = '✗ Falhou: ' + e.message; }
});

let cobDeal = null; // { dealId, person:{id,name,email,phone}, org:{id,name} }

const CICLOS = { WEEKLY: 'Semanal', BIWEEKLY: 'Quinzenal', MONTHLY: 'Mensal', BIMONTHLY: 'Bimestral', QUARTERLY: 'Trimestral', SEMIANNUALLY: 'Semestral', YEARLY: 'Anual' };
function fmtCycle(c) { return CICLOS[c] || c; }
function cobIsRecorrente() { const r = document.querySelector('input[name="cobKind"]:checked'); return r && r.value === 'recorrente'; }

function applyBillingMode() {
  const rec = cobIsRecorrente();
  const link = $('cobBilling').value === 'LINK';
  // Link agora é permitido também em recorrente (vira cobrança recorrente no cartão pelo checkout)
  const linkOpt = $('cobBilling').querySelector('option[value="LINK"]');
  if (linkOpt) linkOpt.disabled = false;

  $('cobCpfRow').classList.toggle('hidden', link);
  $('cobContactRow').classList.toggle('hidden', link);
  $('cobInstallRow').classList.toggle('hidden', link || rec);
  $('cobCycleRow').classList.toggle('hidden', !rec);          // ciclo: qualquer recorrente
  $('cobEndRow').classList.toggle('hidden', !rec || link);    // endDate só p/ assinatura PIX/Boleto
  $('cobDueRow').classList.toggle('hidden', link);            // link não usa vencimento
  const dueSpan = $('cobDueRow').querySelector('span');
  if (dueSpan) dueSpan.textContent = rec ? '1ª cobrança *' : 'Vencimento *';
  // dica do link recorrente no cartão
  const hint = $('cobLinkHint');
  if (hint) hint.classList.toggle('hidden', !(rec && link));
}

// Abrir a tela de cobrança (gate: licença + chave ASAAS)
$('btnCobranca').addEventListener('click', async () => {
  const ls = await getLicenseState();
  if (!ls.licValid) { const r = await checkLicense(false); renderLicenseScreen(r); showView('license'); return; }
  const cfg = await getConfig();
  if (!cfg.asaasKey) { await openConfig(true); $('asaasTestMsg').textContent = '↑ Configure sua chave do ASAAS para gerar cobranças.'; return; }
  openCobranca();
});
$('btnCobBack').addEventListener('click', () => showView('main'));
$('cobBilling').addEventListener('change', applyBillingMode);
document.querySelectorAll('input[name="cobKind"]').forEach((r) => r.addEventListener('change', applyBillingMode));
document.querySelectorAll('input[name="cobEntity"]').forEach((r) => r.addEventListener('change', fillEntity));

async function openCobranca() {
  showView('cobranca');
  $('cobResult').classList.add('hidden');
  $('cobStatus').classList.add('hidden');
  const av = document.querySelector('input[name="cobKind"][value="avulsa"]'); if (av) av.checked = true;
  applyBillingMode();
  const d = new Date(); d.setDate(d.getDate() + 3);
  $('cobDue').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  cobDeal = null;
  if (selectedDeal) {
    $('cobMode').innerHTML = `Vinculada ao deal: <b>${esc(selectedDeal.title)}</b>`;
    $('cobEntityRow').classList.remove('hidden');
    $('cobSaveRow').classList.remove('hidden');
    await loadDealForCharge(selectedDeal.id);
  } else {
    $('cobMode').textContent = 'Cobrança avulsa (sem vínculo com deal).';
    $('cobEntityRow').classList.add('hidden');
    $('cobSaveRow').classList.add('hidden');
    ['cobName', 'cobCpf', 'cobEmail', 'cobPhone', 'cobValue', 'cobDesc'].forEach((id) => { $(id).value = ''; });
  }
  chrome.storage.local.get(['lastCharge'], (s) => { if (s.lastCharge) renderChargeResult(s.lastCharge, true); });
}

async function loadDealForCharge(dealId) {
  try {
    const deal = (await pdFetch(`/deals/${dealId}`)).data || {};
    const personId = deal.person_id && (deal.person_id.value || deal.person_id);
    const orgId = deal.org_id && (deal.org_id.value || deal.org_id);
    const info = { dealId, person: null, org: null };
    if (personId) {
      const p = (await pdFetch(`/persons/${personId}`)).data || {};
      info.person = { id: personId, name: p.name || '', email: (p.email && p.email[0] && p.email[0].value) || '', phone: (p.phone && p.phone[0] && p.phone[0].value) || '' };
    }
    if (orgId) {
      const o = (await pdFetch(`/organizations/${orgId}`)).data || {};
      info.org = { id: orgId, name: o.name || '' };
    }
    cobDeal = info;
    fillEntity();
  } catch (e) {
    $('cobMode').innerHTML += ` <span class="lic-status err">(não consegui carregar o contato: ${esc(e.message)})</span>`;
  }
}

function fillEntity() {
  if (!cobDeal) return;
  const sel = document.querySelector('input[name="cobEntity"]:checked');
  const entity = sel ? sel.value : 'person';
  if (entity === 'org' && cobDeal.org) {
    $('cobName').value = cobDeal.org.name || ''; $('cobEmail').value = ''; $('cobPhone').value = '';
  } else if (cobDeal.person) {
    $('cobName').value = cobDeal.person.name || ''; $('cobEmail').value = cobDeal.person.email || ''; $('cobPhone').value = cobDeal.person.phone || '';
  }
}

$('cobCpf').addEventListener('blur', async () => {
  const cpf = onlyDigits($('cobCpf').value);
  if (cpf.length < 11) return;
  try {
    const r = await asaasFetch(`/customers?cpfCnpj=${cpf}`);
    const c = r.data && r.data[0];
    if (c) {
      if (!$('cobName').value) $('cobName').value = c.name || '';
      if (!$('cobEmail').value) $('cobEmail').value = c.email || '';
      if (!$('cobPhone').value) $('cobPhone').value = c.mobilePhone || c.phone || '';
      setStatus($('cobStatus'), 'Cliente já cadastrado no ASAAS — dados preenchidos.', 'info');
    }
  } catch (_) {}
});

async function resolveAsaasCustomer() {
  const cpf = onlyDigits($('cobCpf').value);
  const found = await asaasFetch(`/customers?cpfCnpj=${cpf}`);
  if (found.data && found.data[0]) return found.data[0];
  const body = { name: $('cobName').value.trim(), cpfCnpj: cpf };
  const email = $('cobEmail').value.trim(); if (email) body.email = email;
  const phone = onlyDigits($('cobPhone').value); if (phone) body.mobilePhone = phone;
  return asaasFetch('/customers', { method: 'POST', body: JSON.stringify(body) });
}

async function writeBackToPipedrive() {
  if (!cobDeal) return;
  const sel = document.querySelector('input[name="cobEntity"]:checked');
  const entity = sel ? sel.value : 'person';
  const name = $('cobName').value.trim();
  const email = $('cobEmail').value.trim();
  const phone = $('cobPhone').value.trim();
  try {
    if (entity === 'org' && cobDeal.org) {
      await pdFetch(`/organizations/${cobDeal.org.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    } else if (cobDeal.person) {
      const body = { name };
      if (email) body.email = [{ value: email, primary: true }];
      if (phone) body.phone = [{ value: phone, primary: true }];
      await pdFetch(`/persons/${cobDeal.person.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
  } catch (e) { console.warn('write-back Pipedrive falhou', e); }
}

$('btnGenCharge').addEventListener('click', async () => {
  const st = $('cobStatus');
  const billing = $('cobBilling').value;
  const value = brToNumber($('cobValue').value);
  const desc = $('cobDesc').value.trim();
  const name = $('cobName').value.trim();
  if (!name) { setStatus(st, 'Informe o nome do cliente.', 'err'); return; }
  if (!value || value <= 0) { setStatus(st, 'Informe um valor válido.', 'err'); return; }

  setStatus(st, 'Gerando cobrança…', 'info');
  $('btnGenCharge').disabled = true;
  try {
    let result;
    const rec = cobIsRecorrente();
    if (billing === 'LINK') {
      const body = { name: desc || name, value, description: desc || undefined };
      if (rec) { body.billingType = 'CREDIT_CARD'; body.chargeType = 'RECURRENT'; body.subscriptionCycle = $('cobCycle').value; }
      else { body.billingType = 'UNDEFINED'; body.chargeType = 'DETACHED'; body.dueDateLimitDays = 5; }
      const link = await asaasFetch('/paymentLinks', { method: 'POST', body: JSON.stringify(body) });
      result = { tipo: 'LINK', recorrente: rec, ciclo: rec ? $('cobCycle').value : undefined, valor: value, descricao: desc, cliente: name, link: link.url, cartaoRecorrente: rec };
    } else if (rec) {
      const cpf = onlyDigits($('cobCpf').value);
      if (cpf.length < 11) { setStatus(st, 'Informe um CPF/CNPJ válido.', 'err'); $('btnGenCharge').disabled = false; return; }
      const nextDue = $('cobDue').value;
      if (!nextDue) { setStatus(st, 'Informe a data da 1ª cobrança.', 'err'); $('btnGenCharge').disabled = false; return; }
      const customer = await resolveAsaasCustomer();
      const subBody = { customer: customer.id, billingType: billing, value, nextDueDate: nextDue, cycle: $('cobCycle').value, description: desc || undefined };
      const endVal = $('cobEnd').value; if (endVal) subBody.endDate = endVal;
      const sub = await asaasFetch('/subscriptions', { method: 'POST', body: JSON.stringify(subBody) });
      result = { tipo: billing, recorrente: true, ciclo: $('cobCycle').value, valor: value, vencimento: nextDue, descricao: desc, cliente: name, subscriptionId: sub.id };
      // recupera a 1ª cobrança gerada (é criada após a assinatura)
      try {
        const pays = await asaasFetch(`/subscriptions/${sub.id}/payments?limit=10`);
        const p = (pays.data || []).slice().sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))[0];
        if (p) {
          result.invoiceUrl = p.invoiceUrl; result.boletoUrl = p.bankSlipUrl || ''; result.paymentId = p.id;
          if (billing === 'PIX') { try { const qr = await asaasFetch(`/payments/${p.id}/pixQrCode`); result.pixPayload = qr.payload; result.pixImg = qr.encodedImage; } catch (_) {} }
        }
      } catch (_) {}
      if (cobDeal && $('cobSavePd').checked) await writeBackToPipedrive();
    } else {
      const cpf = onlyDigits($('cobCpf').value);
      if (cpf.length < 11) { setStatus(st, 'Informe um CPF/CNPJ válido.', 'err'); $('btnGenCharge').disabled = false; return; }
      const due = $('cobDue').value;
      if (!due) { setStatus(st, 'Informe o vencimento.', 'err'); $('btnGenCharge').disabled = false; return; }
      const customer = await resolveAsaasCustomer();
      const body = { customer: customer.id, billingType: billing, value, dueDate: due, description: desc || undefined };
      const inst = parseInt($('cobInstall').value, 10);
      if (inst > 1) { body.installmentCount = inst; body.installmentValue = +(value / inst).toFixed(2); }
      const pay = await asaasFetch('/payments', { method: 'POST', body: JSON.stringify(body) });
      result = { tipo: billing, valor: value, vencimento: due, descricao: desc, cliente: name, invoiceUrl: pay.invoiceUrl, boletoUrl: pay.bankSlipUrl || '', paymentId: pay.id };
      if (billing === 'PIX') {
        try { const qr = await asaasFetch(`/payments/${pay.id}/pixQrCode`); result.pixPayload = qr.payload; result.pixImg = qr.encodedImage; } catch (_) {}
      }
      if (cobDeal && $('cobSavePd').checked) await writeBackToPipedrive();
    }
    result.dealVinculado = cobDeal ? cobDeal.dealId : null;
    chrome.storage.local.set({ lastCharge: result });
    setStatus(st, '✓ Cobrança criada!', 'ok');
    renderChargeResult(result, false);
  } catch (e) {
    setStatus(st, 'Erro: ' + e.message, 'err');
  } finally {
    $('btnGenCharge').disabled = false;
  }
});

function field(label, value, isCode) {
  const tag = isCode ? 'code' : 'span';
  return `<div class="cob-field"><span class="cob-flabel">${esc(label)}</span>
    <div class="cob-frow"><${tag} class="cob-fval">${esc(value)}</${tag}>
    <button type="button" class="link-btn cob-copy" data-val="${esc(value)}">Copiar</button>
    ${isCode ? '' : `<a href="${esc(value)}" target="_blank" rel="noopener" class="link-btn">Abrir</a>`}</div></div>`;
}

function buildChargeMessage(r) {
  const L = [];
  L.push('Olá! Segue sua cobrança:');
  if (r.descricao) L.push(r.descricao);
  L.push('');
  L.push(`Valor: ${fmtMoney(r.valor)}`);
  if (r.vencimento) L.push(`Vencimento: ${fmtDateBR(r.vencimento)}`);
  if (r.recorrente) L.push(`Recorrência: ${fmtCycle(r.ciclo)}`);
  if (r.pixPayload) { L.push(''); L.push('PIX (copia e cola):'); L.push(r.pixPayload); }
  const links = [];
  if (r.boletoUrl) links.push(`Boleto: ${r.boletoUrl}`);
  if (r.invoiceUrl) links.push(`Fatura online: ${r.invoiceUrl}`);
  if (r.link) links.push(`Link de pagamento: ${r.link}`);
  if (links.length) { L.push(''); links.forEach((l) => L.push(l)); }
  return L.join('\n');
}

function renderChargeResult(r, restored) {
  const box = $('cobResult');
  const linhas = [];
  if (restored) linhas.push(`<div class="cob-restored">Última cobrança gerada (mantida ao reabrir):</div>`);
  linhas.push(`<div class="cob-head">✓ ${esc(r.cliente || '')} — ${fmtMoney(r.valor)}${r.vencimento ? ' · vence ' + fmtDateBR(r.vencimento) : ''}</div>`);
  if (r.recorrente && r.cartaoRecorrente) linhas.push(`<div class="cob-sub">✓ Assinatura ${esc(fmtCycle(r.ciclo))} no cartão — pagamento no checkout do ASAAS</div>`);
  else if (r.recorrente) linhas.push(`<div class="cob-sub">✓ Assinatura ${esc(fmtCycle(r.ciclo))} — 1ª cobrança ${fmtDateBR(r.vencimento)}</div>`);
  if (r.pixImg) linhas.push(`<img class="cob-qr" src="data:image/png;base64,${r.pixImg}" alt="QR Code PIX" />`);
  if (r.pixPayload) linhas.push(field('PIX copia e cola', r.pixPayload, true));
  if (r.invoiceUrl) linhas.push(field('Link da fatura', r.invoiceUrl, false));
  if (r.boletoUrl) linhas.push(field('Boleto (PDF)', r.boletoUrl, false));
  if (r.link) linhas.push(field('Link de pagamento', r.link, false));
  linhas.push(`<div class="cob-actions"><button type="button" id="btnCopyAll" class="primary"><svg class="btn-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>Copiar tudo</button><button type="button" id="btnCopyWa" class="wa-send"><svg class="btn-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>Copiar e enviar no WhatsApp</button></div>`);
  if (r.dealVinculado) linhas.push(`<button type="button" id="btnNoteDeal" class="link-btn">Registrar no deal (nota)</button>`);
  linhas.push(`<button type="button" id="btnNewCharge" class="link-btn">+ Nova cobrança</button>`);
  linhas.push(`<div id="cobResultMsg" class="cob-msg"></div>`);
  box.innerHTML = linhas.join('');
  box.classList.remove('hidden');

  box.querySelectorAll('.cob-copy').forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard.writeText(b.getAttribute('data-val'));
    b.textContent = 'Copiado ✓'; setTimeout(() => (b.textContent = 'Copiar'), 1500);
  }));
  const msgText = buildChargeMessage(r);
  $('btnCopyAll').addEventListener('click', () => { navigator.clipboard.writeText(msgText); $('cobResultMsg').textContent = 'Copiado para a área de transferência ✓'; });
  $('btnCopyWa').addEventListener('click', () => sendToWhatsApp(msgText));
  if ($('btnNoteDeal')) $('btnNoteDeal').addEventListener('click', () => registerNote(r));
  if ($('btnNewCharge')) $('btnNewCharge').addEventListener('click', () => { chrome.storage.local.remove('lastCharge'); openCobranca(); });
}

async function sendToWhatsApp(text) {
  const msg = $('cobResultMsg');
  try { await navigator.clipboard.writeText(text); } catch (_) {}
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.startsWith('https://web.whatsapp.com')) {
      msg.textContent = 'Copiado ✓ — abra a conversa no WhatsApp Web e cole (Ctrl+V).'; return;
    }
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (txt) => {
        const box = document.querySelector('footer [contenteditable="true"]') ||
          (() => { const a = document.querySelectorAll('[contenteditable="true"]'); return a[a.length - 1]; })();
        if (!box) return false;
        box.focus();
        // 1) tenta um evento de "colar" — o WhatsApp preserva as quebras de linha
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', txt);
          const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
          box.dispatchEvent(ev);
          return true;
        } catch (e) {
          // 2) fallback: insere linha a linha com quebra explícita
          try {
            const linhas = txt.split('\n');
            linhas.forEach((ln, i) => {
              if (ln) document.execCommand('insertText', false, ln);
              if (i < linhas.length - 1) document.execCommand('insertLineBreak');
            });
            return true;
          } catch (e2) { return false; }
        }
      },
      args: [text]
    });
    msg.textContent = (res && res.result) ? 'Enviado para a caixa do WhatsApp ✓ (revise e aperte enviar)' : 'Copiado ✓ — cole na conversa (Ctrl+V).';
  } catch (e) { msg.textContent = 'Copiado ✓ — cole na conversa (Ctrl+V).'; }
}

async function registerNote(r) {
  const msg = $('cobResultMsg');
  if (!r.dealVinculado) return;
  msg.textContent = 'Registrando nota…';
  const L = [`<b>Cobrança gerada (ASAAS)</b>`, `Cliente: ${r.cliente}`, `Valor: ${fmtMoney(r.valor)}` + (r.vencimento ? ` · vence ${fmtDateBR(r.vencimento)}` : '')];
  if (r.recorrente) L.push(`Assinatura: ${fmtCycle(r.ciclo)} (recorrente)`);
  if (r.descricao) L.push(`Descrição: ${r.descricao}`);
  if (r.invoiceUrl) L.push(`Fatura: ${r.invoiceUrl}`);
  if (r.boletoUrl) L.push(`Boleto: ${r.boletoUrl}`);
  if (r.link) L.push(`Link: ${r.link}`);
  if (r.pixPayload) L.push(`PIX copia e cola: ${r.pixPayload}`);
  try {
    await createDealNote(r.dealVinculado, L.join('<br>'));
    msg.textContent = 'Nota registrada no deal ✓';
  } catch (e) { msg.textContent = 'Erro ao registrar nota: ' + e.message; }
}
