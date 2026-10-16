// Partes comuns das fichas de contato e organização.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Circle, X } from "lucide-react";
import { TaBadge, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { ActivityListItem } from "../../db/activities";
import type { CustomField, CustomValue } from "../../db/customFields";
import type { DataTable } from "../../db/repo";
import { formatCents, formatDateTime } from "../../lib/format";
import { useSession } from "../session";

export function DrawerShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] flex justify-end">
      <div className="fixed inset-0 bg-gray-900/40" onClick={onClose} aria-hidden />
      <div className="relative h-full w-full max-w-[920px] overflow-y-auto bg-white p-6 shadow-theme-xl dark:bg-gray-900">
        <button type="button" onClick={onClose} title="Fechar" className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/5">
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 text-theme-sm">
      <span className="text-gray-500">{label}</span>
      <span className="min-w-0 break-words text-gray-800 dark:text-white/90">{children || <span className="text-gray-400">—</span>}</span>
    </div>
  );
}

function RefName({ kind, id }: { kind: "person" | "organization"; id: string }) {
  const [name, setName] = useState("");
  useEffect(() => {
    const load = kind === "person" ? call("persons.get", { id }) : call("organizations.get", { id });
    void load.then((r) => setName(r?.name ?? ""));
  }, [kind, id]);
  return <>{name}</>;
}

export function CustomValuesView({ fields, values }: { fields: CustomField[]; values: Record<string, CustomValue> }) {
  const { users } = useSession();
  const shown = fields.filter((f) => !f.hidden && (values[f.id] !== undefined || f.always_show));
  if (shown.length === 0) return null;
  const text = (f: CustomField, v: CustomValue | undefined): ReactNode => {
    if (v === undefined || v === null) return "";
    switch (f.field_type) {
      case "money":
        return formatCents(Number(v));
      case "boolean":
        return v ? "Sim" : "Não";
      case "date":
        return String(v).split("-").reverse().join("/");
      case "datetime":
        return formatDateTime(String(v));
      case "select":
        return f.options.find((o) => o.id === v)?.label ?? "";
      case "multiselect":
        return (v as string[]).map((id) => f.options.find((o) => o.id === id)?.label).filter(Boolean).join(", ");
      case "user":
        return users.find((u) => u.id === v)?.name ?? "";
      case "person":
      case "organization":
        return <RefName kind={f.field_type} id={String(v)} />;
      default:
        return String(v);
    }
  };
  return (
    <>
      {shown.map((f) => (
        <InfoRow key={f.id} label={f.name}>
          {text(f, values[f.id])}
        </InfoRow>
      ))}
    </>
  );
}

const KIND_LABEL = { deal: "Negócio", ticket: "Ticket", project: "Projeto" } as const;
const STATUS = { won: { color: "green", label: "Ganho" }, lost: { color: "red", label: "Perdido" } } as const;

export function RelatedCards({ filter, onOpenCard }: { filter: { personId?: string; organizationId?: string }; onOpenCard: (pipelineId: string, cardId: string) => void }) {
  const [cards, setCards] = useState<Awaited<ReturnType<typeof loadCards>>>([]);
  const key = filter.personId ?? filter.organizationId;
  useEffect(() => {
    void loadCards(filter).then(setCards);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (cards.length === 0) return <p className="text-theme-sm text-gray-400">Nenhum negócio, ticket ou projeto.</p>;
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {cards.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => onOpenCard(c.pipeline_id, c.id)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-white/5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-theme-sm font-medium text-brand-600">{c.title}</span>
              <span className="block text-theme-xs text-gray-500">
                {KIND_LABEL[c.kind]} · {c.pipeline_name} · {c.stage_name}
              </span>
            </span>
            {c.status !== "open" && <TaBadge color={STATUS[c.status].color} label={STATUS[c.status].label} />}
            {c.kind === "deal" && <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{formatCents(c.value_cents)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function loadCards(filter: { personId?: string; organizationId?: string }) {
  return call("cards.forEntity", filter);
}

export function RelatedTasks({ filter }: { filter: { personId?: string; organizationId?: string } }) {
  const [tasks, setTasks] = useState<ActivityListItem[]>([]);
  const key = filter.personId ?? filter.organizationId;
  const load = useCallback(() => call("activities.list", filter).then(setTasks), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
  }, [load]);
  if (tasks.length === 0) return <p className="text-theme-sm text-gray-400">Nenhuma tarefa.</p>;
  const now = Date.now();
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-3 py-2">
          <button
            type="button"
            className={t.done ? "text-success-600" : "text-gray-400 hover:text-success-600"}
            onClick={async () => {
              await call("activities.setDone", { id: t.id, done: !t.done });
              await load();
            }}
          >
            {t.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
          </button>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-theme-sm", t.done ? "text-gray-400 line-through" : "text-gray-800 dark:text-white/90")}>{t.title}</p>
            <p className={cn("text-theme-xs", !t.done && new Date(t.due_at).getTime() < now ? "text-error-600" : "text-gray-400")}>
              {t.type_name} · {formatDateTime(t.due_at)}
              {t.deal_title && ` · ${t.deal_title}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const FIELD_LABEL: Record<string, string> = {
  name: "Nome", email: "E-mail", phone: "Telefone", notes: "Notas", owner_id: "Responsável", is_private: "Privado", avatar_id: "Foto",
  legal_name: "Razão social", cnpj: "CNPJ", website: "Site", segment: "Segmento", cep: "CEP", street: "Logradouro", number: "Número",
  complement: "Complemento", district: "Bairro", city: "Cidade", state: "Estado", country: "País", description: "Descrição", logo_id: "Logo",
};

export function ChangeLogList({ table, id }: { table: DataTable; id: string }) {
  const { users } = useSession();
  const [log, setLog] = useState<{ op: string; changes: string; user_id: string | null; at: string }[]>([]);
  useEffect(() => {
    void call("history.get", { table, id }).then((l) => setLog([...l].reverse()));
  }, [table, id]);
  return (
    <ul className="space-y-2">
      {log.map((l, i) => {
        const fields = Object.keys(JSON.parse(l.changes) as Record<string, unknown>).map((f) => FIELD_LABEL[f]).filter(Boolean);
        const what = l.op === "insert" ? "Criou" : l.op === "delete" ? "Excluiu" : l.op === "restore" ? "Restaurou" : `Alterou ${fields.join(", ") || "dados"}`;
        return (
          <li key={i} className="text-theme-sm text-gray-700 dark:text-gray-300">
            <span className="font-medium">{users.find((u) => u.id === l.user_id)?.name ?? "Sistema"}</span> · {what}
            <span className="block text-theme-xs text-gray-400">{formatDateTime(l.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/5">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn("flex-1 rounded-md py-1.5 text-theme-sm font-medium", value === id ? "bg-white text-brand-600 shadow-theme-xs dark:bg-gray-900" : "text-gray-600 dark:text-gray-400")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

