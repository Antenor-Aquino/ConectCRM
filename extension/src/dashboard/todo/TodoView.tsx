// To Do (spec 15, fase 1): lista pessoal de afazeres, separada das Atividades
// do CRM (benchmark: Microsoft To Do). Esquerda: listas inteligentes e
// "Minhas listas"; centro: adicionar, tarefas abertas e "Concluída"; direita:
// detalhes da tarefa (etapas, vencimento, lista, observações).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, Home, Infinity as InfinityIcon, ListTodo, MoreHorizontal, NotebookPen, Plus, Search, Star, Trash2, X } from "lucide-react";
import { TaInput, cn } from "@tailadmin";
import { call, DATA_CHANGED_EVENT } from "../../rpc/client";
import type { TodoList, TodoSmart, TodoStep, TodoTask, TodoView as View } from "../../db/todo";
import { dueLabel, PLANNED_GROUPS, plannedGroup, todayYmd } from "../../lib/todo";
import { errorText } from "../../lib/errors";
import { formatDate } from "../../lib/format";
import { Popover } from "../ui/Popover";

const SMART: { id: TodoSmart; label: string; icon: React.ReactNode }[] = [
  { id: "importante", label: "Importante", icon: <Star size={17} /> },
  { id: "planejado", label: "Planejado", icon: <CalendarDays size={17} /> },
  { id: "todas", label: "Todas", icon: <InfinityIcon size={17} /> },
  { id: "tarefas", label: "Tarefas", icon: <Home size={17} /> },
];
const COLOR: Record<string, string> = {
  blue: "#465FFF",
  green: "#12B76A",
  red: "#F04438",
  orange: "#FB6514",
  purple: "#7A5AF8",
  pink: "#EE46BC",
  slate: "#667085",
};
const VIEW_KEY = "conectcrm-todo-view";
const DONE_KEY = "conectcrm-todo-done-open";

const readPref = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writePref = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* preferência só desta tela */
  }
};

export function TodoView() {
  const [lists, setLists] = useState<TodoList[]>([]);
  const [counts, setCounts] = useState<Record<TodoSmart, number>>({ importante: 0, planejado: 0, todas: 0, tarefas: 0 });
  const [view, setViewState] = useState<View>(() => readPref<View>(VIEW_KEY, { smart: "tarefas" }));
  const [tasks, setTasks] = useState<{ open: TodoTask[]; done: TodoTask[] }>({ open: [], done: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newList, setNewList] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(() => readPref(DONE_KEY, false));
  const [error, setError] = useState<string | null>(null);

  const setView = (v: View) => {
    setViewState(v);
    setSelected(null);
    writePref(VIEW_KEY, v);
  };

  const loadLists = useCallback(async () => {
    const r = await call("todo.lists");
    setLists(r.lists);
    setCounts(r.counts);
    return r.lists;
  }, []);
  const loadTasks = useCallback(async () => {
    try {
      setTasks(await call("todo.tasks", { view, search: search || undefined }));
      setError(null);
    } catch (e) {
      // Lista que sumiu (excluída em outra aba): volta para "Tarefas".
      setError(errorText(e));
      if ("listId" in view) setView({ smart: "tarefas" });
    }
  }, [view, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    await Promise.all([loadLists(), loadTasks()]);
  }, [loadLists, loadTasks]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);
  // Restaurado pela lixeira (aviso "Restaurar") ou alterado em outra tela: recarrega.
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener(DATA_CHANGED_EVENT, on);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, on);
  }, [reload]);
  useEffect(() => {
    const t = setTimeout(() => void loadTasks(), search ? 200 : 0);
    return () => clearTimeout(t);
  }, [loadTasks, search]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
    await reload();
  };

  const currentList = "listId" in view ? lists.find((l) => l.id === view.listId) : undefined;
  const title = "smart" in view ? SMART.find((s) => s.id === view.smart)!.label : (currentList?.name ?? "Lista");
  const accent = currentList ? (COLOR[currentList.color] ?? COLOR.blue) : COLOR.blue;
  const showList = "smart" in view;

  const addTask = () => {
    const t = newTitle.trim();
    if (!t) return;
    setNewTitle("");
    void run(() =>
      call("todo.taskCreate", {
        title: t,
        listId: "listId" in view ? view.listId : null,
        important: "smart" in view && view.smart === "importante",
        dueDate: "smart" in view && view.smart === "planejado" ? todayYmd() : null,
      }),
    );
  };
  const toggleDone = (t: TodoTask) => void run(() => call("todo.taskUpdate", { id: t.id, patch: { done: !t.done } }));
  const toggleStar = (t: TodoTask) => void run(() => call("todo.taskUpdate", { id: t.id, patch: { important: !t.important } }));

  // Planejado: grupos por vencimento.
  const groups = useMemo(() => {
    if (!("smart" in view && view.smart === "planejado")) return [["", tasks.open] as const];
    const today = todayYmd();
    return PLANNED_GROUPS.map((g) => [g, tasks.open.filter((t) => t.due_date && plannedGroup(t.due_date, today) === g)] as const).filter(([, l]) => l.length);
  }, [tasks.open, view]);

  const row = (t: TodoTask) => {
    const due = t.due_date ? dueLabel(t.due_date) : null;
    return (
      <li
        key={t.id}
        data-todo-task={t.title}
        className={cn(
          "group flex items-center gap-3 rounded-lg border border-transparent bg-white px-3 py-2.5 shadow-theme-xs hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-white/5",
          selected === t.id && "border-brand-300 bg-brand-25 dark:bg-brand-500/10",
        )}
      >
        <button
          type="button"
          title={t.done ? "Marcar como não concluída" : "Concluir"}
          aria-label={t.done ? "Marcar como não concluída" : "Concluir"}
          data-todo-done
          onClick={() => toggleDone(t)}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
            t.done ? "border-brand-500 bg-brand-500 text-white" : "border-gray-400 text-transparent hover:text-gray-400",
          )}
        >
          <Check size={12} strokeWidth={3} />
        </button>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(t.id)}>
          <span className={cn("block truncate text-theme-sm", t.done ? "text-gray-400 line-through" : "text-gray-800 dark:text-white/90")}>{t.title}</span>
          {(showList || due || t.steps_total > 0 || t.notes) && (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-theme-xs text-gray-500">
              {showList && <span>{t.list_name ?? "Tarefas"}</span>}
              {t.steps_total > 0 && (
                <span>
                  {t.steps_done} de {t.steps_total}
                </span>
              )}
              {due && !t.done && (
                <span className={cn("flex items-center gap-1", due.tone === "danger" ? "text-error-600" : due.tone === "brand" ? "text-brand-600" : "")}>
                  <CalendarDays size={12} /> {due.text}
                </span>
              )}
              {t.notes && <NotebookPen size={12} aria-label="Tem observações" />}
            </span>
          )}
        </button>
        <button
          type="button"
          title={t.important ? "Remover a importância" : "Marcar como importante"}
          aria-label="Importante"
          data-todo-star={t.important ? "on" : "off"}
          onClick={() => toggleStar(t)}
          className={t.important ? "text-brand-500" : "text-gray-300 hover:text-brand-400"}
        >
          <Star size={18} fill={t.important ? "currentColor" : "none"} />
        </button>
      </li>
    );
  };

  return (
    <div className="flex gap-5" data-todo>
      {/* Listas */}
      <aside className="w-64 shrink-0 self-start rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <ul className="space-y-0.5">
          {SMART.map((s) => (
            <li key={s.id}>
              <SideItem active={"smart" in view && view.smart === s.id} icon={s.icon} label={s.label} count={counts[s.id]} onClick={() => setView({ smart: s.id })} />
            </li>
          ))}
        </ul>
        <div className="my-2 border-t border-gray-100 dark:border-gray-800" />
        <ul className="space-y-0.5" data-todo-lists>
          {lists.map((l) => (
            <li key={l.id}>
              <SideItem
                active={"listId" in view && view.listId === l.id}
                icon={<ListTodo size={17} style={{ color: COLOR[l.color] ?? COLOR.blue }} />}
                label={l.name}
                count={l.pending}
                onClick={() => setView({ listId: l.id })}
              />
            </li>
          ))}
        </ul>
        {newList === null ? (
          <button
            type="button"
            data-todo-new-list
            onClick={() => setNewList("")}
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-theme-sm text-brand-600 hover:bg-gray-50 dark:hover:bg-white/5"
          >
            <Plus size={17} /> Nova lista
          </button>
        ) : (
          <TaInput
            autoFocus
            className="mt-1"
            placeholder="Nome da lista (Enter)"
            value={newList}
            onChange={(e) => setNewList(e.target.value)}
            onBlur={() => !newList.trim() && setNewList(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setNewList(null);
              if (e.key !== "Enter" || !newList.trim()) return;
              const name = newList.trim();
              setNewList(null);
              void run(async () => {
                const id = await call("todo.listCreate", { name });
                setView({ listId: id });
              });
            }}
          />
        )}
      </aside>

      {/* Tarefas */}
      <section className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-gray-50 p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="flex min-w-0 items-center gap-2 text-2xl font-semibold" style={{ color: accent }} data-todo-title>
            {"smart" in view ? SMART.find((s) => s.id === view.smart)!.icon : <ListTodo size={22} />}
            <span className="truncate">{title}</span>
          </h1>
          {currentList && <ListMenu list={currentList} onChanged={() => void reload()} onDeleted={() => setView({ smart: "tarefas" })} onError={setError} />}
          <div className="relative ml-auto w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
            <TaInput className="pl-9" placeholder="Pesquisar nesta lista" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="mb-4 flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 shadow-theme-xs dark:bg-gray-900">
          <Plus size={18} className="text-brand-500" />
          <input
            data-todo-add
            className="flex-1 bg-transparent text-theme-sm text-gray-800 outline-none placeholder:text-brand-500 dark:text-white/90"
            placeholder="Adicionar uma tarefa"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
          />
        </div>

        {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}

        {tasks.open.length === 0 && tasks.done.length === 0 && (
          <p className="py-10 text-center text-theme-sm text-gray-500">{search ? "Nada encontrado." : "Nenhuma tarefa aqui. Escreva acima e tecle Enter."}</p>
        )}
        {groups.map(([g, list]) => (
          <div key={g || "all"} className="mb-3">
            {g && <h3 className={cn("mb-1.5 px-1 text-theme-xs font-semibold uppercase", g === "Atrasadas" ? "text-error-600" : "text-gray-500")}>{g}</h3>}
            <ul className="space-y-1.5">{list.map(row)}</ul>
          </div>
        ))}

        {tasks.done.length > 0 && (
          <div className="mt-4" data-todo-done-section>
            <button
              type="button"
              aria-expanded={doneOpen}
              onClick={() => {
                setDoneOpen(!doneOpen);
                writePref(DONE_KEY, !doneOpen);
              }}
              className="mb-1.5 flex items-center gap-1.5 rounded px-1 text-theme-sm font-semibold text-gray-700 hover:bg-white dark:text-gray-300 dark:hover:bg-white/5"
            >
              <ChevronDown size={16} className={cn("transition-transform", !doneOpen && "-rotate-90")} />
              Concluída <span className="font-normal text-gray-500">{tasks.done.length}</span>
            </button>
            {doneOpen && <ul className="space-y-1.5">{tasks.done.map(row)}</ul>}
          </div>
        )}
      </section>

      {/* Detalhes */}
      {selected && (
        <TaskDetail
          key={selected}
          id={selected}
          lists={lists}
          onClose={() => setSelected(null)}
          onChanged={() => void reload()}
          onDeleted={() => {
            setSelected(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function SideItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-theme-sm",
        active ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && <span className="text-theme-xs text-gray-500">{count}</span>}
    </button>
  );
}

/** "…" da lista: renomear, cor e excluir. */
function ListMenu({ list, onChanged, onDeleted, onError }: { list: TodoList; onChanged: () => void; onDeleted: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      onError(errorText(e));
    }
    onChanged();
  };
  if (name !== null) {
    return (
      <TaInput
        autoFocus
        className="w-56"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setName(null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setName(null);
          if (e.key === "Enter") {
            const v = name;
            setName(null);
            void act(() => call("todo.listUpdate", { id: list.id, name: v }));
          }
        }}
      />
    );
  }
  return (
    <div className="relative">
      <button type="button" title="Opções da lista" aria-label="Opções da lista" data-todo-list-menu onClick={() => setOpen(!open)} className="rounded-lg p-1.5 text-gray-500 hover:bg-white dark:hover:bg-white/5">
        <MoreHorizontal size={18} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-56 py-1">
        <button
          type="button"
          className="block w-full px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5"
          onClick={() => {
            setOpen(false);
            setName(list.name);
          }}
        >
          Renomear lista
        </button>
        <div className="flex gap-1.5 px-3.5 py-2">
          {Object.entries(COLOR).map(([k, c]) => (
            <button
              key={k}
              type="button"
              title={k}
              aria-label={`Cor ${k}`}
              onClick={() => void act(() => call("todo.listUpdate", { id: list.id, color: k }))}
              className={cn("h-5 w-5 rounded-full", list.color === k && "ring-2 ring-gray-400 ring-offset-1")}
              style={{ background: c }}
            />
          ))}
        </div>
        <button
          type="button"
          data-todo-list-delete
          className="block w-full px-3.5 py-2 text-left text-theme-sm text-error-600 hover:bg-error-50"
          onClick={() => {
            setOpen(false);
            if (!confirm(`Excluir a lista "${list.name}" e as tarefas dela? Vai para a lixeira, de onde pode ser restaurada.`)) return;
            void act(async () => {
              await call("todo.listDelete", { id: list.id });
              onDeleted();
            });
          }}
        >
          Excluir lista
        </button>
      </Popover>
    </div>
  );
}

type Detail = TodoTask & { steps: TodoStep[] };

/** Painel da direita: etapas, vencimento, lista, observações. Salva ao sair de cada campo. */
function TaskDetail({ id, lists, onClose, onChanged, onDeleted }: { id: string; lists: TodoList[]; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  const [t, setT] = useState<Detail | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stepInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await call("todo.task", { id });
    setT(d);
    if (d) {
      setTitle(d.title);
      setNotes(d.notes ?? "");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
    await load();
    onChanged();
  };
  const patch = (p: Record<string, unknown>) => save(() => call("todo.taskUpdate", { id, patch: p }));

  if (!t) return null;
  return (
    <aside
      data-todo-detail
      className="flex w-[360px] shrink-0 flex-col self-start rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="mb-3 flex items-start gap-2.5">
        <button
          type="button"
          title={t.done ? "Marcar como não concluída" : "Concluir"}
          onClick={() => void patch({ done: !t.done })}
          className={cn(
            "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
            t.done ? "border-brand-500 bg-brand-500 text-white" : "border-gray-400 text-transparent hover:text-gray-400",
          )}
        >
          <Check size={12} strokeWidth={3} />
        </button>
        <textarea
          data-todo-detail-title
          rows={2}
          className={cn("flex-1 resize-none bg-transparent text-base font-semibold text-gray-800 outline-none dark:text-white/90", t.done && "line-through")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== t.title && void patch({ title })}
        />
        <button type="button" title="Importante" onClick={() => void patch({ important: !t.important })} className={t.important ? "text-brand-500" : "text-gray-300 hover:text-brand-400"}>
          <Star size={18} fill={t.important ? "currentColor" : "none"} />
        </button>
      </div>

      {/* Etapas */}
      <ul className="mb-2 space-y-1" data-todo-steps>
        {t.steps.map((s) => (
          <li key={s.id} className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50 dark:hover:bg-white/5">
            <input type="checkbox" checked={!!s.done} onChange={() => void save(() => call("todo.stepUpdate", { id: s.id, done: !s.done }))} className="h-4 w-4 accent-brand-500" />
            <input
              defaultValue={s.title}
              className={cn("min-w-0 flex-1 bg-transparent text-theme-sm outline-none", s.done ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-300")}
              onBlur={(e) => e.target.value.trim() && e.target.value !== s.title && void save(() => call("todo.stepUpdate", { id: s.id, title: e.target.value }))}
            />
            <button type="button" title="Remover a etapa" onClick={() => void save(() => call("todo.stepDelete", { id: s.id }))} className="text-gray-300 opacity-0 hover:text-error-600 group-hover:opacity-100">
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mb-4 flex items-center gap-2 px-1">
        <Plus size={15} className="text-brand-500" />
        <input
          ref={stepInput}
          data-todo-step-add
          className="flex-1 bg-transparent text-theme-sm outline-none placeholder:text-brand-500"
          placeholder={t.steps.length ? "Próxima etapa" : "Adicionar etapa"}
          value={step}
          onChange={(e) => setStep(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !step.trim()) return;
            const v = step;
            setStep("");
            void save(() => call("todo.stepAdd", { taskId: id, title: v })).then(() => stepInput.current?.focus());
          }}
        />
      </div>

      <div className="space-y-3 border-t border-gray-100 pt-3 dark:border-gray-800">
        <label className="block text-theme-xs font-medium text-gray-600 dark:text-gray-400">
          Data de vencimento
          <span className="mt-1 flex items-center gap-2">
            <TaInput type="date" data-todo-due value={t.due_date ?? ""} onChange={(e) => void patch({ dueDate: e.target.value || null })} />
            {t.due_date && (
              <button type="button" title="Tirar a data" onClick={() => void patch({ dueDate: null })} className="text-gray-400 hover:text-error-600">
                <X size={16} />
              </button>
            )}
          </span>
        </label>
        <label className="block text-theme-xs font-medium text-gray-600 dark:text-gray-400">
          Lista
          <select
            data-todo-move
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
            value={t.list_id ?? ""}
            onChange={(e) => void patch({ listId: e.target.value || null })}
          >
            <option value="">Tarefas</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-theme-xs font-medium text-gray-600 dark:text-gray-400">
          Observações
          <textarea
            data-todo-notes
            rows={5}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-theme-sm text-gray-800 outline-none focus:border-brand-300 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            placeholder="Adicionar observação"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (t.notes ?? "") && void patch({ notes })}
          />
        </label>
      </div>

      {error && <p className="mt-2 rounded-lg bg-error-50 px-3 py-2 text-theme-xs text-error-700">{error}</p>}

      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-theme-xs text-gray-500 dark:border-gray-800">
        <button type="button" title="Fechar" onClick={onClose} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-white/5">
          <X size={16} />
        </button>
        <span>
          Criada em {formatDate(t.created_at)}
          {!!t.done && t.done_at && ` · concluída em ${formatDate(t.done_at)}`}
        </span>
        <button
          type="button"
          title="Excluir a tarefa (vai para a lixeira)"
          data-todo-delete
          onClick={async () => {
            if (!confirm(`Excluir "${t.title}"? Vai para a lixeira, de onde pode ser restaurada.`)) return;
            try {
              await call("todo.taskDelete", { id });
              onDeleted();
            } catch (e) {
              setError(errorText(e));
            }
          }}
          className="rounded p-1 hover:bg-error-50 hover:text-error-600"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </aside>
  );
}
