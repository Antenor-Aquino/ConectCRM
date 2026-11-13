// Calendly (spec 18): contas conectadas por token pessoal (fica só neste
// computador), links de agendamento (tipos de evento) e leitura dos
// agendamentos para o CRM (sem webhook: o service worker consulta a cada 5 min).
import type { CalendlyBooking } from "../db/calendly";

export const CALENDLY_ORIGIN = "https://api.calendly.com/*";
const API = "https://api.calendly.com";
const KEY = "conectcrm-calendly";
const SEEN_KEY = "conectcrm-calendly-seen";

export interface CalendlyEventType {
  uri: string;
  name: string;
  url: string;
  duration: number;
}

export interface CalendlyAccount {
  token: string;
  email: string;
  name: string;
  userUri: string;
  eventTypes: CalendlyEventType[];
  /** Link padrão desta conta (tipo de evento). */
  eventTypeUri: string | null;
}

export interface CalendlySettings {
  accounts: CalendlyAccount[];
  /** Funil → e-mail da conta cujo link vai nos cartões dele. */
  pipelineAccount: Record<string, string>;
  lastSyncAt: string | null;
  lastError: string | null;
}

const DEFAULTS: CalendlySettings = { accounts: [], pipelineAccount: {}, lastSyncAt: null, lastError: null };

export async function loadCalendly(): Promise<CalendlySettings> {
  return { ...DEFAULTS, ...((await chrome.storage.local.get(KEY))[KEY] as Partial<CalendlySettings> | undefined) };
}

export async function saveCalendly(s: CalendlySettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export async function requestCalendlyPermission(): Promise<boolean> {
  if (!chrome.permissions?.request) return true;
  if (await chrome.permissions.contains({ origins: [CALENDLY_ORIGIN] })) return true;
  return chrome.permissions.request({ origins: [CALENDLY_ORIGIN] });
}

async function api<T>(token: string, pathOrUrl: string): Promise<T> {
  const res = await fetch(pathOrUrl.startsWith("http") ? pathOrUrl : `${API}${pathOrUrl}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string; title?: string };
  if (res.status === 401) throw new Error("Token do Calendly inválido ou revogado. Gere outro em Integrações → API e webhooks.");
  if (res.status === 403) throw new Error("O Calendly recusou o acesso deste token.");
  if (res.status === 429) throw new Error("Muitas consultas ao Calendly. Tente de novo em alguns minutos.");
  if (!res.ok) throw new Error(`Erro do Calendly (HTTP ${res.status})${json.message ? `: ${json.message}` : ""}.`);
  return json;
}

/** Valida o token e busca a conta e os links de agendamento. */
export async function connectCalendly(token: string): Promise<CalendlyAccount> {
  const t = token.trim();
  if (!t) throw new Error("Cole o token pessoal do Calendly.");
  const me = await api<{ resource: { uri: string; name: string; email: string } }>(t, "/users/me");
  const types = await api<{ collection: { uri: string; name: string; scheduling_url: string; duration: number; active: boolean }[] }>(
    t,
    `/event_types?${new URLSearchParams({ user: me.resource.uri, active: "true", count: "100" })}`,
  );
  const eventTypes = types.collection.filter((e) => e.active !== false).map((e) => ({ uri: e.uri, name: e.name, url: e.scheduling_url, duration: e.duration }));
  return { token: t, email: me.resource.email, name: me.resource.name, userUri: me.resource.uri, eventTypes, eventTypeUri: eventTypes[0]?.uri ?? null };
}

/** Atualiza os links (tipos de evento) de uma conta já conectada. */
export async function refreshCalendlyAccount(acc: CalendlyAccount): Promise<CalendlyAccount> {
  const fresh = await connectCalendly(acc.token);
  return { ...fresh, eventTypeUri: fresh.eventTypes.some((e) => e.uri === acc.eventTypeUri) ? acc.eventTypeUri : fresh.eventTypeUri };
}

/** Conta do link para um funil: a escolhida para ele; senão a primeira. */
export function accountForPipeline(s: CalendlySettings, pipelineId: string | null | undefined): CalendlyAccount | null {
  const email = pipelineId ? s.pipelineAccount[pipelineId] : undefined;
  return s.accounts.find((a) => a.email === email) ?? s.accounts[0] ?? null;
}

/** Link de agendamento já preenchido com o contato e a marca do cartão. */
export function bookingLink(url: string, opts: { name?: string | null; email?: string | null; dealId?: string | null; activityId?: string | null }): string {
  const u = new URL(url);
  if (opts.name) u.searchParams.set("name", opts.name);
  if (opts.email) u.searchParams.set("email", opts.email);
  if (opts.dealId || opts.activityId) u.searchParams.set("utm_source", "conectcrm");
  if (opts.dealId) u.searchParams.set("utm_content", opts.dealId);
  // Atividade criada no CRM: o horário marcado volta para ela (sem duplicar).
  if (opts.activityId) u.searchParams.set("utm_term", opts.activityId);
  return u.toString();
}

// ---------- Leitura dos agendamentos ----------

interface ApiEvent {
  uri: string;
  name: string;
  status: "active" | "canceled";
  start_time: string;
  end_time: string;
  updated_at: string;
  location?: { join_url?: string; location?: string } | null;
}
interface ApiInvitee {
  name: string;
  email: string;
  status: string;
  rescheduled?: boolean;
  text_reminder_number?: string | null;
  questions_and_answers?: { question: string; answer: string }[];
  tracking?: { utm_source?: string | null; utm_content?: string | null; utm_term?: string | null } | null;
  cancellation?: { reason?: string | null } | null;
}

const PHONE_Q = /telefone|whats|celular|fone|phone/i;

/** Agendamento do Calendly no formato que o banco importa. */
export function toBooking(account: string, ev: ApiEvent, inv: ApiInvitee): CalendlyBooking {
  const answers = (inv.questions_and_answers ?? []).map((q) => ({ q: q.question, a: q.answer }));
  const phone = inv.text_reminder_number || answers.find((x) => PHONE_Q.test(x.q) && x.a)?.a || null;
  return {
    eventUri: ev.uri,
    status: ev.status === "canceled" ? "canceled" : "active",
    eventName: ev.name,
    start: ev.start_time,
    end: ev.end_time,
    joinUrl: ev.location?.join_url ?? null,
    account,
    invitee: {
      name: inv.name,
      email: inv.email,
      phone,
      dealId: inv.tracking?.utm_source === "conectcrm" ? (inv.tracking.utm_content ?? null) : null,
      activityId: inv.tracking?.utm_source === "conectcrm" ? (inv.tracking.utm_term ?? null) : null,
      answers,
      rescheduled: !!inv.rescheduled,
      cancelReason: inv.cancellation?.reason ?? null,
    },
  };
}

/**
 * Agendamentos novos ou alterados das contas (de 2 dias atrás em diante).
 * Só busca os convidados dos eventos que mudaram desde a última leitura.
 */
export async function fetchCalendlyBookings(s: CalendlySettings): Promise<{ bookings: CalendlyBooking[]; seen: Record<string, string> }> {
  const seen = ((await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY] as Record<string, string> | undefined) ?? {};
  const bookings: CalendlyBooking[] = [];
  const min = new Date(Date.now() - 2 * 86_400_000).toISOString();
  for (const acc of s.accounts) {
    if (!acc.token) continue; // configurações importadas sem as credenciais
    let next: string | null = `/scheduled_events?${new URLSearchParams({ user: acc.userUri, min_start_time: min, count: "100", sort: "start_time:asc" })}`;
    for (let page = 0; next && page < 10; page++) {
      const r: { collection: ApiEvent[]; pagination?: { next_page?: string | null } } = await api(acc.token, next);
      for (const ev of r.collection) {
        if (seen[ev.uri] === ev.updated_at) continue;
        const inv = await api<{ collection: ApiInvitee[] }>(acc.token, `${ev.uri}/invitees?count=10`);
        for (const i of inv.collection) bookings.push(toBooking(acc.email, ev, i));
        seen[ev.uri] = ev.updated_at;
      }
      next = r.pagination?.next_page ?? null;
    }
  }
  return { bookings, seen };
}

/** Grava o que já foi lido (depois de importar com sucesso). */
export async function markCalendlySeen(seen: Record<string, string>): Promise<void> {
  // Não cresce para sempre: guarda os 2000 mais recentes.
  const entries = Object.entries(seen).slice(-2000);
  await chrome.storage.local.set({ [SEEN_KEY]: Object.fromEntries(entries) });
}
