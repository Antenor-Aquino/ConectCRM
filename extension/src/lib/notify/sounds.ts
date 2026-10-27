// Som das notificações do Chrome (spec 10). O Chrome não deixa a extensão
// escolher o som do aviso; então o aviso sai sem o som do sistema e a
// extensão toca o som escolhido no documento offscreen (o mesmo do banco).
// Os sons são sintetizados (Web Audio): nada de arquivo nem direito autoral.
// As preferências são deste computador (som e volume dependem da máquina).

export type SoundId = "sino" | "ding" | "marimba" | "campainha" | "suave" | "digital" | "pop" | "none";
export type SoundCategory = "reminder" | "overdue" | "digest";

export const SOUNDS: { id: SoundId; label: string }[] = [
  { id: "sino", label: "Sino" },
  { id: "ding", label: "Ding duplo" },
  { id: "marimba", label: "Marimba" },
  { id: "campainha", label: "Campainha" },
  { id: "suave", label: "Alerta suave" },
  { id: "digital", label: "Digital" },
  { id: "pop", label: "Pop" },
  { id: "none", label: "Sem som" },
];

export const SOUND_CATEGORY_LABEL: Record<SoundCategory, string> = {
  reminder: "Lembrete de atividade",
  overdue: "Atividade atrasada",
  digest: "Resumo do dia (e alertas financeiros)",
};

export interface SoundSettings {
  sound: SoundId;
  /** 0 a 100. */
  volume: number;
  /** Som diferente por tipo de aviso (vazio = o geral). */
  perCategory: Partial<Record<SoundCategory, SoundId>>;
  /** Toca de novo a cada 1 min (até 3 vezes) enquanto o aviso não for visto. */
  repeat: boolean;
  /** Sem som neste horário (o aviso aparece normalmente). */
  quiet: { enabled: boolean; from: string; to: string };
  /** Também mostrar o aviso numa janela do CRM (não depende das notificações do sistema). */
  window: boolean;
}

export const DEFAULT_SOUND: SoundSettings = {
  sound: "sino",
  volume: 70,
  perCategory: {},
  repeat: false,
  quiet: { enabled: false, from: "20:00", to: "07:00" },
  window: true,
};

export const SOUND_KEY = "conectcrm-sound";

export function soundWithDefaults(s: Partial<SoundSettings> | undefined): SoundSettings {
  return { ...DEFAULT_SOUND, ...s, perCategory: { ...s?.perCategory }, quiet: { ...DEFAULT_SOUND.quiet, ...s?.quiet } };
}

export async function loadSoundSettings(): Promise<SoundSettings> {
  return soundWithDefaults((await chrome.storage.local.get(SOUND_KEY))[SOUND_KEY] as Partial<SoundSettings> | undefined);
}

export async function saveSoundSettings(s: SoundSettings): Promise<void> {
  await chrome.storage.local.set({ [SOUND_KEY]: s });
}

/** "HH:MM" dentro do intervalo (que pode virar a meia-noite, ex.: 20:00–07:00). */
export function inQuietTime(q: SoundSettings["quiet"], now = new Date()): boolean {
  if (!q.enabled || q.from === q.to) return false;
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return q.from < q.to ? hm >= q.from && hm < q.to : hm >= q.from || hm < q.to;
}

/** Que som tocar para um aviso agora (null = nenhum). */
export function soundFor(s: SoundSettings, category: SoundCategory, now = new Date()): SoundId | null {
  const id = s.perCategory[category] ?? s.sound;
  if (id === "none" || s.volume <= 0 || inQuietTime(s.quiet, now)) return null;
  return id;
}

// ---------- Síntese ----------

interface Note {
  /** Hz */
  f: number;
  /** início (s) */
  t: number;
  /** duração (s) */
  d: number;
  type?: OscillatorType;
  /** volume relativo (0–1) */
  g?: number;
  /** parciais (múltiplos de f) para timbre de sino/marimba */
  partials?: [number, number][];
}

const PATTERNS: Record<Exclude<SoundId, "none">, Note[]> = {
  sino: [{ f: 880, t: 0, d: 1.6, partials: [[1, 1], [2.76, 0.35], [5.4, 0.15]] }],
  ding: [
    { f: 1046.5, t: 0, d: 0.5, partials: [[1, 1], [3, 0.2]] },
    { f: 1318.5, t: 0.22, d: 0.8, partials: [[1, 1], [3, 0.2]] },
  ],
  marimba: [
    { f: 523.25, t: 0, d: 0.35, partials: [[1, 1], [4, 0.25]] },
    { f: 659.25, t: 0.14, d: 0.35, partials: [[1, 1], [4, 0.25]] },
    { f: 783.99, t: 0.28, d: 0.6, partials: [[1, 1], [4, 0.25]] },
  ],
  campainha: Array.from({ length: 8 }, (_, i) => ({ f: i % 2 ? 1400 : 1700, t: i * 0.06, d: 0.07, type: "square" as OscillatorType, g: 0.35 })),
  suave: [
    { f: 392, t: 0, d: 0.9, type: "sine", g: 0.8 },
    { f: 587.33, t: 0.35, d: 1.1, type: "sine", g: 0.8 },
  ],
  digital: [
    { f: 1200, t: 0, d: 0.09, type: "square", g: 0.3 },
    { f: 1200, t: 0.14, d: 0.09, type: "square", g: 0.3 },
    { f: 1600, t: 0.28, d: 0.16, type: "square", g: 0.3 },
  ],
  pop: [{ f: 600, t: 0, d: 0.12, type: "sine", g: 1 }],
};

/** Toca o som (volume 0–100) e resolve quando termina. */
export async function playSound(ctx: AudioContext, id: SoundId, volume: number): Promise<void> {
  if (id === "none" || volume <= 0) return;
  if (ctx.state === "suspended") await ctx.resume();
  const master = ctx.createGain();
  // Curva perceptual: 50% soa como "metade".
  master.gain.value = Math.pow(Math.min(100, volume) / 100, 2) * 0.6;
  master.connect(ctx.destination);
  const now = ctx.currentTime + 0.02;
  let end = 0;
  for (const n of PATTERNS[id]) {
    for (const [mult, amp] of n.partials ?? [[1, 1]]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.f * mult;
      if (id === "pop") {
        osc.frequency.setValueAtTime(n.f, now + n.t);
        osc.frequency.exponentialRampToValueAtTime(220, now + n.t + n.d);
      }
      const peak = (n.g ?? 1) * amp;
      g.gain.setValueAtTime(0.0001, now + n.t);
      g.gain.exponentialRampToValueAtTime(peak, now + n.t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
      osc.connect(g).connect(master);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.05);
    }
    end = Math.max(end, n.t + n.d);
  }
  await new Promise((r) => setTimeout(r, (end + 0.1) * 1000));
  master.disconnect();
}

/** Mensagem do service worker para o offscreen tocar um som. */
export interface PlaySoundMessage {
  target: "offscreen";
  kind: "play-sound";
  sound: SoundId;
  volume: number;
}
