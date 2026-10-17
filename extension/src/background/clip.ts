// Recorte de tela (portado do background.js do wa-pipedrive): captura a aba
// ativa, injeta um seletor de retângulo e guarda o recorte para o popup.
import { addClip, CLIP_LAST_KEY, type ClipResult } from "../lib/clips";
import { errorText } from "../lib/errors";

export interface ClipStartMessage {
  target: "background";
  kind: "clip-start";
}

/** Roda dentro da página: mostra o print congelado e devolve o retângulo (px CSS). */
function clipOverlay(dataUrl: string): Promise<{ x: number; y: number; w: number; h: number; dpr: number } | null> {
  return new Promise((resolve) => {
    const dpr = window.devicePixelRatio || 1;
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;overflow:hidden;";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.style.cssText = "position:absolute;inset:0;width:100vw;height:100vh;-webkit-user-drag:none;user-select:none;";
    const sel = document.createElement("div");
    sel.style.cssText = "position:absolute;border:2px solid #465fff;background:rgba(70,95,255,.10);box-shadow:0 0 0 99999px rgba(16,24,40,.50);display:none;pointer-events:none;";
    const dim = document.createElement("div");
    dim.style.cssText = "position:absolute;inset:0;background:rgba(16,24,40,.50);";
    const hint = document.createElement("div");
    hint.textContent = "Arraste para recortar  ·  ESC para cancelar";
    hint.style.cssText = "position:absolute;top:14px;left:50%;transform:translateX(-50%);background:#101828;color:#fff;padding:7px 14px;border-radius:9px;font:600 13px Inter,-apple-system,Segoe UI,Roboto,sans-serif;z-index:2;box-shadow:0 4px 14px rgba(0,0,0,.3);";
    ov.append(img, dim, sel, hint);
    (document.documentElement || document.body).appendChild(ov);

    let sx = 0;
    let sy = 0;
    let drawing = false;
    const cleanup = () => {
      ov.remove();
      document.removeEventListener("keydown", onKey, true);
    };
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cleanup();
      resolve(null);
    }
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("mousedown", (e) => {
      drawing = true;
      sx = e.clientX;
      sy = e.clientY;
      dim.style.display = "none";
      sel.style.display = "block";
      Object.assign(sel.style, { left: `${sx}px`, top: `${sy}px`, width: "0px", height: "0px" });
    });
    ov.addEventListener("mousemove", (e) => {
      if (!drawing) return;
      Object.assign(sel.style, {
        left: `${Math.min(sx, e.clientX)}px`,
        top: `${Math.min(sy, e.clientY)}px`,
        width: `${Math.abs(e.clientX - sx)}px`,
        height: `${Math.abs(e.clientY - sy)}px`,
      });
    });
    ov.addEventListener("mouseup", (e) => {
      if (!drawing) return;
      drawing = false;
      const w = Math.abs(e.clientX - sx);
      const h = Math.abs(e.clientY - sy);
      cleanup();
      resolve(w < 5 || h < 5 ? null : { x: Math.min(sx, e.clientX), y: Math.min(sy, e.clientY), w, h, dpr });
    });
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function crop(dataUrl: string, r: { x: number; y: number; w: number; h: number; dpr: number }): Promise<string> {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const sw = Math.round(r.w * r.dpr);
  const sh = Math.round(r.h * r.dpr);
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d")!.drawImage(bmp, Math.max(0, Math.round(r.x * r.dpr)), Math.max(0, Math.round(r.y * r.dpr)), sw, sh, 0, 0, sw, sh);
  return blobToBase64(await canvas.convertToBlob({ type: "image/png" }));
}

export async function startClip(): Promise<ClipResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: "Nenhuma aba ativa." };
  if (/^(chrome|edge|about|chrome-extension):/i.test(tab.url ?? "")) {
    return { ok: false, error: "Não é possível recortar páginas internas do navegador. Abra um site comum (ex.: WhatsApp Web)." };
  }
  let dataUrl: string;
  try {
    // Captura ANTES do seletor, para não pegar o escurecimento.
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch (e) {
    return { ok: false, error: `Falha ao capturar a tela: ${errorText(e)}` };
  }
  let rect: Awaited<ReturnType<typeof clipOverlay>>;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: clipOverlay, args: [dataUrl] });
    rect = (res?.result as typeof rect) ?? null;
  } catch {
    return { ok: false, error: "Não foi possível abrir o seletor nesta página." };
  }
  if (!rect) return { ok: false, canceled: true };
  const count = await addClip({ base64: await crop(dataUrl, rect), w: Math.round(rect.w), h: Math.round(rect.h) });
  return { ok: true, count };
}

/** O popup fecha ao clicar na página; o resultado fica guardado para quando reabrir. */
export async function runClip(): Promise<ClipResult> {
  let r: ClipResult;
  try {
    r = await startClip();
  } catch (e) {
    r = { ok: false, error: errorText(e) };
  }
  await chrome.storage.local.set({ [CLIP_LAST_KEY]: r });
  return r;
}
