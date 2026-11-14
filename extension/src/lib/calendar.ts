// Agenda (portado do wa-pipedrive): Google Agenda via chrome.identity e
// Outlook via Microsoft Graph (OAuth com PKCE). Horários livres e criação
// do evento com convidados e link do Meet/Teams.
//
// Configuração necessária para a NOVA extensão (o ID muda em relação ao
// wa-pipedrive):
// - Google: criar no Google Cloud um OAuth Client do tipo "Extensão do
//   Chrome" com o ID desta extensão e colar o client_id no manifest.json.
// - Microsoft: no app do Entra (mesmo client id do wa-pipedrive), adicionar
//   o redirect https://<id-da-extensão>.chromiumapp.org/microsoft.

import { translateError } from "./errors";

export type CalendarProvider = "google" | "microsoft";

export const MICROSOFT_CLIENT_ID = "a1831519-7677-413a-be79-726b20328d12";
// Mail.Send: lembretes por e-mail (Configurações → Notificações).
const MICROSOFT_SCOPES = "openid profile email offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite Mail.Send";
const MICROSOFT_REDIRECT_PATH = "microsoft";
const MS_KEY = "conectcrm-ms-token";

export const PROVIDER_LABEL: Record<CalendarProvider, string> = { google: "Google Agenda", microsoft: "Outlook" };

/** Grade de horários livres (30 em 30 min) dentro do dia, sem sobrepor compromissos. */
export function computeFreeSlots(dayStart: Date, dayEnd: Date, busy: { start: string; end: string }[], durationMin: number): Date[] {
  const step = 30 * 60_000;
  const dur = durationMin * 60_000;
  const ranges = busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const);
  const slots: Date[] = [];
  for (let t = dayStart.getTime(); t + dur <= dayEnd.getTime(); t += step) {
    if (!ranges.some(([bs, be]) => t < be && t + dur > bs)) slots.push(new Date(t));
  }
  return slots;
}

// ---------- Google ----------

export function googleClientConfigured(): boolean {
  const id = chrome.runtime.getManifest().oauth2?.client_id ?? "";
  return !!id && !id.startsWith("COLE_AQUI");
}

function googleToken(interactive: boolean, scopes?: string[]): Promise<string> {
  if (!googleClientConfigured()) {
    return Promise.reject(
      new Error(`Google Agenda ainda não configurado: crie no Google Cloud um OAuth Client do tipo "Extensão do Chrome" com o ID ${chrome.runtime.id} e informe o client_id no manifest.json.`),
    );
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, ...(scopes ? { scopes } : {}) }, (result) => {
      const token = typeof result === "string" ? result : (result as { token?: string } | undefined)?.token;
      if (chrome.runtime.lastError || !token) reject(new Error(translateError(chrome.runtime.lastError?.message ?? (scopes ? "Conecte a conta Google." : "Conecte o Google Agenda."))));
      else resolve(token);
    });
  });
}

/** Erro HTTP da agenda em português (as mensagens das APIs vêm em inglês). */
function calendarHttpError(service: string, status: number, raw: string | undefined): Error {
  if (status === 401) return new Error(`A conexão com o ${service} expirou. Conecte de novo.`);
  if (status === 403) return new Error(`Sem permissão no ${service}. Conecte de novo e autorize o acesso.`);
  if (status === 404) return new Error(`Evento ou agenda não encontrado no ${service}.`);
  if (status === 429) return new Error(`Muitas solicitações ao ${service}. Tente novamente em alguns minutos.`);
  if (status >= 500) return new Error(`O ${service} está indisponível no momento. Tente novamente.`);
  const pt = raw ? translateError(raw) : "";
  return new Error(pt && pt !== raw ? pt : `Erro do ${service} (HTTP ${status}). Tente novamente.`);
}

// ---------- Google: várias contas (login próprio por conta) ----------
// Cada conta Google entra pela janela de login do Google (launchWebAuthFlow),
// independente da conta do Chrome — assim dá para ter, por exemplo, a conta
// da Stepple e a da PowerCubus juntas. Precisa de um OAuth Client do tipo
// "Aplicativo da Web" com o redirect https://<id-da-extensão>.chromiumapp.org/google.
// O token vale 1 hora; depois é renovado em silêncio (prompt=none) e, se o
// Google pedir, abre a janela de login daquela conta.

export const GOOGLE_WEB_CLIENT_ID: string =
  (import.meta.env?.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined) || "COLE_AQUI_O_CLIENT_ID_WEB_DO_GOOGLE.apps.googleusercontent.com";
const G_ACCOUNTS_KEY = "conectcrm-google-accounts";
const G_SCOPES = "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly";

interface GoogleAccount {
  email: string;
  token: string | null;
  expiresAt: number;
}

/** Várias contas Google configuradas (Client ID "Aplicativo da Web"). */
export function googleMultiConfigured(): boolean {
  return !!GOOGLE_WEB_CLIENT_ID && !GOOGLE_WEB_CLIENT_ID.startsWith("COLE_AQUI");
}

/** Google Agenda disponível (várias contas ou a conta do Chrome). */
export function googleCalendarConfigured(): boolean {
  return googleMultiConfigured() || googleClientConfigured();
}

async function loadGoogleAccounts(): Promise<GoogleAccount[]> {
  return ((await chrome.storage.local.get(G_ACCOUNTS_KEY))[G_ACCOUNTS_KEY] as GoogleAccount[] | undefined) ?? [];
}
async function saveGoogleAccount(acc: GoogleAccount): Promise<void> {
  const list = (await loadGoogleAccounts()).filter((a) => a.email.toLowerCase() !== acc.email.toLowerCase());
  await chrome.storage.local.set({ [G_ACCOUNTS_KEY]: [...list, acc] });
}

/** Contas Google conectadas (e-mails). */
export async function listGoogleAccounts(): Promise<string[]> {
  return (await loadGoogleAccounts()).map((a) => a.email);
}

export async function removeGoogleAccount(email: string): Promise<void> {
  const list = await loadGoogleAccounts();
  await chrome.storage.local.set({ [G_ACCOUNTS_KEY]: list.filter((a) => a.email.toLowerCase() !== email.toLowerCase()) });
}

/** Lê o resultado do login (#access_token=…&expires_in=…&state=…). */
export function parseGoogleRedirect(url: string, state: string): { token: string; expiresIn: number } {
  const hash = new URLSearchParams(new URL(url).hash.replace(/^#/, ""));
  const err = hash.get("error") ?? new URL(url).searchParams.get("error");
  if (err) throw new Error(err === "access_denied" ? "Login do Google cancelado." : translateError(err));
  if (hash.get("state") !== state) throw new Error("Falha de segurança no login do Google.");
  const token = hash.get("access_token");
  if (!token) throw new Error("O Google não devolveu o acesso. Tente conectar de novo.");
  return { token, expiresIn: Number(hash.get("expires_in") ?? 3600) };
}

function googleAuthFlow(interactive: boolean, opts: { loginHint?: string; selectAccount?: boolean }): Promise<{ token: string; expiresIn: number }> {
  const state = randomString(24);
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: GOOGLE_WEB_CLIENT_ID,
      response_type: "token",
      redirect_uri: chrome.identity.getRedirectURL("google"),
      scope: G_SCOPES,
      include_granted_scopes: "true",
      state,
      prompt: interactive ? (opts.selectAccount ? "select_account consent" : "consent") : "none",
      ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
    });
  return new Promise((resolve, reject) =>
    chrome.identity.launchWebAuthFlow({ url, interactive }, (final) => {
      if (chrome.runtime.lastError || !final) return reject(new Error(translateError(chrome.runtime.lastError?.message ?? "Login do Google cancelado.")));
      try {
        resolve(parseGoogleRedirect(final, state));
      } catch (e) {
        reject(e);
      }
    }),
  );
}

/** Conecta mais uma conta Google (abre a escolha de conta). Devolve o e-mail. */
export async function addGoogleAccount(): Promise<string> {
  if (!googleMultiConfigured()) throw new Error("Várias contas Google ainda não configuradas (falta o Client ID do Google do tipo \"Aplicativo da Web\").");
  const { token, expiresIn } = await googleAuthFlow(true, { selectAccount: true });
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${token}` } });
  const email = ((await res.json().catch(() => ({}))) as { email?: string }).email;
  if (!email) throw new Error("Não foi possível saber qual conta Google foi conectada.");
  await saveGoogleAccount({ email, token, expiresAt: Date.now() + (expiresIn - 60) * 1000 });
  return email;
}

async function googleAccountToken(email: string, interactive: boolean): Promise<string> {
  const acc = (await loadGoogleAccounts()).find((a) => a.email.toLowerCase() === email.toLowerCase());
  if (!acc) throw new Error(`A conta ${email} não está mais conectada.`);
  if (acc.token && acc.expiresAt > Date.now()) return acc.token;
  let got: { token: string; expiresIn: number };
  try {
    got = await googleAuthFlow(false, { loginHint: email });
  } catch (e) {
    if (!interactive) throw new Error(`A conexão com ${email} expirou. Conecte de novo.`);
    got = await googleAuthFlow(true, { loginHint: email });
  }
  await saveGoogleAccount({ email, token: got.token, expiresAt: Date.now() + (got.expiresIn - 60) * 1000 });
  return got.token;
}

async function gFetch<T>(url: string, init: RequestInit = {}, account?: string | null): Promise<T> {
  if (account) {
    const go = (t: string) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
    let res = await go(await googleAccountToken(account, true));
    if (res.status === 401) {
      const list = await loadGoogleAccounts();
      const acc = list.find((a) => a.email === account);
      if (acc) await saveGoogleAccount({ ...acc, token: null, expiresAt: 0 });
      res = await go(await googleAccountToken(account, true));
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw calendarHttpError(`Google Agenda (${account})`, res.status, json.error?.message);
    return json;
  }
  let token = await googleToken(false);
  const go = (t: string) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  let res = await go(token);
  if (res.status === 401) {
    await new Promise<void>((r) => chrome.identity.removeCachedAuthToken({ token }, () => r()));
    token = await googleToken(true);
    res = await go(token);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw calendarHttpError("Google Agenda", res.status, json.error?.message);
  return json;
}

// ---------- Microsoft ----------

interface MsToken {
  access: string;
  refresh?: string;
  expiresAt: number;
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomString = (len: number) => b64url(crypto.getRandomValues(new Uint8Array(len))).slice(0, len);

async function msExchange(body: Record<string, string>): Promise<string> {
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  // 400 com invalid_grant = sessão expirada.
  if (!res.ok || !json.access_token) throw calendarHttpError("Outlook", res.status === 400 ? 401 : res.status, json.error);
  const tok: MsToken = { access: json.access_token, refresh: json.refresh_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
  await chrome.storage.local.set({ [MS_KEY]: tok });
  return tok.access;
}

async function microsoftToken(interactive: boolean): Promise<string> {
  const cached = (await chrome.storage.local.get(MS_KEY))[MS_KEY] as MsToken | undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.access;
  if (cached?.refresh) {
    try {
      return await msExchange({ client_id: MICROSOFT_CLIENT_ID, grant_type: "refresh_token", refresh_token: cached.refresh, scope: MICROSOFT_SCOPES });
    } catch {
      /* refaz o login */
    }
  }
  if (!interactive) throw new Error("Conecte o Outlook primeiro.");
  const redirectUri = chrome.identity.getRedirectURL(MICROSOFT_REDIRECT_PATH);
  const verifier = randomString(96);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = randomString(32);
  const authUrl =
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" +
    new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: MICROSOFT_SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });
  const final = new URL(
    await new Promise<string>((resolve, reject) =>
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) =>
        chrome.runtime.lastError || !url ? reject(new Error(translateError(chrome.runtime.lastError?.message ?? "Login cancelado."))) : resolve(url),
      ),
    ),
  );
  if (final.searchParams.get("state") !== state) throw new Error("Falha de segurança no login Microsoft.");
  const err = final.searchParams.get("error_description") ?? final.searchParams.get("error");
  if (err) throw new Error(translateError(err));
  const code = final.searchParams.get("code");
  if (!code) throw new Error("A Microsoft não retornou o código de autorização.");
  return msExchange({ client_id: MICROSOFT_CLIENT_ID, grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, scope: MICROSOFT_SCOPES });
}

async function mFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = await microsoftToken(false);
  const go = (t: string) => fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  let res = await go(token);
  if (res.status === 401) {
    token = await microsoftToken(true);
    res = await go(token);
  }
  if (res.status === 204) return {} as T;
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw calendarHttpError("Outlook", res.status, json.error?.message);
  return json;
}

// ---------- Envio de e-mail (lembretes) ----------

const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/userinfo.email"];

/** Conecta a conta que envia os e-mails e devolve o endereço dela. */
export async function connectMailSender(provider: CalendarProvider): Promise<string> {
  if (provider === "google") {
    const token = await googleToken(true, GMAIL_SCOPES);
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json().catch(() => ({}))) as { email?: string };
    if (!json.email) throw new Error("Não foi possível ler o e-mail da conta Google.");
    return json.email;
  }
  await microsoftToken(true);
  const me = await mFetch<{ mail?: string; userPrincipalName?: string }>("/me?$select=mail,userPrincipalName");
  return me.mail ?? me.userPrincipalName ?? "";
}

const b64utf8 = (s: string) => btoa(unescape(encodeURIComponent(s)));

/** Envia um e-mail HTML pela conta conectada (Gmail ou Outlook). `interactive` = pode abrir o login. */
export async function sendMail(provider: CalendarProvider, msg: { to: string; subject: string; html: string }, interactive = false): Promise<void> {
  if (provider === "google") {
    const raw = [
      `To: ${msg.to}`,
      `Subject: =?UTF-8?B?${b64utf8(msg.subject)}?=`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64utf8(msg.html),
    ].join("\r\n");
    let token = await googleToken(interactive, GMAIL_SCOPES);
    const go = (t: string) =>
      fetch("https://www.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: b64utf8(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") }),
      });
    let res = await go(token);
    if (res.status === 401) {
      await new Promise<void>((r) => chrome.identity.removeCachedAuthToken({ token }, () => r()));
      token = await googleToken(interactive, GMAIL_SCOPES);
      res = await go(token);
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw calendarHttpError("Gmail", res.status, json.error?.message);
    }
    return;
  }
  await mFetch("/me/sendMail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { subject: msg.subject, body: { contentType: "HTML", content: msg.html }, toRecipients: [{ emailAddress: { address: msg.to } }] },
      saveToSentItems: false,
    }),
  });
}

// ---------- API comum ----------

export async function connectCalendar(provider: CalendarProvider): Promise<string | null> {
  if (provider === "google" && googleMultiConfigured()) return addGoogleAccount();
  if (provider === "google") {
    await googleToken(true);
    return (await gFetch<{ email?: string }>("https://www.googleapis.com/oauth2/v2/userinfo").catch(() => ({ email: undefined }))).email ?? null;
  }
  await microsoftToken(true);
  return (await mFetch<{ mail?: string; userPrincipalName?: string }>("/me?$select=mail,userPrincipalName").catch(() => ({ mail: undefined, userPrincipalName: undefined }))).mail ?? null;
}

/** Conectado sem abrir janela de login? */
export async function calendarConnected(provider: CalendarProvider): Promise<boolean> {
  try {
    if (provider === "google" && googleMultiConfigured()) return (await loadGoogleAccounts()).length > 0;
    if (provider === "google") await googleToken(false);
    else await microsoftToken(false);
    return true;
  } catch {
    return false;
  }
}

export async function disconnectCalendar(provider: CalendarProvider): Promise<void> {
  if (provider === "microsoft") return chrome.storage.local.remove(MS_KEY);
  try {
    const token = await googleToken(false);
    await new Promise<void>((r) => chrome.identity.removeCachedAuthToken({ token }, () => r()));
  } catch {
    /* já desconectado */
  }
}

/** Compromissos ocupados no dia (8h–19h). */
export async function busyRanges(provider: CalendarProvider, day: Date, account?: string | null) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8);
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 19);
  if (provider === "microsoft") {
    const params = new URLSearchParams({ startDateTime: dayStart.toISOString(), endDateTime: dayEnd.toISOString(), $select: "start,end,showAs" });
    const view = await mFetch<{ value?: { showAs?: string; start?: { dateTime: string }; end?: { dateTime: string } }[] }>(`/me/calendar/calendarView?${params}`, {
      headers: { Prefer: 'outlook.timezone="UTC"' },
    });
    const busy = (view.value ?? [])
      .filter((e) => !["free", "workingElsewhere"].includes(e.showAs ?? ""))
      .flatMap((e) => (e.start && e.end ? [{ start: `${e.start.dateTime}Z`, end: `${e.end.dateTime}Z` }] : []));
    return { dayStart, dayEnd, busy };
  }
  const fb = await gFetch<{ calendars?: { primary?: { busy?: { start: string; end: string }[] } } }>(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(), items: [{ id: "primary" }] }),
    },
    account ?? (googleMultiConfigured() ? ((await loadGoogleAccounts())[0]?.email ?? null) : null),
  );
  return { dayStart, dayEnd, busy: fb.calendars?.primary?.busy ?? [] };
}

export interface NewEvent {
  title: string;
  description?: string | null;
  start: Date;
  end: Date;
  guests: string[];
  /** Criar link do Meet (Google) ou Teams (Outlook). */
  online: boolean;
  reminderMin: number | null;
  /** Google Agenda: lembretes por e-mail do próprio Google (minutos antes), que saem mesmo com o Chrome fechado. */
  emailReminders?: number[];
  /** Agenda escolhida (listCalendars); sem ela, a principal da conta. */
  calendarId?: string | null;
  /** Google com várias contas: a conta da agenda escolhida. */
  account?: string | null;
}

export interface CalendarInfo {
  id: string;
  name: string;
  primary: boolean;
  /** Google com várias contas: de qual conta é a agenda. */
  account?: string | null;
}

/**
 * Agendas em que a conta pode criar eventos (a principal, as próprias e as
 * compartilhadas com permissão de edição). A Agenda Unificada mostra estas
 * mesmas agendas, então o evento criado aparece lá.
 */
export async function listCalendars(provider: CalendarProvider): Promise<CalendarInfo[]> {
  if (provider === "microsoft") {
    const r = await mFetch<{ value?: { id: string; name: string; isDefaultCalendar?: boolean; canEdit?: boolean }[] }>(
      "/me/calendars?$select=id,name,isDefaultCalendar,canEdit&$top=100",
    );
    return (r.value ?? [])
      .filter((c) => c.canEdit !== false)
      .map((c) => ({ id: c.id, name: c.name, primary: !!c.isDefaultCalendar }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name, "pt-BR"));
  }
  type GList = { items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[] };
  const url = "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=250";
  const toInfo = (r: GList, account: string | null) =>
    (r.items ?? [])
      .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary, account }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name, "pt-BR"));
  if (googleMultiConfigured()) {
    const out: CalendarInfo[] = [];
    for (const email of await listGoogleAccounts()) out.push(...toInfo(await gFetch<GList>(url, {}, email), email));
    return out;
  }
  return toInfo(await gFetch<GList>(url), null);
}

export async function createCalendarEvent(provider: CalendarProvider, ev: NewEvent): Promise<{ id: string; link: string | null }> {
  if (provider === "microsoft") {
    const body: Record<string, unknown> = {
      subject: ev.title,
      body: { contentType: "Text", content: ev.description ?? "Reunião agendada pelo ConectCRM." },
      start: { dateTime: ev.start.toISOString().slice(0, 19), timeZone: "UTC" },
      end: { dateTime: ev.end.toISOString().slice(0, 19), timeZone: "UTC" },
      attendees: ev.guests.map((email) => ({ emailAddress: { address: email, name: email }, type: "required" })),
      responseRequested: true,
      isReminderOn: ev.reminderMin !== null,
      ...(ev.reminderMin !== null ? { reminderMinutesBeforeStart: ev.reminderMin } : {}),
      ...(ev.online ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
    };
    const path = ev.calendarId ? `/me/calendars/${encodeURIComponent(ev.calendarId)}/events` : "/me/calendar/events";
    const created = await mFetch<{ id: string; onlineMeeting?: { joinUrl?: string } }>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const link = created.onlineMeeting?.joinUrl ?? null;
    if (ev.online && !link) {
      await mFetch(`/me/events/${encodeURIComponent(created.id)}`, { method: "DELETE" }).catch(() => undefined);
      throw new Error("A conta Outlook não permitiu criar o link do Teams. O evento foi cancelado; tente sem o link ou reconecte a conta.");
    }
    return { id: created.id, link };
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const event: Record<string, unknown> = {
    summary: ev.title,
    description: ev.description ?? undefined,
    start: { dateTime: ev.start.toISOString(), timeZone: tz },
    end: { dateTime: ev.end.toISOString(), timeZone: tz },
    attendees: ev.guests.map((email) => ({ email })),
    reminders:
      ev.reminderMin === null
        ? { useDefault: false, overrides: (ev.emailReminders ?? []).slice(0, 5).map((minutes) => ({ method: "email", minutes })) }
        : { useDefault: false, overrides: [{ method: "popup", minutes: ev.reminderMin }, ...(ev.emailReminders ?? []).slice(0, 4).map((minutes) => ({ method: "email", minutes }))] },
  };
  if (ev.online) event.conferenceData = { createRequest: { requestId: `conectcrm-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  const params = new URLSearchParams({ sendUpdates: "all", ...(ev.online ? { conferenceDataVersion: "1" } : {}) });
  const created = await gFetch<{ id: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ev.calendarId || "primary")}/events?${params}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) },
    ev.account ?? (googleMultiConfigured() ? ((await loadGoogleAccounts())[0]?.email ?? null) : null),
  );
  return { id: created.id, link: created.hangoutLink ?? created.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null };
}
