// Menu Tarefas (spec 02, seção 5): período, alertas (atrasadas / hoje /
// próximos 7 dias), filtros, visões Minhas / Minha equipe / Todas, lista
// agrupada (atrasadas, em andamento, por dia de início) e calendário do mês.
// Cada linha mostra tags, início/finalização com os dias que faltam, anexos
// para baixar e atalhos clicáveis para o cartão, o contato e a organização.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CalendarClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Circle, Download, Filter, List, Paperclip, Plus, Search, Sun, User, Video } from "lucide-react";
import { TaButton, TaSelect, badgePalette, cn, type BadgeColor } from "@tailadmin";
import { call } from "../../rpc/client";
import type { ActivityListItem, ActivityType } from "../../db/activities";
import { ActivityIcon } from "../../lib/activityIcons";
import { downloadVersion } from "../../lib/documentFiles";
import { taskTiming } from "../../lib/taskTiming";
import { useSession } from "../session";
import { Avatar } from "../ui/Avatar";
import { TaskModal, type TaskRequest } from "./TaskModal";
import { errorText } from "../../lib/errors";

type Period = "hoje" | "amanha" | "semana" | "mes" | "todas" | "personalizado" | "atrasadas" | "proximos7";
type Status = "pendentes" | "concluidas" | "todas";
type Scope = "minhas" | "equipe" | "todas";

const PERIOD_LABEL: Record<Exclude<Period, "atrasadas" | "proximos7">, string> = {
  hoje: "Hoje",
  amanha: "Amanhã",
  semana: "Esta semana",
  mes: "Este mês",
  todas: "Todas",
  personalizado: "Personalizado",
};
/** Período personalizado: dias inteiros, de/até inclusive (AAAA-MM-DD, local). */
interface CustomRange {
  start: string;
  end: string;
}
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function range(p: Period, custom?: CustomRange): { from?: string; to?: string; overdue?: boolean } {
  const t = dayStart(new Date());
  switch (p) {
    case "personalizado":
      return custom?.start && custom.end ? { from: parseYmd(custom.start).toISOString(), to: addDays(parseYmd(custom.end), 1).toISOString() } : {};
    case "hoje":
      return { from: t.toISOString(), to: addDays(t, 1).toISOString() };
    case "amanha":
      return { from: addDays(t, 1).toISOString(), to: addDays(t, 2).toISOString() };
    case "semana":
      return { from: addDays(t, -t.getDay()).toISOString(), to: addDays(t, 7 - t.getDay()).toISOString() };
    case "mes":
      return { from: new Date(t.getFullYear(), t.getMonth(), 1).toISOString(), to: new Date(t.getFullYear(), t.getMonth() + 1, 1).toISOString() };
    case "proximos7":
      return { from: addDays(t, 1).toISOString(), to: addDays(t, 8).toISOString() };
    case "atrasadas":
      return { overdue: true };
    default:
      return {};
  }
}

function groupLabel(d: Date, overdue: boolean): string {
  if (overdue) return "Atrasadas";
  const t = dayStart(new Date());
  const diff = Math.round((dayStart(d).getTime() - t.getTime()) / 86400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  return `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}${d.getFullYear() !== t.getFullYear() ? `/${d.getFullYear()}` : ""}`;
}

export interface TaskLinks {
  onOpenCard: (pipelineId: string, cardId: string) => void;
  onOpenPerson: (id: string) => void;
  onOpenOrganization: (id: string) => void;
}

export function TasksView({
  refreshKey,
  initialMode,
  openTaskId,
  onOpenTaskConsumed,
  links,
}: {
  refreshKey: number;
  initialMode?: "lista" | "calendario";
  openTaskId?: string | null;
  onOpenTaskConsumed?: () => void;
  links: TaskLinks;
}) {
  const { user, users } = useSession();
  const [mode, setMode] = useState<"lista" | "calendario">(initialMode ?? "lista");
  const [period, setPeriod] = useState<Period>("semana");
  const [custom, setCustom] = useState<CustomRange>(() => {
    const t = new Date();
    return { start: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), end: ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0)) };
  });
  const [status, setStatus] = useState<Status>("pendentes");
  const [scope, setScope] = useState<Scope>(user.role === "vendedor" ? "minhas" : "todas");
  const [ownerId, setOwnerId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [search, setSearch] = useState("");
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([user.id]);
  const [rows, setRows] = useState<ActivityListItem[]>([]);
  const [counters, setCounters] = useState({ overdue: 0, today: 0, next7: 0 });
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [modal, setModal] = useState<TaskRequest | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);
  useEffect(() => {
    if (openTaskId) {
      setModal({ id: openTaskId });
      onOpenTaskConsumed?.();
    }
  }, [openTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void call("activityTypes.list", {}).then(setTypes);
    void call("teams.list").then((teams) => {
      const mine = teams.filter((t) => t.members.some((m) => m.userId === user.id));
      setTeamIds([...new Set([user.id, ...mine.flatMap((t) => t.members.map((m) => m.userId))])]);
    });
  }, [user.id]);

  const ownerIds = ownerId ? [ownerId] : scope === "minhas" ? [user.id] : scope === "equipe" ? teamIds : undefined;
  const base = useMemo(() => ({ ownerIds, typeId: typeId || undefined, search: search || undefined }), [ownerId, scope, teamIds, typeId, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const r =
      mode === "calendario"
        ? { from: addDays(month, -month.getDay()).toISOString(), to: addDays(month, 42 - month.getDay()).toISOString() }
        : range(period, custom);
    const done = status === "pendentes" || r.overdue ? false : status === "concluidas" ? true : undefined;
    const [list, c] = await Promise.all([call("activities.list", { ...base, ...r, done, limit: 1000 }), call("activities.counters", base)]);
    setRows(list);
    setCounters(c);
  }, [base, period, custom, status, mode, month]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, refreshKey, reload, search]);

  const toggle = async (a: ActivityListItem) => {
    await call("activities.setDone", { id: a.id, done: !a.done });
    setReload((n) => n + 1);
  };

  const now = Date.now();
  const isOverdue = (a: ActivityListItem) => !a.done && !!a.end_at && new Date(a.end_at).getTime() < now;
  const groups = useMemo(() => {
    const map = new Map<string, ActivityListItem[]>();
    const todayStart = dayStart(new Date()).getTime();
    // Ordem fixa dos grupos: atrasadas, em andamento e depois por dia de início.
    map.set("Atrasadas", []);
    map.set("Em andamento", []);
    for (const a of rows) {
      const start = new Date(a.due_at);
      const key = isOverdue(a) ? "Atrasadas" : !a.done && start.getTime() < todayStart ? "Em andamento" : groupLabel(start, false);
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return [...map.entries()].filter(([, items]) => items.length);
  }, [rows, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const alerts: { key: Period; label: string; n: number; icon: React.ReactNode; cls: string }[] = [
    { key: "atrasadas", label: "Atividades atrasadas", n: counters.overdue, icon: <AlertTriangle size={20} />, cls: "border-error-200 bg-error-50 text-error-700" },
    { key: "hoje", label: "Para hoje", n: counters.today, icon: <Sun size={20} />, cls: "border-brand-200 bg-brand-25 text-brand-700" },
    { key: "proximos7", label: "Próximos 7 dias", n: counters.next7, icon: <CalendarClock size={20} />, cls: "border-warning-200 bg-warning-25 text-warning-700" },
  ];

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const TONE = { danger: "bg-error-50 text-error-700", warning: "bg-warning-50 text-warning-700", ok: "bg-success-50 text-success-700", muted: "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-400" } as const;
  const linkCls = "inline-flex max-w-[220px] items-center gap-1 truncate rounded hover:text-brand-600 hover:underline";

  const row = (a: ActivityListItem) => {
    const timing = taskTiming(a);
    return (
      <li key={a.id} className="flex items-start gap-3 px-2 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5">
        <button type="button" title={a.done ? "Reabrir" : "Concluir"} onClick={() => void toggle(a)} className={cn("mt-0.5", a.done ? "text-success-600" : "text-gray-300 hover:text-success-500")}>
          {a.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
        </button>
        <span className="mt-0.5 text-brand-500" title={a.type_name}>
          <ActivityIcon name={a.type_icon} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={cn("truncate text-left text-theme-sm font-medium hover:underline", a.done ? "text-gray-400 line-through" : "text-gray-800 dark:text-white/90")} onClick={() => setModal({ id: a.id })}>
              {a.title}
              {a.title_ext && <span className="font-normal text-gray-500" data-name-ext> - {a.title_ext}</span>}
            </button>
            {a.tags.map((t) => {
              const c = badgePalette[t.color as BadgeColor] ?? badgePalette.slate;
              return (
                <span key={t.id} className="rounded-full border px-1.5 py-px text-[10px] font-medium" style={{ background: c.bg, color: c.fg, borderColor: c.border }}>
                  {t.name}
                </span>
              );
            })}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-theme-xs text-gray-500">
            <span>{a.type_name}</span>
            {a.deal_id && a.pipeline_id && (
              <button type="button" className={linkCls} title="Abrir o cartão no funil" onClick={() => links.onOpenCard(a.pipeline_id!, a.deal_id!)}>
                <Filter size={12} /> {a.pipeline_name} › {a.deal_title}
              </button>
            )}
            {a.person_id && a.person_name && (
              <button type="button" className={linkCls} title="Abrir o contato" onClick={() => links.onOpenPerson(a.person_id!)}>
                <User size={12} /> {a.person_name}
              </button>
            )}
            {a.organization_id && a.organization_name && (
              <button type="button" className={linkCls} title="Abrir a organização" onClick={() => links.onOpenOrganization(a.organization_id!)}>
                <Building2 size={12} /> {a.organization_name}
              </button>
            )}
          </div>
          {a.documents.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {a.documents.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  title={`Baixar ${f.filename}`}
                  onClick={() => void downloadVersion(f.version_id).catch((e: unknown) => alert(errorText(e)))}
                  className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                >
                  <Paperclip size={11} />
                  <span className="truncate">{f.name}</span>
                  <Download size={11} />
                </button>
              ))}
            </div>
          )}
        </div>
        {a.meeting_url && (
          <a href={a.meeting_url} target="_blank" rel="noopener" title="Entrar na reunião" className="mt-0.5 text-brand-500">
            <Video size={16} />
          </a>
        )}
        <div className="w-44 shrink-0 text-right text-theme-xs">
          <span className={cn("inline-block rounded-full px-2 py-0.5 font-medium", TONE[timing.tone])}>{timing.label}</span>
          <span className="mt-0.5 block text-gray-500">
            Início {fmt(a.due_at)}
            {a.end_at && (
              <>
                <br />
                Fim {fmt(a.end_at)}
                {timing.span && <span className="text-gray-400"> · {timing.span}</span>}
              </>
            )}
          </span>
        </div>
        {a.owner_name && <Avatar name={a.owner_name} size={24} title={`Responsável: ${a.owner_name}`} />}
      </li>
    );
  };

  const calDays = Array.from({ length: 42 }, (_, i) => addDays(month, i - month.getDay()));

  return (
    <div className="space-y-4">
      {/* Período e filtros (padrão da gestão financeira) */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <span className="mr-1 text-theme-sm font-semibold text-gray-800 dark:text-white/90">Período</span>
        {(Object.keys(PERIOD_LABEL) as (keyof typeof PERIOD_LABEL)[]).map((p) => (
          <button
            key={p}
            type="button"
            disabled={mode === "calendario"}
            onClick={() => setPeriod(p)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-theme-sm font-medium ring-1 ring-inset disabled:opacity-40",
              period === p ? "bg-brand-500 text-white ring-brand-500" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700",
            )}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
        {period === "personalizado" && mode === "lista" && (
          <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 ring-1 ring-inset ring-gray-300 dark:ring-gray-700">
            <CalendarDays size={15} className="text-gray-500" />
            <input
              type="date"
              aria-label="De"
              value={custom.start}
              max={custom.end || undefined}
              onChange={(e) => e.target.value && setCustom((c) => ({ start: e.target.value, end: c.end < e.target.value ? e.target.value : c.end }))}
              className="bg-transparent text-theme-sm text-gray-700 outline-none dark:text-gray-300"
            />
            <span className="text-gray-400">-</span>
            <input
              type="date"
              aria-label="Até"
              value={custom.end}
              min={custom.start || undefined}
              onChange={(e) => e.target.value && setCustom((c) => ({ end: e.target.value, start: c.start > e.target.value ? e.target.value : c.start }))}
              className="bg-transparent text-theme-sm text-gray-700 outline-none dark:text-gray-300"
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/5">
          {(
            [
              ["lista", "Lista", <List key="l" size={15} />],
              ["calendario", "Calendário", <CalendarDays key="c" size={15} />],
            ] as const
          ).map(([m, label, icon]) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-theme-sm font-medium", mode === m ? "bg-white text-brand-600 shadow-theme-xs dark:bg-gray-900" : "text-gray-600 dark:text-gray-400")}>
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Alertas clicáveis */}
      <div className="grid gap-3 md:grid-cols-3">
        {alerts.map((al) => (
          <button
            key={al.key}
            type="button"
            onClick={() => {
              setMode("lista");
              setPeriod(period === al.key ? "semana" : al.key);
              setStatus("pendentes");
            }}
            className={cn("flex items-center gap-3 rounded-2xl border p-4 text-left transition", al.cls, period === al.key ? "ring-2 ring-offset-1" : "opacity-90 hover:opacity-100")}
          >
            {al.icon}
            <span>
              <span className="block text-theme-sm font-semibold">{al.label}</span>
              <span className="block text-theme-xs opacity-80">{al.n} atividade(s)</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
          <input
            className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-theme-sm placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            placeholder="Pesquisar atividades…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <TaSelect className="w-40" value={scope} disabled={!!ownerId} onChange={(e) => setScope(e.target.value as Scope)}>
          <option value="minhas">Minhas</option>
          <option value="equipe">Minha equipe</option>
          <option value="todas">Todas</option>
        </TaSelect>
        <TaSelect className="w-44" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">Responsável: —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </TaSelect>
        <TaSelect className="w-40" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Tipo: todos</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </TaSelect>
        <TaSelect className="w-36" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
          <option value="pendentes">Pendentes</option>
          <option value="concluidas">Concluídas</option>
          <option value="todas">Todas</option>
        </TaSelect>
        <TaButton variant="primary" startIcon={<Plus size={15} />} onClick={() => setModal({})}>
          Atividade
        </TaButton>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        {mode === "lista" ? (
          groups.length === 0 ? (
            <p className="py-10 text-center text-theme-sm text-gray-500">Nenhuma atividade neste período.</p>
          ) : (
            groups.map(([label, items]) => (
              <section key={label} className="mb-4 last:mb-0">
                <h3 className={cn("mb-1 px-2 text-theme-xs font-semibold uppercase", label === "Atrasadas" ? "text-error-600" : label === "Em andamento" ? "text-brand-600" : "text-gray-500")}>
                  {label} <span className="font-normal">({items.length})</span>
                </h3>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">{items.map(row)}</ul>
              </section>
            ))
          )
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <button type="button" title="Mês anterior" className="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-gray-300 dark:ring-gray-700" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                <ChevronLeft size={16} />
              </button>
              <span className="min-w-[150px] text-center text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                {MONTHS[month.getMonth()]} {month.getFullYear()}
              </span>
              <button type="button" title="Próximo mês" className="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-gray-300 dark:ring-gray-700" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                <ChevronRight size={16} />
              </button>
              <TaButton size="sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
                Hoje
              </TaButton>
            </div>
            <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              {WEEKDAYS.map((w) => (
                <div key={w} className="border-b border-gray-200 bg-gray-50 py-1.5 text-center text-theme-xs font-semibold text-gray-500 dark:border-gray-800 dark:bg-white/5">
                  {w}
                </div>
              ))}
              {calDays.map((d) => {
                const items = rows.filter((a) => dayStart(new Date(a.due_at)).getTime() === d.getTime());
                const isToday = d.getTime() === dayStart(new Date()).getTime();
                return (
                  <div key={d.toISOString()} className={cn("min-h-[104px] border-b border-r border-gray-100 p-1.5 dark:border-gray-800", d.getMonth() !== month.getMonth() && "bg-gray-50/60 dark:bg-white/[0.02]")}>
                    <div className={cn("mb-1 flex h-6 w-6 items-center justify-center rounded-full text-theme-xs", isToday ? "bg-brand-500 font-semibold text-white" : d.getMonth() === month.getMonth() ? "text-gray-700 dark:text-gray-300" : "text-gray-300")}>
                      {d.getDate()}
                    </div>
                    {items.slice(0, 3).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setModal({ id: a.id })}
                        className={cn(
                          "mb-0.5 flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px]",
                          a.done ? "text-gray-400 line-through" : isOverdue(a) ? "bg-error-50 text-error-700" : "bg-brand-50 text-brand-700",
                        )}
                      >
                        <ActivityIcon name={a.type_icon} size={11} />
                        {pad(new Date(a.due_at).getHours())}:{pad(new Date(a.due_at).getMinutes())} {a.title}{a.title_ext && <span className="font-normal text-gray-500" data-name-ext> - {a.title_ext}</span>}
                      </button>
                    ))}
                    {items.length > 3 && <span className="px-1 text-[11px] text-gray-500">+{items.length - 3} mais</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {modal && (
        <TaskModal
          request={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
