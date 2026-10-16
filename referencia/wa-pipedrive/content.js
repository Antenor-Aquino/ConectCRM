// WhatsApp → Pipedrive · content script v1.2
// Extrai as últimas X mensagens E as mídias (blob) carregadas nelas.
// Retorna uma Promise — chrome.scripting.executeScript aguarda a resolução.
(async () => {
  const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB por arquivo

  function getChatName() {
    const header = document.querySelector('#main header');
    if (!header) return null;
    // 1ª linha visível do header = nome do contato (a 2ª é o "visto por último")
    const lines = (header.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length) return lines[0];
    const candidates = header.querySelectorAll('span[title]');
    for (const s of candidates) {
      const title = (s.getAttribute('title') || '').trim();
      if (title) return title;
    }
    return null;
  }

  function classifyDirection(el) {
    let node = el;
    for (let i = 0; node && i < 8; i++) {
      if (node.classList) {
        if (node.classList.contains('message-out')) return 'out';
        if (node.classList.contains('message-in')) return 'in';
      }
      const dataId = node.getAttribute && node.getAttribute('data-id');
      if (dataId) {
        if (dataId.startsWith('true_')) return 'out';
        if (dataId.startsWith('false_')) return 'in';
      }
      node = node.parentElement;
    }
    return 'in';
  }

  function findBubble(el) {
    if (!el) return el;
    // prioridade: linha completa da mensagem (contém player, imagem etc.)
    const row = el.closest && (el.closest('div[role="row"]') || el.closest('[data-id]') || el.closest('.message-in, .message-out'));
    if (row) return row;
    // fallback: sobe alguns níveis até um contêiner largo
    let node = el;
    const main = document.querySelector('#main');
    for (let i = 0; i < 6; i++) {
      if (!node.parentElement || node.parentElement === main) break;
      node = node.parentElement;
    }
    return node;
  }

  // Localiza mídias dentro de um balão e descreve cada uma
  function findMediaIn(bubble) {
    const found = [];
    if (!bubble) return found;

    // DOCUMENTO primeiro: se o balão é um documento (PDF, etc.), a "imagem"
    // que aparece é só a prévia da 1ª página — não deve ser tratada como foto.
    // Estrutura real (diag): [data-testid="document-thumb"], title="Mostrar 'nome.pdf'"
    const docThumb = bubble.querySelector('[data-testid="document-thumb"], [data-icon*="document"], [data-testid*="document"]');
    let docTitle = null;
    const thumbTitleEl = bubble.querySelector('[title^="Mostrar"]');
    if (thumbTitleEl) {
      const m = (thumbTitleEl.getAttribute('title') || '').match(/Mostrar\s+["']?(.+?)["']?$/);
      if (m) docTitle = m[1];
    }
    const docName = docTitle ||
      ((bubble.innerText || '').match(/([\w\u00C0-\u017F\-. ()\[\]]+\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip))\b/i) || [])[1];
    const isDocument = !!(docThumb || docName);

    if (isDocument) {
      found.push({
        kind: 'docpending',
        url: null,
        filename: docName ? docName.trim() : null,
        label: '📄 ' + (docName ? docName.trim() : 'Documento')
      });
      return found; // não procura imagem/áudio neste balão
    }

    // Imagens como <img src="blob:...">
    bubble.querySelectorAll('img[src^="blob:"]').forEach((img) => {
      const w = img.naturalWidth || img.width || 0;
      if (w < 60) return;
      found.push({ kind: 'image', url: img.src, label: '🖼 Imagem' });
    });

    // Imagens servidas pelo CDN do WhatsApp (https://media...)
    bubble.querySelectorAll('img[src^="https"]').forEach((img) => {
      const w = img.width || img.naturalWidth || 0;
      const h = img.height || img.naturalHeight || 0;
      // exclui avatares (pequenos e quadrados) e ícones
      if (w < 100 || h < 100) return;
      found.push({ kind: 'image', url: img.src, label: '🖼 Imagem' });
    });

    // Imagens como background-image (forma atual do WhatsApp)
    bubble.querySelectorAll('[style*="background-image"]').forEach((el) => {
      const m = (el.getAttribute('style') || '').match(/url\(["']?(blob:[^"')]+)/);
      if (m) found.push({ kind: 'image', url: m[1], label: '🖼 Imagem' });
    });

    // Preview base64 (quando a imagem cheia ainda não carregou)
    if (!found.some((f) => f.kind === 'image')) {
      bubble.querySelectorAll('img[src^="data:image"]').forEach((img) => {
        if ((img.src || '').length < 4000) return; // ignora thumbs minúsculas
        found.push({ kind: 'image', url: img.src, isDataUri: true, label: '🖼 Imagem (prévia — abra a foto p/ qualidade total)' });
      });
    }

    bubble.querySelectorAll('audio[src^="blob:"], audio source[src^="blob:"]').forEach((a) => {
      const url = a.src || a.getAttribute('src');
      if (url) found.push({ kind: 'audio', url, label: '🎵 Áudio' });
    });

    // Mensagem de voz: sinais confirmados pelo diagnóstico real
    // (icons: "ptt-status"; arias: "Reproduzir mensagem de voz", "Mensagem de voz")
    if (!found.some((f) => f.kind === 'audio')) {
      const isVoice =
        bubble.querySelector('[data-icon*="ptt"], [data-icon*="audio"], [data-icon*="mic"]') ||
        bubble.querySelector('[aria-label*="mensagem de voz" i], [aria-label*="voice message" i], button[aria-label*="reproduz" i], button[aria-label*="play" i]') ||
        (bubble.querySelector('input[type="range"], [role="slider"]') && /\b\d{1,2}:\d{2}\b/.test(bubble.innerText || ''));
      if (isVoice) {
        const durMatch = (bubble.innerText || '').match(/\b(\d{1,2}:\d{2})\b/);
        found.push({ kind: 'voice', url: null, label: '🎵 Áudio' + (durMatch ? ' ' + durMatch[1] : '') });
      }
    }

    bubble.querySelectorAll('video[src^="blob:"], video source[src^="blob:"]').forEach((v) => {
      const url = v.src || v.getAttribute('src');
      if (url) found.push({ kind: 'video', url, label: '🎬 Vídeo' });
    });

    return found;
  }

  // Lê o log do gancho (script MAIN-world grava JSON em um elemento do DOM)
  function hookLogEntries() {
    const log = document.getElementById('__waPdBlobLog');
    if (!log) return [];
    try {
      const parsed = JSON.parse(log.textContent || '{}');
      // nova estrutura { stats, items }; tolera estrutura antiga (array)
      if (Array.isArray(parsed)) return parsed;
      return parsed.items || [];
    } catch (_) { return []; }
  }

  // Áudios: <audio> com blob na página + entradas (base64) do gancho
  function globalAudioBlobs() {
    const out = [];
    document.querySelectorAll('audio').forEach((a) => {
      const src = a.src || (a.querySelector('source') && a.querySelector('source').src) || '';
      if (src.startsWith('blob:')) out.push({ url: src });
    });
    hookLogEntries()
      .filter((e) => e.b64 && e.type && (e.type.startsWith('audio') || e.type === 'application/ogg'))
      .forEach((e) => out.push({ b64: e.b64, type: e.type }));
    return out;
  }

  // Documentos: entradas (base64) do gancho com tipos de documento
  function globalDocBlobs() {
    return hookLogEntries()
      .filter((e) => e.b64 && e.type && /^(application\/(pdf|zip|x-zip|msword|vnd\.|octet-stream)|text\/(csv|plain))/.test(e.type))
      .map((e) => ({ b64: e.b64, type: e.type }));
  }

  // Telefone do contato: tenta vários formatos de ID do WhatsApp.
  // Chats novos usam "@lid" (ID anônimo, sem número) — nesses casos, lê o
  // painel "Dados do contato" se estiver aberto na tela.
  function getChatPhone(main) {
    // 1. data-id clássico com número
    const els = main.querySelectorAll('[data-id]');
    for (const el of els) {
      const id = el.getAttribute('data-id') || '';
      const m = id.match(/(\d{10,15})@(?:c\.us|s\.whatsapp\.net)/);
      if (m) return '+' + m[1];
    }
    // 2. header: contato não salvo exibe o próprio número como título
    const header = document.querySelector('#main header');
    if (header) {
      const t = (header.innerText || '').match(/\+\d[\d\s().-]{9,18}\d/);
      if (t) return t[0].replace(/[\s().-]/g, '');
    }
    // 3. painel "Dados do contato" aberto: procura um elemento curto cujo
    // texto seja apenas um telefone (fora da área de mensagens)
    const spans = document.querySelectorAll('span, div');
    for (const s of spans) {
      if (main.contains(s)) continue;
      if (s.children.length > 0) continue;
      const txt = (s.textContent || '').trim();
      if (txt.length < 8 || txt.length > 22) continue;
      if (/^\+\d[\d\s().-]{8,18}\d$/.test(txt)) {
        return txt.replace(/[\s().-]/g, '');
      }
    }
    return null;
  }

  // Data da mensagem a partir do meta "[HH:MM, DD/MM/AAAA] Nome:"
  function parseMsgDate(meta) {
    if (!meta) return null;
    const m = meta.match(/(\d{1,2}):(\d{2}),?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    return new Date(+m[5], +m[4] - 1, +m[3], +m[1], +m[2]);
  }

  function mediaPlaceholder(bubble) {
    if (!bubble) return '';
    // áudio primeiro: linhas de voz contêm o avatar (img https) e seriam
    // confundidas com [Imagem]
    if (bubble.querySelector('[data-icon*="ptt"], [data-icon*="audio"], [data-icon*="mic"], audio, [aria-label*="mensagem de voz" i], [aria-label*="voice message" i], button[aria-label*="reproduz" i]')) return '[Áudio]';
    if (bubble.querySelector('video')) return '[Vídeo]';
    if (bubble.querySelector('[data-icon="document"], [data-icon*="doc"]')) return '[Documento]';
    if (/\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip)\b/i.test(bubble.innerText || '')) return '[Documento]';
    if (bubble.querySelector('[data-icon="sticker"]')) return '[Figurinha]';
    if (bubble.querySelector('img[src^="blob:"], [style*="background-image"], img[src^="data:image"]')) return '[Imagem]';
    for (const img of bubble.querySelectorAll('img[src^="https"]')) {
      if ((img.width || img.naturalWidth || 0) >= 100 && (img.height || img.naturalHeight || 0) >= 100) return '[Imagem]';
    }
    return '';
  }

  async function blobToBase64(url) {
    // data: URI (prévia base64) — converte direto, sem fetch
    if (url.startsWith('data:')) {
      const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
      if (m && m[2]) {
        const b64 = m[3];
        const size = Math.floor(b64.length * 0.75);
        return { base64: b64, size, mime: m[1] || 'image/jpeg' };
      }
    }
    const resp = await fetch(url);
    const blob = await resp.blob();
    if (blob.size > MAX_MEDIA_BYTES) return { tooBig: true, size: blob.size, mime: blob.type };
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = () => rej(new Error('read fail'));
      r.readAsDataURL(blob);
    });
    return { base64: b64, size: blob.size, mime: blob.type || 'application/octet-stream' };
  }

  function extFromMime(mime, kind) {
    const map = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
      'audio/ogg': 'ogg', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
      'video/mp4': 'mp4', 'video/webm': 'webm',
      'application/pdf': 'pdf', 'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/zip': 'zip', 'text/csv': 'csv', 'text/plain': 'txt'
    };
    if (map[mime]) return map[mime];
    if (mime && mime.includes('/')) return mime.split('/')[1].split(';')[0];
    return kind === 'image' ? 'jpg' : kind === 'audio' ? 'ogg' : kind === 'doc' ? 'pdf' : 'bin';
  }

  function sanitizeFilename(name) {
    return (name || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  // Direção da mensagem pela estrutura real (diag): ícones tail-in/tail-out,
  // aria "Você:", ou prefixo true_/false_ no data-id (formato antigo)
  function rowDirection(row) {
    if (row.querySelector('[data-icon="tail-out"]')) return 'out';
    if (row.querySelector('[data-icon="tail-in"]')) return 'in';
    if (row.querySelector('[aria-label="Você:"], [aria-label="You:"]')) return 'out';
    const idEl = row.querySelector('[data-id]');
    const id = idEl ? (idEl.getAttribute('data-id') || '') : '';
    if (id.startsWith('true_')) return 'out';
    if (id.startsWith('false_')) return 'in';
    // mensagens enviadas têm status "Entregue/Lida" no aria
    if (row.querySelector('[aria-label*="Entregue" i], [aria-label*="Lida" i], [aria-label*="Delivered" i], [aria-label*="Read" i]')) return 'out';
    return 'in';
  }

  function collectRawMessages(main) {
    const msgs = [];

    // ESTRATÉGIA PRINCIPAL: cada div[role="row"] é uma mensagem completa
    // (confirma o diagnóstico: voz/mídia não têm data-pre-plain-text nem
    // classes message-in/out — só a linha inteira contém tudo)
    const rows = [...main.querySelectorAll('div[role="row"]')];
    if (rows.length > 0) {
      rows.forEach((row) => {
        // ignora linhas de sistema (divisores de data, avisos de criptografia):
        // mensagens reais têm data-id ou conteúdo identificável
        const hasId = !!row.querySelector('[data-id]') || row.hasAttribute('data-id');
        const pre = row.querySelector('[data-pre-plain-text]');
        const meta = pre ? (pre.getAttribute('data-pre-plain-text') || '').trim() : '';
        // texto: tenta o span clássico; cai para o conteúdo do .copyable-text /
        // do próprio elemento com data-pre-plain-text (estrutura nova do WhatsApp)
        let text = '';
        const textEl = row.querySelector('span.selectable-text, .copyable-text span[dir], .copyable-text span');
        if (textEl) text = (textEl.innerText || '').trim();
        if (!text) {
          const cp = pre || row.querySelector('.copyable-text');
          if (cp) text = (cp.innerText || '').trim();
        }
        if (!text) text = mediaPlaceholder(row);
        text = text.replace(/\n?\b\d{1,2}:\d{2}\b\s*$/, '').trim();
        if (!hasId && !meta && !text) return;
        if (!text && !meta) return;
        msgs.push({ direction: rowDirection(row), meta, text: text || '[Mensagem sem texto]', bubble: row });
      });
      if (msgs.length > 0) return msgs;
    }

    // FALLBACKS (estruturas antigas do WhatsApp)
    const seen = new Set();
    const seenEls = new Set();

    main.querySelectorAll('[data-pre-plain-text]').forEach((el) => {
      const meta = (el.getAttribute('data-pre-plain-text') || '').trim();
      const textEl = el.querySelector('span.selectable-text') || el.querySelector('.copyable-text span') || el;
      let text = (textEl.innerText || '').trim();
      const bubble = findBubble(el);
      if (seenEls.has(bubble)) return;
      if (!text) text = mediaPlaceholder(bubble);
      if (!text && !meta) return;
      const key = meta + '|' + text.slice(0, 80);
      if (seen.has(key)) return;
      seen.add(key);
      seenEls.add(bubble);
      msgs.push({ direction: classifyDirection(el), meta, text: text || '[Mensagem sem texto]', bubble });
    });

    main.querySelectorAll('.message-in, .message-out').forEach((b) => {
      const bubble = findBubble(b);
      if (seenEls.has(bubble)) return;
      const copyable = b.querySelector('[data-pre-plain-text]');
      const meta = copyable ? (copyable.getAttribute('data-pre-plain-text') || '').trim() : '';
      const textEl = b.querySelector('span.selectable-text, .copyable-text span');
      let text = textEl ? (textEl.innerText || '').trim() : '';
      if (!text) text = mediaPlaceholder(bubble);
      if (!text && !meta) return;
      const key = meta + '|' + text.slice(0, 80);
      if (seen.has(key)) return;
      seen.add(key);
      seenEls.add(bubble);
      msgs.push({
        direction: b.classList.contains('message-out') ? 'out' : 'in',
        meta, text: text || '[Mensagem sem texto]', bubble
      });
    });

    // Estratégia 3: role="row"
    if (msgs.length === 0) {
      main.querySelectorAll('div[role="row"]').forEach((row) => {
        const idEl = row.querySelector('[data-id]') || row;
        const dataId = idEl.getAttribute && idEl.getAttribute('data-id');
        let text = (row.innerText || '').trim();
        if (!text) text = mediaPlaceholder(row);
        if (!text) return;
        text = text.replace(/\n\d{1,2}:\d{2}$/g, '').trim();
        if (!text) return;
        const key = (dataId || '') + '|' + text.slice(0, 80);
        if (seen.has(key)) return;
        seen.add(key);
        msgs.push({
          direction: dataId && dataId.startsWith('true_') ? 'out' : 'in',
          meta: '', text, bubble: row
        });
      });
    }

    return msgs;
  }

  // Resolve o container real da lista de mensagens.
  // O WhatsApp deixou de manter as mensagens dentro de #main em versões novas,
  // então escolhemos o candidato (#main, [role=application], [role=grid]) que
  // realmente contém linhas de mensagem; com fallback pelo ancestral comum.
  function getChatScope() {
    const cands = [];
    const main = document.querySelector('#main');
    if (main) cands.push(main);
    document.querySelectorAll('[role="application"], [role="grid"]').forEach((e) => cands.push(e));
    let best = null, bestScore = -1;
    cands.forEach((c) => {
      const score = c.querySelectorAll('[data-pre-plain-text], div[role="row"]').length;
      if (score > bestScore) { bestScore = score; best = c; }
    });
    if (!best || bestScore === 0) {
      const msg = document.querySelector('[data-pre-plain-text]');
      if (msg) {
        let node = msg;
        for (let i = 0; i < 14 && node.parentElement; i++) {
          node = node.parentElement;
          if (node.querySelectorAll('div[role="row"]').length >= 2) { best = node; break; }
        }
      }
    }
    return best || main || null;
  }

  // ===== Coleta com rolagem (contorna a virtualização do WhatsApp) =====
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findScroller(scope) {
    let node = scope;
    for (let i = 0; i < 12 && node; i++) {
      const st = getComputedStyle(node);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 20) return node;
      node = node.parentElement;
    }
    const cands = scope.querySelectorAll('*');
    for (const el of cands) {
      if (el.scrollHeight > el.clientHeight + 80) {
        const st = getComputedStyle(el);
        if (st.overflowY === 'auto' || st.overflowY === 'scroll') return el;
      }
    }
    return null;
  }

  function msgSig(m) {
    let id = '';
    try {
      const e = m.bubble && (m.bubble.matches && m.bubble.matches('[data-id]') ? m.bubble : m.bubble.querySelector('[data-id]'));
      id = e ? (e.getAttribute('data-id') || '') : '';
    } catch (_) {}
    return id || ((m.meta || '') + '|' + (m.text || '').slice(0, 60));
  }

  // Acumula mensagens rolando para cima até atingir o alvo (ou o topo).
  async function collectAccumulated(target, hasDate) {
    const map = new Map();
    function harvest() {
      const sc = getChatScope() || document.body;
      const msgs = collectRawMessages(sc);
      let lastTs = null;
      msgs.forEach((m) => {
        const dt = parseMsgDate(m.meta);
        if (dt) lastTs = dt;
        m._ts = dt || lastTs;
        const sig = msgSig(m);
        if (!map.has(sig)) map.set(sig, m);
        else { const ex = map.get(sig); if (!ex._ts && m._ts) ex._ts = m._ts; if (m.bubble && m.bubble.isConnected) ex.bubble = m.bubble; }
      });
    }
    harvest();
    const scroller = findScroller(getChatScope() || document.body);
    if (scroller) {
      let stagn = 0;
      for (let i = 0; i < 30; i++) {
        if (!hasDate && map.size >= target) break;
        const before = map.size;
        const prevTop = scroller.scrollTop;
        scroller.scrollTop = Math.max(0, prevTop - scroller.clientHeight * 1.4);
        await sleep(430);
        harvest();
        if (scroller.scrollTop <= 2 && prevTop <= 2) break; // chegou ao topo
        if (map.size === before) { if (++stagn >= 3) break; } else stagn = 0;
      }
      try { scroller.scrollTop = scroller.scrollHeight; } catch (_) {}
      await sleep(250);
      harvest(); // re-captura a janela final (mídia ao vivo nas mensagens recentes)
    }
    const arr = [...map.values()];
    arr.forEach((m, i) => { m._i = i; });
    arr.sort((a, b) => {
      const ta = a._ts ? a._ts.getTime() : 0;
      const tb = b._ts ? b._ts.getTime() : 0;
      if (ta !== tb) return ta - tb;
      return a._i - b._i;
    });
    return arr;
  }

  // ===== Execução =====
  try {
  const chatOpen = !!document.querySelector('#main') || !!document.querySelector('[data-pre-plain-text]');
  if (!chatOpen) return { error: 'NO_CHAT' };
  const scope = getChatScope() || document.body;

  const limit = window.__waPdLimit || 20;
  const dateStr = window.__waPdDate; // "yyyy-mm-dd" ou vazio

  // Coleta com rolagem automática (contorna a virtualização: o WhatsApp só
  // mantém ~25 mensagens renderizadas por vez).
  const all = await collectAccumulated(limit, !!dateStr);
  if (all.length === 0) {
    return {
      error: 'NO_MESSAGES',
      debug: {
        copyables: scope.querySelectorAll('[data-pre-plain-text]').length,
        bubbles: scope.querySelectorAll('.message-in, .message-out').length,
        rows: scope.querySelectorAll('div[role="row"]').length,
        dataIds: scope.querySelectorAll('[data-id]').length,
        docRows: document.querySelectorAll('div[role="row"]').length,
        docCopyables: document.querySelectorAll('[data-pre-plain-text]').length
      }
    };
  }

  // Filtro por data: considera mensagens até o FIM do dia escolhido,
  // contando da mais recente (<= data) para trás
  let pool = all;
  if (dateStr) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const cutoff = new Date(y, mo - 1, d, 23, 59, 59);
    let lastDate = null;
    pool = all.filter((m) => {
      const dt = parseMsgDate(m.meta);
      if (dt) lastDate = dt;
      // mensagens sem meta herdam a data da anterior (mídia, etc.)
      const effective = dt || lastDate;
      return effective ? effective <= cutoff : false;
    });
    if (pool.length === 0) {
      return { error: 'NO_MESSAGES_IN_DATE', chatName: getChatName() };
    }
  }

  const sliced = limit > 0 ? pool.slice(-limit) : pool;

  // Captura mídias dos balões selecionados
  const media = [];
  let mIdx = 0;

  // Resolve áudios e documentos: blobs do gancho são atribuídos em ordem
  const audioBlobQueue = globalAudioBlobs();
  const docBlobQueue = globalDocBlobs();

  for (const m of sliced) {
    const items = findMediaIn(m.bubble);
    for (const it of items) {
      mIdx++;

      // Mensagem de voz sem blob direto: tenta usar entrada do gancho/player
      if (it.kind === 'voice' && !it.url) {
        if (audioBlobQueue.length > 0) {
          const a = audioBlobQueue.shift();
          if (a.b64) { it.b64 = a.b64; it.srcMime = a.type; }
          else it.url = a.url;
          it.kind = 'audio';
        } else {
          media.push({
            id: mIdx, kind: 'audio', label: it.label,
            error: 'Dê play no áudio (alguns segundos bastam) e capture novamente'
          });
          continue;
        }
      }

      // Documento sem blob: tenta usar entrada do gancho
      if (it.kind === 'docpending' && !it.url) {
        if (docBlobQueue.length > 0) {
          const d = docBlobQueue.shift();
          it.b64 = d.b64;
          it.srcMime = d.type;
          it.kind = 'doc';
        } else {
          // pendente: registra mas já vincula à mensagem, pois o download
          // pode ser casado depois (pelo service worker)
          media.push({
            id: mIdx, kind: 'doc', label: it.label, filename: it.filename,
            error: 'Clique no documento e salve em uma pasta. Em seguida clique em "Escolher arquivos" para anexá-los ao CRM'
          });
          if (!m.mediaIds) m.mediaIds = [];
          m.mediaIds.push(mIdx);
          continue;
        }
      }

      try {
        const data = it.b64
          ? { base64: it.b64, size: Math.floor(it.b64.length * 0.75), mime: it.srcMime || 'application/octet-stream' }
          : await blobToBase64(it.url);
        if (data.tooBig) {
          media.push({ id: mIdx, kind: it.kind, label: it.label, error: 'Arquivo acima de 25 MB', size: data.size });
          continue;
        }
        const mime = it.srcMime || data.mime;
        const ext = extFromMime(mime, it.kind);
        const originalName = sanitizeFilename(it.filename);
        const filename = originalName
          ? (originalName.includes('.') ? originalName : `${originalName}.${ext}`)
          : `whatsapp_${it.kind}_${mIdx}.${ext}`;
        media.push({
          id: mIdx,
          kind: it.kind,
          label: it.label,
          filename,
          mime,
          size: data.size,
          base64: data.base64,
          fromMeta: m.meta || ''
        });
        if (!m.mediaIds) m.mediaIds = [];
        m.mediaIds.push(mIdx);
      } catch (e) {
        const hint = it.kind === 'image'
          ? 'Não consegui baixar esta imagem — clique nela no WhatsApp para abri-la e capture novamente'
          : 'Falha ao ler mídia (abra/reproduza a mídia e tente de novo)';
        media.push({ id: mIdx, kind: it.kind, label: it.label, error: hint });
      }
    }
  }

  return {
    chatName: getChatName(),
    chatPhone: getChatPhone(scope),
    audioDebug: {
      audioEls: document.querySelectorAll('audio').length,
      hookEntries: hookLogEntries().length
    },
    total: sliced.length,
    messages: sliced.map(({ direction, meta, text, mediaIds }) => ({ direction, meta, text, mediaIds: mediaIds || [] })),
    media
  };
  } catch (e) {
    return {
      error: 'EXCEPTION',
      message: String((e && e.message) || e),
      debug: {
        docRows: document.querySelectorAll('div[role="row"]').length,
        docCopyables: document.querySelectorAll('[data-pre-plain-text]').length
      }
    };
  }
})();
