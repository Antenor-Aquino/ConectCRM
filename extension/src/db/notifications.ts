// Notificações das atividades (spec 10): lembretes com antecedência e canais
// escolhidos, aviso único do que se perdeu com o Chrome fechado, resumo
// diário e aviso de atrasadas. Aqui se decide O QUE avisar (uma vez por aviso
// e canal, com novas tentativas em caso de falha); o envio é do service worker.
import { formatDate } from "../lib/format";
import { channelReady, inQuietHours, leadLabel, withDefaults, type Channel, type NotifySettings, type ReminderRule } from "../lib/notify/settings";
import { startOfDay } from "../lib/taskTiming";
import { ValidationError } from "../lib/validate";
import { insertRow, softDelete, type DbContext } from "./repo";
import { many, one, run, withTransaction, type DatabaseSync } from "./sql";

// ---------- Lembretes da atividade ----------

/** Bancos de antes da migration 0014 só aparecem no meio de uma migração. */
const hasTable = new WeakMap<DatabaseSync, boolean>();
const remindersReady = (db: DatabaseSync) => {
  if (!hasTable.has(db)) hasTable.set(db, !!one(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'activity_reminder'"));
  return hasTable.get(db)!;
};

export function listActivityReminders(db: DatabaseSync, activityId: string): ReminderRule[] {
  if (!remindersReady(db)) return [];
  return many<{ minutes_before: number; channels: string }>(
    db,
    "SELECT minutes_before, channels FROM activity_reminder WHERE activity_id = ? AND deleted_at IS NULL ORDER BY minutes_before DESC",
    activityId,
  ).map((r) => ({ minutesBefore: r.minutes_before, channels: JSON.parse(r.channels) as Channel[] }));
}

/** Substitui os lembretes da atividade (repetidos são juntados; sem canal, sai). */
export function setActivityReminders(db: DatabaseSync, ctx: DbContext, activityId: string, rules: ReminderRule[]): void {
  if (!remindersReady(db)) return;
  const merged = new Map<number, Set<Channel>>();
  for (const r of rules) {
    const min = Math.round(Number(r.minutesBefore));
    if (!Number.isFinite(min) || min < 0 || min > 60 * 24 * 60) throw new ValidationError("Antecedência do lembrete inválida.");
    const ch = (r.channels ?? []).filter((c): c is Channel => c === "chrome" || c === "email" || c === "whatsapp");
    if (!ch.length) continue;
    const set = merged.get(min) ?? new Set<Channel>();
    ch.forEach((c) => set.add(c));
    merged.set(min, set);
  }
  withTransaction(db, () => {
    for (const r of many<{ id: string }>(db, "SELECT id FROM activity_reminder WHERE activity_id = ? AND deleted_at IS NULL", activityId))
      softDelete(db, ctx, "activity_reminder", r.id);
    for (const [min, ch] of merged) insertRow(db, ctx, "activity_reminder", { activity_id: activityId, minutes_before: min, channels: JSON.stringify([...ch]) });
  });
}

// ---------- O que avisar agora ----------

export type NotifyKind = "reminder" | "digest" | "overdue" | "missed";

export interface NotifyJob {
  key: string;
  channel: Channel;
  kind: NotifyKind;
  userId: string | null;
  activityId: string | null;
  title: string;
  /** Texto curto (Chrome e WhatsApp). */
  text: string;
  /** E-mail. */
  subject: string;
  html: string;
}

interface ActRow {
  id: string;
  title: string;
  due_at: string;
  end_at: string | null;
  owner_id: string | null;
  meeting_url: string | null;
  type_name: string;
  deal_title: string | null;
  person_name: string | null;
  person_phone: string | null;
  org_name: string | null;
}

const ACT_SQL = `SELECT a.id, a.title, a.due_at, a.end_at, a.owner_id, a.meeting_url, t.name AS type_name,
    d.title AS deal_title, pe.name AS person_name, pe.phone AS person_phone, o.name AS org_name
  FROM activity a JOIN activity_type t ON t.id = a.type_id
  LEFT JOIN deal d ON d.id = a.deal_id AND d.deleted_at IS NULL
  LEFT JOIN person pe ON pe.id = COALESCE(a.person_id, d.person_id) AND pe.deleted_at IS NULL
  LEFT JOIN organization o ON o.id = COALESCE(a.organization_id, d.organization_id) AND o.deleted_at IS NULL`;

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const when = (iso: string) => `${formatDate(iso)} às ${hhmm(new Date(iso))}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Linhas de detalhe da atividade (tipo, cartão, contato, organização, reunião). */
function details(a: ActRow): string[] {
  return [
    a.type_name,
    a.deal_title ? `Cartão: ${a.deal_title}` : "",
    a.person_name ? `Contato: ${a.person_name}${a.person_phone ? ` (${a.person_phone})` : ""}` : "",
    a.org_name ? `Organização: ${a.org_name}` : "",
    a.meeting_url ? `Reunião: ${a.meeting_url}` : "",
  ].filter(Boolean);
}

function emailHtml(heading: string, blocks: { title: string; lines: string[] }[]): string {
  const items = blocks
    .map(
      (b) =>
        `<div style="margin:0 0 14px;padding:12px 14px;border:1px solid #e4e7ec;border-radius:10px"><b>${esc(b.title)}</b>` +
        b.lines.map((l) => `<div style="color:#475467;font-size:13px">${esc(l)}</div>`).join("") +
        "</div>",
    )
    .join("");
  return `<div style="font-family:Arial,sans-serif;max-width:560px"><h2 style="color:#465fff;font-size:18px">${esc(heading)}</h2>${items}<p style="color:#98a2b3;font-size:12px">Enviado pelo ConectCRM.</p></div>`;
}

function reminderJob(a: ActRow, minutes: number, channel: Channel, key: string, userId: string | null): NotifyJob {
  const head = `Lembrete: ${a.title}`;
  const at = `${when(a.due_at)} (${leadLabel(minutes)})`;
  return {
    key,
    channel,
    kind: "reminder",
    userId,
    activityId: a.id,
    title: head,
    text: [`⏰ ${head}`, at, ...details(a)].join("\n"),
    subject: `⏰ ${a.title} — ${when(a.due_at)}`,
    html: emailHtml("Lembrete de atividade", [{ title: a.title, lines: [`Início: ${when(a.due_at)}`, ...details(a)] }]),
  };
}

function listJob(kind: NotifyKind, key: string, channel: Channel, userId: string, heading: string, acts: ActRow[], empty = ""): NotifyJob {
  const lines = acts.map((a) => `• ${hhmm(new Date(a.due_at))} ${a.title}${a.deal_title ? ` (${a.deal_title})` : ""}`);
  return {
    key,
    channel,
    kind,
    userId,
    activityId: null,
    title: heading,
    text: [heading, ...(lines.length ? lines : [empty])].filter(Boolean).join("\n"),
    subject: heading,
    html: emailHtml(heading, acts.map((a) => ({ title: a.title, lines: [`Início: ${when(a.due_at)}`, ...details(a)] }))),
  };
}

const MAX_ATTEMPTS = 3;
const RETRY_MIN = [5, 15, 60];
/** Lembrete com atraso maior que isso, de atividade já começada, vira o aviso único. */
const STALE_MS = 15 * 60_000;

/**
 * Avisos a enviar agora. `settings` = preferências por usuário; `currentUserId`
 * = quem usa o Chrome deste computador (só ele recebe notificação do Chrome).
 * Lembretes que se perderam (Chrome fechado) ficam marcados e viram um aviso único.
 */
export function planNotifications(
  db: DatabaseSync,
  now: Date,
  settingsByUser: Record<string, Partial<NotifySettings>>,
  currentUserId: string | null,
): NotifyJob[] {
  const jobs: NotifyJob[] = [];
  const settings = (userId: string | null) => withDefaults(userId ? settingsByUser[userId] : undefined);
  const nowIso = now.toISOString();
  const state = new Map(
    many<{ key: string; channel: string; status: string; attempts: number; next_attempt_at: string | null }>(
      db,
      "SELECT key, channel, status, attempts, next_attempt_at FROM notification_delivery WHERE updated_at >= ? OR status = 'failed'",
      new Date(now.getTime() - 3 * 86400_000).toISOString(),
    ).map((r) => [`${r.key}|${r.channel}`, r]),
  );
  /** Ainda falta enviar (nunca tentou, ou falhou e chegou a hora de tentar de novo). */
  const pending = (key: string, channel: Channel) => {
    const s = state.get(`${key}|${channel}`);
    if (!s) return true;
    return s.status === "failed" && s.attempts < MAX_ATTEMPTS && (!s.next_attempt_at || s.next_attempt_at <= nowIso);
  };
  /** Canal disponível para o usuário agora (configurado, Chrome só para quem está aqui, silêncio). */
  const usable = (userId: string | null, channel: Channel, s: NotifySettings) => {
    if (!channelReady(s, channel)) return false;
    if (channel === "chrome" && userId && currentUserId && userId !== currentUserId) return false;
    if (channel !== "email" && inQuietHours(s, now)) return false;
    return true;
  };
  const skip = (key: string, channel: Channel, kind: NotifyKind, userId: string | null, activityId: string | null) =>
    run(
      db,
      `INSERT INTO notification_delivery (key, channel, user_id, activity_id, kind, status, updated_at) VALUES (?, ?, ?, ?, ?, 'skipped', ?)
       ON CONFLICT(key, channel) DO UPDATE SET status = 'skipped', updated_at = excluded.updated_at`,
      key,
      channel,
      userId,
      activityId,
      kind,
      nowIso,
    );

  // 1. Lembretes das atividades em aberto (início nas últimas 24 h ou no futuro).
  const reminders = many<ActRow & { minutes_before: number; channels: string }>(
    db,
    `${ACT_SQL.replace(" FROM activity a", ", r.minutes_before, r.channels FROM activity a")} JOIN activity_reminder r ON r.activity_id = a.id AND r.deleted_at IS NULL
     WHERE a.deleted_at IS NULL AND a.done = 0 AND a.due_at > ?`,
    new Date(now.getTime() - 86400_000).toISOString(),
  ).map((r) => ({ ...r, fireAt: new Date(r.due_at).getTime() - r.minutes_before * 60_000 }));
  const missed = new Map<string, { channel: Channel; userId: string; acts: ActRow[] }>();
  for (const r of reminders) {
    if (r.fireAt > now.getTime()) continue;
    const userId = r.owner_id ?? currentUserId;
    const s = settings(userId);
    const key = `reminder:${r.id}:${r.due_at}:${r.minutes_before}`;
    const started = new Date(r.due_at).getTime() <= now.getTime();
    const stale = started && now.getTime() - r.fireAt > STALE_MS;
    for (const channel of JSON.parse(r.channels) as Channel[]) {
      if (!pending(key, channel)) continue;
      if (stale) {
        // Perdido (Chrome fechado): marca e entra no aviso único.
        skip(key, channel, "reminder", userId, r.id);
        if (userId && usable(userId, channel, s)) {
          const m = missed.get(`${userId}|${channel}`) ?? { channel, userId, acts: [] };
          if (!m.acts.some((x) => x.id === r.id)) m.acts.push(r);
          missed.set(`${userId}|${channel}`, m);
        }
        continue;
      }
      if (!usable(userId, channel, s)) continue;
      jobs.push(reminderJob(r, r.minutes_before, channel, key, userId));
    }
  }
  const stamp = nowIso.slice(0, 16);
  for (const m of missed.values()) {
    const n = m.acts.length;
    jobs.push(
      listJob("missed", `missed:${m.userId}:${stamp}`, m.channel, m.userId, `${n} atividade${n > 1 ? "s" : ""} começ${n > 1 ? "aram" : "ou"} enquanto o Chrome estava fechado`, m.acts),
    );
  }

  // 2. Resumo diário e atrasadas, por usuário.
  const day0 = startOfDay(now);
  const day1 = new Date(day0.getTime() + 86400_000);
  const dayKey = `${day0.getFullYear()}-${String(day0.getMonth() + 1).padStart(2, "0")}-${String(day0.getDate()).padStart(2, "0")}`;
  for (const userId of Object.keys(settingsByUser)) {
    const s = settings(userId);
    if (s.digest.enabled) {
      const [h, mi] = s.digest.time.split(":").map(Number);
      const at = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate(), h ?? 7, mi ?? 30);
      if (now >= at) {
        const key = `digest:${userId}:${dayKey}`;
        const chans = s.digest.channels.filter((c) => pending(key, c) && usable(userId, c, s));
        if (chans.length) {
          const today = many<ActRow>(
            db,
            `${ACT_SQL} WHERE a.deleted_at IS NULL AND a.done = 0 AND a.owner_id = ?
               AND ((a.due_at >= ? AND a.due_at < ?) OR (a.end_at IS NOT NULL AND a.end_at >= ? AND a.end_at < ?)) ORDER BY a.due_at`,
            userId,
            day0.toISOString(),
            day1.toISOString(),
            day0.toISOString(),
            day1.toISOString(),
          );
          const late = many<ActRow>(
            db,
            `${ACT_SQL} WHERE a.deleted_at IS NULL AND a.done = 0 AND a.owner_id = ?
               AND ((a.end_at IS NOT NULL AND a.end_at < ?) OR (a.end_at IS NULL AND a.due_at < ?)) ORDER BY a.due_at`,
            userId,
            nowIso,
            day0.toISOString(),
          );
          const heading = `Sua agenda de hoje: ${today.length} atividade${today.length === 1 ? "" : "s"}${late.length ? ` · ${late.length} atrasada${late.length === 1 ? "" : "s"}` : ""}`;
          for (const c of chans) jobs.push(listJob("digest", key, c, userId, heading, [...today, ...late.slice(0, 10)], "Nenhuma atividade para hoje."));
        }
      }
    }
    if (s.overdue.enabled) {
      // Atrasada há menos de 24 h (as antigas já aparecem no resumo diário).
      const rows = many<ActRow>(
        db,
        `${ACT_SQL} WHERE a.deleted_at IS NULL AND a.done = 0 AND a.owner_id = ?
           AND ((a.end_at IS NOT NULL AND a.end_at < ? AND a.end_at >= ?) OR (a.end_at IS NULL AND a.due_at < ? AND a.due_at >= ?))`,
        userId,
        nowIso,
        new Date(now.getTime() - 86400_000).toISOString(),
        day0.toISOString(),
        new Date(day0.getTime() - 86400_000).toISOString(),
      );
      for (const a of rows) {
        const key = `overdue:${a.id}:${a.end_at ?? a.due_at}`;
        for (const c of s.overdue.channels) {
          if (!pending(key, c) || !usable(userId, c, s)) continue;
          jobs.push({
            ...listJob("overdue", key, c, userId, `Atividade atrasada: ${a.title}`, [a]),
            activityId: a.id,
            text: [`⚠️ Atividade atrasada: ${a.title}`, a.end_at ? `Finalização: ${when(a.end_at)}` : `Início: ${when(a.due_at)}`, ...details(a)].join("\n"),
          });
        }
      }
    }
  }
  return jobs;
}

/** Resultado dos envios: enviado, ou falha com nova tentativa em 5, 15 e 60 min. */
export function recordDeliveries(
  db: DatabaseSync,
  results: { key: string; channel: Channel; kind: NotifyKind; userId: string | null; activityId: string | null; title: string; ok: boolean; error?: string }[],
  now = new Date(),
): { finalFailures: { title: string; channel: Channel; error: string }[] } {
  const finalFailures: { title: string; channel: Channel; error: string }[] = [];
  const at = now.toISOString();
  withTransaction(db, () => {
    for (const r of results) {
      const prev = one<{ attempts: number }>(db, "SELECT attempts FROM notification_delivery WHERE key = ? AND channel = ?", r.key, r.channel);
      const attempts = (prev?.attempts ?? 0) + 1;
      const next = r.ok || attempts >= MAX_ATTEMPTS ? null : new Date(now.getTime() + RETRY_MIN[attempts - 1]! * 60_000).toISOString();
      if (!r.ok && attempts >= MAX_ATTEMPTS) finalFailures.push({ title: r.title, channel: r.channel, error: r.error ?? "erro" });
      run(
        db,
        `INSERT INTO notification_delivery (key, channel, user_id, activity_id, kind, status, attempts, next_attempt_at, last_error, title, sent_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key, channel) DO UPDATE SET status = excluded.status, attempts = excluded.attempts, next_attempt_at = excluded.next_attempt_at,
           last_error = excluded.last_error, sent_at = excluded.sent_at, updated_at = excluded.updated_at`,
        r.key,
        r.channel,
        r.userId,
        r.activityId,
        r.kind,
        r.ok ? "sent" : "failed",
        attempts,
        next,
        r.ok ? null : (r.error ?? "erro"),
        r.title,
        r.ok ? at : null,
        at,
      );
    }
  });
  return { finalFailures };
}

/** Histórico de envios de uma atividade (mais recentes primeiro). */
export function activityDeliveries(
  db: DatabaseSync,
  activityId: string,
): { channel: Channel; kind: NotifyKind; status: string; sent_at: string | null; last_error: string | null; attempts: number; updated_at: string }[] {
  return many(
    db,
    "SELECT channel, kind, status, sent_at, last_error, attempts, updated_at FROM notification_delivery WHERE activity_id = ? AND status <> 'skipped' ORDER BY updated_at DESC LIMIT 30",
    activityId,
  );
}
