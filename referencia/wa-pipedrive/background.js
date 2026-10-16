// Service worker: monitora downloads concluídos e mantém um cache dos
// arquivos baixados recentemente (nome + conteúdo base64), para a extensão
// anexá-los ao Pipedrive. Isso resolve a captura de documentos (PDF etc.),
// que o WhatsApp não expõe via blob no DOM.

const recentDownloads = []; // { id, filename, mime, base64, ts }
const MAX = 15;

function basename(path) {
  if (!path) return '';
  return path.split(/[\\/]/).pop();
}

function guessMime(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    ogg: 'audio/ogg', mp3: 'audio/mpeg', mp4: 'video/mp4'
  };
  return map[ext] || 'application/octet-stream';
}

async function cacheDownload(item) {
  try {
    const name = basename(item.filename);
    if (!name) return;
    // só nos interessam tipos de documento/mídia
    if (!/\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip)$/i.test(name)) return;

    // lê o arquivo do disco via file:// (só tenta se o Chrome permitir acesso
    // a URLs de arquivo para esta extensão; evita poluir o log de erros quando
    // a permissão está desligada — o que é o padrão)
    let base64 = null;
    const canReadFile = await new Promise((res) => {
      try { chrome.extension.isAllowedFileSchemeAccess(res); }
      catch (_) { res(false); }
    });
    if (canReadFile) {
      try {
        const url = 'file://' + item.filename;
        const resp = await fetch(url);
        const blob = await resp.blob();
        if (blob.size <= 25 * 1024 * 1024) {
          base64 = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result).split(',')[1] || '');
            r.onerror = () => rej(new Error('read'));
            r.readAsDataURL(blob);
          });
        }
      } catch (_) { /* leitura falhou; guarda só o nome */ }
    }

    recentDownloads.unshift({
      id: item.id,
      filename: name,
      mime: item.mime || guessMime(name),
      base64,
      ts: Date.now()
    });
    if (recentDownloads.length > MAX) recentDownloads.length = MAX;
  } catch (_) {}
}

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    chrome.downloads.search({ id: delta.id }, (items) => {
      if (items && items[0]) cacheDownload(items[0]);
    });
  }
});

// O popup pede a lista de downloads recentes
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'getRecentDownloads') {
    sendResponse({ downloads: recentDownloads });
  } else if (msg && msg.type === 'clearDownloads') {
    recentDownloads.length = 0;
    sendResponse({ ok: true });
  } else if (msg && msg.type === 'clip-start') {
    startClip()
      .then((r) => { chrome.storage.local.set({ clipLast: r }); sendResponse(r); })
      .catch((e) => { const r = { ok: false, error: String((e && e.message) || e) }; chrome.storage.local.set({ clipLast: r }); sendResponse(r); });
    return true; // resposta assíncrona
  }
  return true;
});

// ===== Recorte de tela (qualquer página) =====
// Overlay injetado: mostra o screenshot congelado e deixa o usuário arrastar
// um retângulo. Retorna { x, y, w, h, dpr } em px de CSS (ou null se cancelar).
function clipOverlay(dataUrl) {
  return new Promise((resolve) => {
    const dpr = window.devicePixelRatio || 1;
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;overflow:hidden;';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.cssText = 'position:absolute;inset:0;width:100vw;height:100vh;-webkit-user-drag:none;user-select:none;';
    const sel = document.createElement('div');
    sel.style.cssText = 'position:absolute;border:2px solid #0f88f4;background:rgba(15,136,244,.10);box-shadow:0 0 0 99999px rgba(0,19,34,.50);display:none;pointer-events:none;';
    const dim = document.createElement('div');
    dim.style.cssText = 'position:absolute;inset:0;background:rgba(0,19,34,.50);';
    const hint = document.createElement('div');
    hint.textContent = 'Arraste para recortar  ·  ESC para cancelar';
    hint.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);background:#001322;color:#fff;padding:7px 14px;border-radius:9px;font:600 13px -apple-system,Segoe UI,Roboto,sans-serif;z-index:2;box-shadow:0 4px 14px rgba(0,0,0,.3);';
    ov.appendChild(img); ov.appendChild(dim); ov.appendChild(sel); ov.appendChild(hint);
    (document.documentElement || document.body).appendChild(ov);

    let sx = 0, sy = 0, drawing = false;
    function cleanup() { ov.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(null); } }
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => {
      drawing = true; sx = e.clientX; sy = e.clientY;
      dim.style.display = 'none'; sel.style.display = 'block';
      sel.style.left = sx + 'px'; sel.style.top = sy + 'px'; sel.style.width = '0px'; sel.style.height = '0px';
    });
    ov.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      sel.style.left = x + 'px'; sel.style.top = y + 'px';
      sel.style.width = Math.abs(e.clientX - sx) + 'px'; sel.style.height = Math.abs(e.clientY - sy) + 'px';
    });
    ov.addEventListener('mouseup', (e) => {
      if (!drawing) return; drawing = false;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      cleanup();
      if (w < 5 || h < 5) { resolve(null); return; }
      resolve({ x, y, w, h, dpr });
    });
  });
}

async function blobToB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
  return btoa(bin);
}

async function cropDataUrl(dataUrl, sel) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const sx = Math.max(0, Math.round(sel.x * sel.dpr));
  const sy = Math.max(0, Math.round(sel.y * sel.dpr));
  const sw = Math.round(sel.w * sel.dpr);
  const sh = Math.round(sel.h * sel.dpr);
  const oc = new OffscreenCanvas(sw, sh);
  const ctx = oc.getContext('2d');
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  const outBlob = await oc.convertToBlob({ type: 'image/png' });
  return await blobToB64(outBlob);
}

async function startClip() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return { ok: false, error: 'Nenhuma aba ativa.' };
  if (/^(chrome|edge|about|chrome-extension):/i.test(tab.url || '')) {
    return { ok: false, error: 'Não é possível recortar páginas internas do navegador. Abra um site comum (ex.: WhatsApp Web).' };
  }
  // 1) captura ANTES do overlay (pra não capturar o escurecimento)
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (e) {
    return { ok: false, error: 'Falha ao capturar a tela: ' + ((e && e.message) || e) };
  }
  // 2) overlay de seleção
  let sel;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: clipOverlay, args: [dataUrl] });
    sel = res && res.result;
  } catch (e) {
    return { ok: false, error: 'Não foi possível abrir o seletor nesta página.' };
  }
  if (!sel) return { ok: false, canceled: true };
  // 3) recorta e guarda no tray
  const base64 = await cropDataUrl(dataUrl, sel);
  const data = await chrome.storage.local.get('clips');
  const clips = data.clips || [];
  clips.push({ id: 'c' + Date.now(), base64, w: Math.round(sel.w), h: Math.round(sel.h), createdAt: Date.now() });
  if (clips.length > 40) clips.splice(0, clips.length - 40);
  await chrome.storage.local.set({ clips });
  return { ok: true, count: clips.length };
}
