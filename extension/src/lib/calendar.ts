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

export type CalendarProvider = "google" | "microsoft";

export const MICROSOFT_CLIENT_ID = "a1831519-7677-413a-be79-726b20328d12";
const MICROSOFT_SCOPES = "openid profile email offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite";
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

function googleClientConfigured(): boolean {
  const id = chrome.runtime.getManifest().oauth2?.client_id ?? "";
  return !!id && !id.startsWith("COLE_AQUI");
}

function googleToken(interactive: boolean): Promise<string> {
  if (!googleClientConfigured()) {
    return Promise.reject(
      new Error(`Google Agenda ainda não configurado: crie no Google Cloud um OAuth Client do tipo "Extensão do Chrome" com o ID ${chrome.runtime.id} e informe o client_id no manifest.json.`),
    );
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (result) => {
      const token = typeof result === "string" ? result : (result as { token?: string } | undefined)?.token;
      if (chrome.runtime.lastError || !token) reject(new Error(chrome.runtime.lastError?.message ?? "Conecte o Google Agenda."));
      else resolve(token);
    });
  });
}

async function gFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  let token = await googleToken(false);
  const go = (t: string) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  let res = await go(token);
  if (res.status === 401) {
    await new Promise<void>((r) => chrome.identity.removeCachedAuthToken({ token }, () => r()));
    token = await googleToken(true);
    res = await go(token);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Erro HTTP ${res.status}`);
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
  if (!res.ok || !json.access_token) throw new Error(json.error_description ?? json.error ?? `Erro HTTP ${res.status}`);
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
        chrome.runtime.lastError || !url ? reject(new Error(chrome.runtime.lastError?.message ?? "Login cancelado.")) : resolve(url),
      ),
    ),
  );
  if (final.searchParams.get("state") !== state) throw new Error("Falha de segurança no login Microsoft.");
  const err = final.searchParams.get("error_description") ?? final.searchParams.get("error");
  if (err) throw new Error(err);
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
  if (!res.ok) throw new Error(json.error?.message ?? `Erro HTTP ${res.status}`);
  return json;
}

// ---------- API comum ----------

export async function connectCalendar(provider: CalendarProvider): Promise<string | null> {
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
export async function busyRanges(provider: CalendarProvider, day: Date) {
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
  const fb = await gFetch<{ calendars?: { primary?: { busy?: { start: string; end: string }[] } } }>("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(), items: [{ id: "primary" }] }),
  });
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
    const created = await mFetch<{ id: string; onlineMeeting?: { joinUrl?: string } }>("/me/calendar/events", {
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
        ? { useDefault: false, overrides: [] }
        : { useDefault: false, overrides: [{ method: "popup", minutes: ev.reminderMin }] },
  };
  if (ev.online) event.conferenceData = { createRequest: { requestId: `conectcrm-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  const params = new URLSearchParams({ sendUpdates: "all", ...(ev.online ? { conferenceDataVersion: "1" } : {}) });
  const created = await gFetch<{ id: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) },
  );
  return { id: created.id, link: created.hangoutLink ?? created.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null };
}
