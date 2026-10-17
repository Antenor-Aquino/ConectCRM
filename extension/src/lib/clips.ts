// Recortes de tela do popup (como no wa-pipedrive): o service worker captura a
// aba e grava aqui; o popup mostra, resume com IA e anexa ao cartão.
export interface Clip {
  id: string;
  /** PNG em base64 (sem prefixo). */
  base64: string;
  w: number;
  h: number;
  createdAt: number;
}

/** full = a página não deixa selecionar a área (ex.: Nova guia do Chrome): guardou a tela visível inteira. */
export type ClipResult = { ok: true; count: number; full?: boolean } | { ok: false; canceled?: boolean; error?: string };

export const CLIPS_KEY = "conectcrm-clips";
export const CLIP_LAST_KEY = "conectcrm-clip-last";
const MAX_CLIPS = 40;

export async function loadClips(): Promise<Clip[]> {
  return ((await chrome.storage.local.get(CLIPS_KEY))[CLIPS_KEY] as Clip[] | undefined) ?? [];
}

export async function saveClips(clips: Clip[]): Promise<void> {
  await chrome.storage.local.set({ [CLIPS_KEY]: clips.slice(-MAX_CLIPS) });
}

export async function addClip(clip: Omit<Clip, "id" | "createdAt">): Promise<number> {
  const clips = [...(await loadClips()), { ...clip, id: `c${Date.now()}`, createdAt: Date.now() }];
  await saveClips(clips);
  return Math.min(clips.length, MAX_CLIPS);
}
