// Preferências de notificação (spec 10). Ficam neste computador
// (chrome.storage.local): a chave do WhatsApp e o login do e-mail não vão
// para o backup. Cada usuário tem as suas; quem envia os e-mails é a conta
// Google/Microsoft conectada neste computador.

export type Channel = "chrome" | "email" | "whatsapp";
export const CHANNELS: Channel[] = ["chrome", "email", "whatsapp"];
/** E-mail suspenso por enquanto (decisão de 19/10/2026): o código fica, a tela e o envio não usam. */
export const EMAIL_CHANNEL_ENABLED = false;
/** Canais oferecidos nas telas. */
export const ACTIVE_CHANNELS: Channel[] = CHANNELS.filter((c) => c !== "email" || EMAIL_CHANNEL_ENABLED);
export const CHANNEL_LABEL: Record<Channel, string> = { chrome: "Chrome", email: "E-mail", whatsapp: "WhatsApp" };

/** "zapi" = um número da Z-API cadastrado em Configurações → WhatsApp (`senderId`). */
export type WhatsAppVia = "web" | "callmebot" | "zapi";

export interface ReminderRule {
  minutesBefore: number;
  channels: Channel[];
}

export interface NotifySettings {
  chrome: boolean;
  email: { enabled: boolean; to: string };
  /** `via`: WhatsApp Web aberto neste Chrome (padrão) ou CallMeBot. `phone` = quem recebe. */
  whatsapp: { enabled: boolean; via: WhatsAppVia; phone: string; apikey: string; senderId?: string };
  /** Lembretes que vêm preenchidos em toda atividade nova. */
  defaults: ReminderRule[];
  /** "Sua agenda de hoje" no horário escolhido. */
  digest: { enabled: boolean; time: string; channels: Channel[] };
  /** Aviso quando uma atividade fica atrasada. */
  overdue: { enabled: boolean; channels: Channel[] };
  /** Chrome e WhatsApp esperam o fim do período (o e-mail sai normalmente). */
  quiet: { enabled: boolean; from: string; to: string };
  /** Eventos do Google Agenda criados pelo CRM levam o lembrete por e-mail do próprio Google. */
  calendarEmailBackup: boolean;
}

export const DEFAULT_NOTIFY: NotifySettings = {
  chrome: true,
  email: { enabled: false, to: "" },
  whatsapp: { enabled: false, via: "web", phone: "", apikey: "" },
  defaults: [{ minutesBefore: 15, channels: ["chrome"] }],
  digest: { enabled: false, time: "07:30", channels: ["chrome"] },
  overdue: { enabled: false, channels: ["chrome"] },
  quiet: { enabled: false, from: "20:00", to: "07:00" },
  calendarEmailBackup: true,
};

/** Completa preferências salvas por versões anteriores. */
export function withDefaults(s: Partial<NotifySettings> | undefined): NotifySettings {
  return {
    ...DEFAULT_NOTIFY,
    ...s,
    email: { ...DEFAULT_NOTIFY.email, ...s?.email },
    // Quem configurou na 0.2.39 (só havia CallMeBot) continua no CallMeBot.
    whatsapp: { ...DEFAULT_NOTIFY.whatsapp, ...(s?.whatsapp?.apikey && !s.whatsapp.via ? { via: "callmebot" as const } : {}), ...s?.whatsapp },
    digest: { ...DEFAULT_NOTIFY.digest, ...s?.digest },
    overdue: { ...DEFAULT_NOTIFY.overdue, ...s?.overdue },
    quiet: { ...DEFAULT_NOTIFY.quiet, ...s?.quiet },
    defaults: s?.defaults ?? DEFAULT_NOTIFY.defaults,
  };
}

/** Preferências como valem hoje: com o e-mail suspenso, ele fica desligado. */
export function activeSettings(s: NotifySettings): NotifySettings {
  return EMAIL_CHANNEL_ENABLED ? s : { ...s, email: { ...s.email, enabled: false }, calendarEmailBackup: false };
}

/** Canal ligado e configurado para o usuário. */
export function channelReady(s: NotifySettings, c: Channel): boolean {
  if (c === "chrome") return s.chrome;
  if (c === "email") return s.email.enabled && !!s.email.to.trim();
  const via = s.whatsapp.via;
  return s.whatsapp.enabled && !!s.whatsapp.phone.trim() && (via === "web" || (via === "zapi" ? !!s.whatsapp.senderId : !!s.whatsapp.apikey.trim()));
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Dentro do horário de silêncio (que pode passar da meia-noite: 20:00–07:00)? */
export function inQuietHours(s: NotifySettings, now: Date): boolean {
  if (!s.quiet.enabled) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  const from = minutesOf(s.quiet.from);
  const to = minutesOf(s.quiet.to);
  return from <= to ? t >= from && t < to : t >= from || t < to;
}

/** "15 min antes", "1 h antes", "1 dia antes", "na hora". */
export function leadLabel(min: number): string {
  if (min === 0) return "na hora";
  if (min % 1440 === 0) return `${min / 1440} dia${min === 1440 ? "" : "s"} antes`;
  if (min % 60 === 0) return `${min / 60} h antes`;
  return `${min} min antes`;
}

// ---------- chrome.storage ----------

const KEY = "conectcrm-notify-settings";
const SENDER_KEY = "conectcrm-mail-sender";

export async function loadAllNotifySettings(): Promise<Record<string, NotifySettings>> {
  const raw = ((await chrome.storage.local.get(KEY))[KEY] as Record<string, Partial<NotifySettings>> | undefined) ?? {};
  return Object.fromEntries(Object.entries(raw).map(([id, s]) => [id, withDefaults(s)]));
}

export async function loadNotifySettings(userId: string): Promise<NotifySettings> {
  return (await loadAllNotifySettings())[userId] ?? withDefaults(undefined);
}

export async function saveNotifySettings(userId: string, s: NotifySettings): Promise<void> {
  const raw = ((await chrome.storage.local.get(KEY))[KEY] as Record<string, NotifySettings> | undefined) ?? {};
  await chrome.storage.local.set({ [KEY]: { ...raw, [userId]: s } });
}

/** Conta que envia os e-mails (deste computador). */
export interface MailSender {
  provider: "google" | "microsoft";
  address: string;
}

export async function loadMailSender(): Promise<MailSender | null> {
  return ((await chrome.storage.local.get(SENDER_KEY))[SENDER_KEY] as MailSender | undefined) ?? null;
}

export async function saveMailSender(s: MailSender | null): Promise<void> {
  if (s) await chrome.storage.local.set({ [SENDER_KEY]: s });
  else await chrome.storage.local.remove(SENDER_KEY);
}
