// To Do (spec 15): lista pessoal de afazeres, separada das Atividades do CRM
// (benchmark: Microsoft To Do). Esquerda: listas inteligentes (Meu Dia,
// Importante, Planejado, Todas, Tarefas) e "Minhas listas"; centro: adicionar,
// tarefas abertas e "Concluída" — no Meu Dia, também as atividades do CRM de
// hoje; direita: detalhes da tarefa ou as sugestões do Meu Dia.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Bell, Briefcase, CheckSquare, User, CalendarDays, Check, ChevronDown, Folder, FolderPlus, GripVertical, Home, Infinity as InfinityIcon, Lightbulb, ListTodo, MoreHorizontal, NotebookPen, Plus, Repeat, Search, Star, Sun, Trash2, X } from "lucide-react";
import { TaInput, cn } from "@tailadmin";
import { call, DATA_CHANGED_EVENT } from "../../rpc/client";
import type { TodoArrangeItem, TodoGroup, TodoList, TodoSmart, TodoStep, TodoSuggestions, TodoTask, TodoView as View } from "../../db/todo";
import type { ActivityListItem } from "../../db/activities";
import { ActivityIcon } from "../../lib/activityIcons";
import { useSession } from "../session";
import { searchLinks, TaskModal } from "../tasks/TaskModal";
import { Combobox } from "../ui/Combobox";
import { useDocumentNav } from "../documents/docUi";
import { dueLabel, parseRecurrence, PLANNED_GROUPS, plannedGroup, recurrenceLabel, sortTasks, TODO_SORTS, todayYmd, type Recurrence, type TodoSortBy } from "../../lib/todo";
import { TODO_CHANGED_EVENT } from "./useTodoBadge";
import { errorText } from "../../lib/errors";
import { formatDate } from "../../lib/format";
import { Popover } from "../ui/Popover";

const SMART: { id: TodoSmart; label: string; icon: React.ReactNode }[] = [
  { id: "meudia", label: "Meu Dia", icon: <Sun size={17} /> },
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
const SORT_KEY = "conectcrm-todo-sort";
const GROUPS_CLOSED_KEY = "conectcrm-todo-groups-closed";
type SortPref = { by: TodoSortBy; dir: "asc" | "desc" };
const viewKey = (v: View) => ("smart" in v ? `smart:${v.smart}` : `list:${v.listId}`);
/** O que está sendo arrastado: uma tarefa, uma lista ou um grupo. */
type Drag = { kind: "task" | "list" | "group"; id: string } | null;

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

export function TodoView({ openId, onOpened }: { openId?: string | null; onOpened?: () => void } = {}) {
  const [lists, setLists] = useState<TodoList[]>([]);
  const [listGroups, setListGroups] = useState<TodoGroup[]>([]);
  const [closedGroups, setClosedGroups] = useState<string[]>(() => readPref(GROUPS_CLOSED_KEY, []));
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [sorts, setSorts] = useState<Record<string, SortPref>>(() => readPref(SORT_KEY, {}));
  const [drag, setDrag] = useState<Drag>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<TodoSmart, number>>({ meudia: 0, importante: 0, planejado: 0, todas: 0, tarefas: 0 });
  const [view, setViewState] = useState<View>(() => readPref<View>(VIEW_KEY, { smart: "meudia" }));
  const [tasks, setTasks] = useState<{ open: TodoTask[]; done: TodoTask[] }>({ open: [], done: [] });
  const [selected, setSelectedState] = useState<string | null>(null);
  // Painel da direita: detalhes da tarefa ou sugestões do Meu Dia (um de cada vez).
  const [suggest, setSuggest] = useState(false);
  const setSelected = (id: string | null) => {
    setSelectedState(id);
    if (id) setSuggest(false);
  };
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newList, setNewList] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(() => readPref(DONE_KEY, false));
  const [error, setError] = useState<string | null>(null);

  const setView = (v: View) => {
    setViewState(v);
    setSelected(null);
    setSuggest(false);
    writePref(VIEW_KEY, v);
  };

  const loadLists = useCallback(async () => {
    const r = await call("todo.lists");
    setLists(r.lists);
    setListGroups(r.groups);
    setCounts(r.counts);
    window.dispatchEvent(new Event(TODO_CHANGED_EVENT));
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
  // Clique no lembrete (?todo=<id>): abre a tarefa.
  useEffect(() => {
    if (!openId) return;
    setSelected(openId);
    onOpened?.();
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const sideItems = useMemo(
    () =>
      [
        ...lists.filter((l) => !l.group_id).map((l) => ({ kind: "list" as const, pos: l.position, list: l })),
        ...listGroups.map((g) => ({ kind: "group" as const, pos: g.position, group: g, lists: lists.filter((l) => l.group_id === g.id) })),
      ].sort((a, b) => a.pos - b.pos),
    [lists, listGroups],
  );
  const toggleGroup = (id: string) => {
    const next = closedGroups.includes(id) ? closedGroups.filter((x) => x !== id) : [...closedGroups, id];
    setClosedGroups(next);
    writePref(GROUPS_CLOSED_KEY, next);
  };
  const currentList = "listId" in view ? lists.find((l) => l.id === view.listId) : undefined;
  const title = "smart" in view ? SMART.find((s) => s.id === view.smart)!.label : (currentList?.name ?? "Lista");
  const accent = currentList ? (COLOR[currentList.color] ?? COLOR.blue) : COLOR.blue;
  const showList = "smart" in view;
  const isMyDay = "smart" in view && view.smart === "meudia";
  const today = todayYmd();

  const addTask = () => {
    const t = newTitle.trim();
    if (!t) return;
    setNewTitle("");
    void run(() =>
      call("todo.taskCreate", {
        title: t,
        listId: "listId" in view ? view.listId : null,
        important: "smart" in view && view.smart === "importante",
        myDay: isMyDay,
        dueDate: "smart" in view && view.smart === "planejado" ? todayYmd() : null,
      }),
    );
  };
  const toggleDone = (t: TodoTask) => void run(() => call("todo.taskUpdate", { id: t.id, patch: { done: !t.done } }));
  const toggleStar = (t: TodoTask) => void run(() => call("todo.taskUpdate", { id: t.id, patch: { important: !t.important } }));

  // Ordenar (por lista; padrão: ordem manual, de arrastar).
  const sort: SortPref = sorts[viewKey(view)] ?? { by: "manual", dir: "asc" };
  const setSort = (p: SortPref | null) => {
    const next = { ...sorts };
    if (p && p.by !== "manual") next[viewKey(view)] = p;
    else delete next[viewKey(view)];
    setSorts(next);
    writePref(SORT_KEY, next);
  };
  const openSorted = useMemo(() => sortTasks(tasks.open, sort.by, sort.dir), [tasks.open, sort.by, sort.dir]);
  const canReorder = sort.by === "manual" && !search;

  // Planejado: grupos por vencimento.
  const groups = useMemo(() => {
    if (!("smart" in view && view.smart === "planejado")) return [["", openSorted] as const];
    const today = todayYmd();
    return PLANNED_GROUPS.map((g) => [g, openSorted.filter((t) => t.due_date && plannedGroup(t.due_date, today) === g)] as const).filter(([, l]) => l.length);
  }, [openSorted, view]);

  // ---------- Arrastar ----------
  const endDrag = () => {
    setDrag(null);
    setDropOn(null);
  };
  /** Menu de listas como está: listas soltas e grupos, na ordem. */
  const arrangement = (): TodoArrangeItem[] => sideItems.map((it) => (it.kind === "list" ? { list: it.list.id } : { group: it.group.id, lists: it.lists.map((l) => l.id) }));
  const saveArrangement = (items: TodoArrangeItem[]) => void run(() => call("todo.arrange", { items }));
  /** Tira a lista de onde está (solta ou num grupo). */
  const without = (items: TodoArrangeItem[], listId: string): TodoArrangeItem[] =>
    items.filter((it) => !("list" in it && it.list === listId)).map((it) => ("group" in it ? { ...it, lists: it.lists.filter((l) => l !== listId) } : it));
  /** Soltou sobre uma lista do menu. */
  const dropOnList = (target: TodoList) => {
    const d = drag;
    endDrag();
    if (!d || d.id === target.id) return;
    if (d.kind === "task") return void moveTaskTo({ listId: target.id });
    if (d.kind === "list") {
      const items = without(arrangement(), d.id);
      if (target.group_id) {
        const g = items.find((it) => "group" in it && it.group === target.group_id) as { group: string; lists: string[] };
        g.lists.splice(g.lists.indexOf(target.id), 0, d.id);
      } else items.splice(items.findIndex((it) => "list" in it && it.list === target.id), 0, { list: d.id });
      return saveArrangement(items);
    }
    // Grupo solto sobre uma lista: vai para antes dela (ou do grupo dela).
    const items = arrangement();
    const moving = items.find((it) => "group" in it && it.group === d.id)!;
    const rest = items.filter((it) => it !== moving);
    const at = rest.findIndex((it) => ("list" in it ? it.list === target.id : it.group === target.group_id));
    rest.splice(at < 0 ? rest.length : at, 0, moving);
    saveArrangement(rest);
  };
  /** Soltou sobre o título de um grupo: a lista entra no fim dele; o grupo vai para antes. */
  const dropOnGroup = (groupId: string) => {
    const d = drag;
    endDrag();
    if (!d || d.id === groupId) return;
    if (d.kind === "list") {
      const items = without(arrangement(), d.id);
      (items.find((it) => "group" in it && it.group === groupId) as { lists: string[] }).lists.push(d.id);
      setClosedGroups((c) => c.filter((x) => x !== groupId));
      return saveArrangement(items);
    }
    if (d.kind === "group") {
      const items = arrangement();
      const moving = items.find((it) => "group" in it && it.group === d.id)!;
      const rest = items.filter((it) => it !== moving);
      rest.splice(rest.findIndex((it) => "group" in it && it.group === groupId), 0, moving);
      saveArrangement(rest);
    }
  };
  /** Soltou no fim do menu: lista sai do grupo e vai para o fim; grupo vai para o fim. */
  const dropAtEnd = () => {
    const d = drag;
    endDrag();
    if (!d || d.kind === "task") return;
    const items = d.kind === "list" ? without(arrangement(), d.id) : arrangement().filter((it) => !("group" in it && it.group === d.id));
    items.push(d.kind === "list" ? { list: d.id } : arrangement().find((it) => "group" in it && it.group === d.id)!);
    saveArrangement(items);
  };
  /** Tarefa solta numa lista inteligente ou numa lista. */
  const moveTaskTo = (patch: Record<string, unknown>) => {
    const id = drag?.id;
    endDrag();
    if (id) void run(() => call("todo.taskUpdate", { id, patch }));
  };
  const SMART_DROP: Partial<Record<TodoSmart, Record<string, unknown>>> = {
    meudia: { myDay: true },
    importante: { important: true },
    planejado: { dueDate: todayYmd() },
    tarefas: { listId: null },
  };
  /** Tarefa solta sobre outra (ordem manual): entra no lugar dela. */
  const dropOnTask = (target: TodoTask) => {
    const id = drag?.kind === "task" ? drag.id : null;
    endDrag();
    if (!id || id === target.id || !canReorder) return;
    const ids = openSorted.map((t) => t.id).filter((x) => x !== id);
    const from = openSorted.findIndex((t) => t.id === id);
    const to = openSorted.findIndex((t) => t.id === target.id);
    ids.splice(ids.indexOf(target.id) + (from < to ? 1 : 0), 0, id);
    void run(() => call("todo.taskReorder", { ids }));
  };
  const dropProps = (key: string, accept: boolean, onDrop: () => void) =>
    accept
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            if (dropOn !== key) setDropOn(key);
          },
          onDragLeave: () => dropOn === key && setDropOn(null),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            onDrop();
          },
        }
      : {};

  const row = (t: TodoTask) => {
    const due = t.due_date ? dueLabel(t.due_date) : null;
    return (
      <li
        key={t.id}
        data-todo-task={t.title}
        draggable={!t.done}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", t.title);
          setDrag({ kind: "task", id: t.id });
        }}
        onDragEnd={endDrag}
        {...dropProps(`task:${t.id}`, drag?.kind === "task" && canReorder && !t.done, () => dropOnTask(t))}
        className={cn(
          dropOn === `task:${t.id}` && "ring-2 ring-brand-300",
          drag?.kind === "task" && drag.id === t.id && "opacity-50",
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
          {(showList || due || t.steps_total > 0 || t.notes || t.my_day === today || t.remind_at || t.recurrence || crmLabel(t)) && (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-theme-xs text-gray-500">
              {!isMyDay && t.my_day === today && (
                <span className="flex items-center gap-1 text-brand-600">
                  <Sun size={12} /> Meu Dia
                </span>
              )}
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
              {t.remind_at && !t.done && (
                <span className={cn("flex items-center gap-1", !t.reminded_at && "text-brand-600")} title="Lembrete">
                  <Bell size={12} /> {remindText(t.remind_at)}
                </span>
              )}
              {t.recurrence && <Repeat size={12} aria-label="Repete" />}
              {crmLabel(t) && (
                <span className="flex items-center gap-1" title="Vinculada no CRM">
                  {t.deal_title && t.deal_title !== t.title ? <Briefcase size={12} /> : <User size={12} />} {crmLabel(t)}
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
              <SideItem
                active={"smart" in view && view.smart === s.id}
                icon={s.icon}
                label={s.label}
                count={counts[s.id]}
                onClick={() => setView({ smart: s.id })}
                highlight={dropOn === `smart:${s.id}`}
                drop={dropProps(`smart:${s.id}`, drag?.kind === "task" && !!SMART_DROP[s.id], () => moveTaskTo(SMART_DROP[s.id]!))}
              />
            </li>
          ))}
        </ul>
        <div className="my-2 border-t border-gray-100 dark:border-gray-800" />
        <ul className="space-y-0.5" data-todo-lists>
          {sideItems.map((it) => {
            const listItem = (l: TodoList, inGroup: boolean) => (
              <li key={l.id} className={inGroup ? "pl-4" : ""}>
                <SideItem
                  active={"listId" in view && view.listId === l.id}
                  icon={<ListTodo size={17} style={{ color: COLOR[l.color] ?? COLOR.blue }} />}
                  label={l.name}
                  count={l.pending}
                  onClick={() => setView({ listId: l.id })}
                  highlight={dropOn === `list:${l.id}`}
                  dragProps={{
                    draggable: true,
                    onDragStart: (e: React.DragEvent) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", l.name);
                      setDrag({ kind: "list", id: l.id });
                    },
                    onDragEnd: endDrag,
                  }}
                  drop={dropProps(`list:${l.id}`, !!drag && drag.id !== l.id, () => dropOnList(l))}
                />
              </li>
            );
            if (it.kind === "list") return listItem(it.list, false);
            const closed = closedGroups.includes(it.group.id);
            return (
              <li key={it.group.id} data-todo-group={it.group.name}>
                <GroupHeader
                  group={it.group}
                  closed={closed}
                  count={it.lists.length}
                  onToggle={() => toggleGroup(it.group.id)}
                  onChanged={() => void reload()}
                  onError={setError}
                  highlight={dropOn === `group:${it.group.id}`}
                  dragProps={{
                    draggable: true,
                    onDragStart: (e: React.DragEvent) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", it.group.name);
                      setDrag({ kind: "group", id: it.group.id });
                    },
                    onDragEnd: endDrag,
                  }}
                  drop={dropProps(`group:${it.group.id}`, !!drag && drag.kind !== "task" && drag.id !== it.group.id, () => dropOnGroup(it.group.id))}
                />
                {!closed && (
                  <ul className="space-y-0.5">
                    {it.lists.map((l) => listItem(l, true))}
                    {!it.lists.length && <li className="py-1 pl-10 text-theme-xs text-gray-400">Arraste listas para cá</li>}
                  </ul>
                )}
              </li>
            );
          })}
          {drag && drag.kind !== "task" && (
            <li
              data-todo-drop-end
              {...dropProps("end", true, dropAtEnd)}
              className={cn("rounded-lg border border-dashed px-3 py-1.5 text-center text-theme-xs text-gray-400", dropOn === "end" ? "border-brand-400 text-brand-600" : "border-gray-300")}
            >
              Soltar aqui (fora de grupo)
            </li>
          )}
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
        {newGroup === null ? (
          <button
            type="button"
            data-todo-new-group
            onClick={() => setNewGroup("")}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-theme-sm text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
          >
            <FolderPlus size={17} /> Novo grupo
          </button>
        ) : (
          <TaInput
            autoFocus
            className="mt-1"
            placeholder="Nome do grupo (Enter)"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            onBlur={() => !newGroup.trim() && setNewGroup(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setNewGroup(null);
              if (e.key !== "Enter" || !newGroup.trim()) return;
              const name = newGroup.trim();
              setNewGroup(null);
              void run(() => call("todo.groupCreate", { name, listIds: currentList ? [currentList.id] : [] }));
            }}
          />
        )}
      </aside>

      {/* Tarefas */}
      <section className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-gray-50 p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="flex min-w-0 items-center gap-2 text-2xl font-semibold" style={{ color: accent }} data-todo-title>
              {"smart" in view ? SMART.find((s) => s.id === view.smart)!.icon : <ListTodo size={22} />}
              <span className="truncate">{title}</span>
            </h1>
            {isMyDay && (
              <p className="mt-0.5 text-theme-sm text-gray-500" data-todo-today>
                {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
              </p>
            )}
          </div>
          {isMyDay && (
            <button
              type="button"
              data-todo-suggest
              onClick={() => {
                setSuggest(!suggest);
                setSelectedState(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-theme-sm font-medium",
                suggest ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15" : "text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-white/5",
              )}
            >
              <Lightbulb size={16} /> Sugestões
            </button>
          )}
          {currentList && (
            <ListMenu
              list={currentList}
              groups={listGroups}
              onMoveToGroup={(groupId) => {
                const items = without(arrangement(), currentList.id);
                if (groupId) (items.find((it) => "group" in it && it.group === groupId) as { lists: string[] }).lists.push(currentList.id);
                else items.push({ list: currentList.id });
                saveArrangement(items);
              }}
              onChanged={() => void reload()}
              onDeleted={() => setView({ smart: "tarefas" })}
              onError={setError}
            />
          )}
          <SortMenu value={sort} onChange={setSort} />
          <div className="relative ml-auto w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
            <TaInput className="pl-9" placeholder="Pesquisar nesta lista" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {sort.by !== "manual" && (
          <div className="mb-3 flex items-center gap-1 text-theme-xs text-gray-600 dark:text-gray-400" data-todo-sorted>
            <button
              type="button"
              title="Inverter a ordem"
              data-todo-sort-dir
              onClick={() => setSort({ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" })}
              className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white dark:hover:bg-white/5"
            >
              {sort.dir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
              Ordenado por: {TODO_SORTS.find((x) => x.id === sort.by)?.label.toLowerCase()}
            </button>
            <button type="button" title="Voltar à ordem manual" data-todo-sort-clear onClick={() => setSort(null)} className="rounded p-1 hover:bg-white hover:text-error-600 dark:hover:bg-white/5">
              <X size={13} />
            </button>
          </div>
        )}

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
          <p className="py-10 text-center text-theme-sm text-gray-500">
            {search
              ? "Nada encontrado."
              : isMyDay
                ? "Concentre-se no seu dia: escreva acima ou veja as Sugestões."
                : "Nenhuma tarefa aqui. Escreva acima e tecle Enter."}
          </p>
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

        {isMyDay && !search && <CrmToday />}
      </section>

      {suggest && isMyDay && !selected && (
        <SuggestionsPanel
          onClose={() => setSuggest(false)}
          onAdd={(id) => void run(() => call("todo.taskUpdate", { id, patch: { myDay: true } }))}
          refreshKey={counts.meudia}
        />
      )}

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

type DropProps = Partial<Pick<React.HTMLAttributes<HTMLElement>, "onDragOver" | "onDragLeave" | "onDrop">>;
type DragProps = { draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void };

function SideItem({
  active,
  icon,
  label,
  count,
  onClick,
  highlight,
  drop,
  dragProps,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
  highlight?: boolean;
  drop?: DropProps;
  dragProps?: DragProps;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...dragProps}
      {...drop}
      data-todo-side={label}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-theme-sm",
        active ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5",
        highlight && "ring-2 ring-brand-400",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && <span className="text-theme-xs text-gray-500">{count}</span>}
      {dragProps?.draggable && <GripVertical size={13} className="-mr-1.5 shrink-0 cursor-grab text-gray-300 opacity-0 group-hover:opacity-100" aria-hidden />}
    </button>
  );
}

/** Título do grupo de listas: recolher, renomear, desagrupar. */
function GroupHeader({
  group,
  closed,
  count,
  onToggle,
  onChanged,
  onError,
  highlight,
  drop,
  dragProps,
}: {
  group: TodoGroup;
  closed: boolean;
  count: number;
  onToggle: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
  highlight?: boolean;
  drop?: DropProps;
  dragProps?: DragProps;
}) {
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
  if (name !== null)
    return (
      <TaInput
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setName(null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setName(null);
          if (e.key === "Enter") {
            const v = name;
            setName(null);
            void act(() => call("todo.groupRename", { id: group.id, name: v }));
          }
        }}
      />
    );
  return (
    <div
      {...dragProps}
      {...drop}
      className={cn("group relative flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-theme-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5", highlight && "ring-2 ring-brand-400")}
    >
      <button type="button" aria-expanded={!closed} data-todo-group-toggle onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <ChevronDown size={15} className={cn("shrink-0 text-gray-400 transition-transform", closed && "-rotate-90")} />
        <Folder size={16} className="shrink-0 text-gray-500" />
        <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
        {closed && count > 0 && <span className="text-theme-xs text-gray-400">{count} {count === 1 ? "lista" : "listas"}</span>}
      </button>
      <button type="button" title="Opções do grupo" data-todo-group-menu onClick={() => setOpen(!open)} className="rounded p-0.5 text-gray-400 opacity-0 hover:text-gray-700 group-hover:opacity-100">
        <MoreHorizontal size={15} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="right-0 top-8 w-52 py-1">
        <button
          type="button"
          className="block w-full px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5"
          onClick={() => {
            setOpen(false);
            setName(group.name);
          }}
        >
          Renomear grupo
        </button>
        <button
          type="button"
          data-todo-group-delete
          className="block w-full px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5"
          onClick={() => {
            setOpen(false);
            void act(() => call("todo.groupDelete", { id: group.id }));
          }}
        >
          Desagrupar listas
        </button>
      </Popover>
    </div>
  );
}

/** "Ordenar": importância, vencimento, alfabética, criação (por lista). */
function SortMenu({ value, onChange }: { value: SortPref; onChange: (p: SortPref | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        title="Ordenar"
        data-todo-sort
        onClick={() => setOpen(!open)}
        className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-theme-sm", value.by !== "manual" ? "text-brand-600" : "text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-white/5")}
      >
        <ArrowUpDown size={16} /> Ordenar
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-56 py-1">
        <p className="px-3.5 pb-1 pt-1.5 text-theme-xs font-semibold uppercase text-gray-400">Ordenar por</p>
        {TODO_SORTS.map((o) => (
          <button
            key={o.id}
            type="button"
            data-todo-sort-by={o.id}
            onClick={() => {
              setOpen(false);
              onChange({ by: o.id, dir: "asc" });
            }}
            className={cn("flex w-full items-center justify-between px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5", value.by === o.id && "text-brand-600")}
          >
            {o.label}
            {value.by === o.id && <Check size={14} />}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onChange(null);
          }}
          className={cn("flex w-full items-center justify-between border-t border-gray-100 px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/5", value.by === "manual" && "text-brand-600")}
        >
          Manual (arrastar)
          {value.by === "manual" && <Check size={14} />}
        </button>
      </Popover>
    </div>
  );
}

/** "…" da lista: renomear, cor e excluir. */
function ListMenu({
  list,
  groups,
  onMoveToGroup,
  onChanged,
  onDeleted,
  onError,
}: {
  list: TodoList;
  groups: TodoGroup[];
  onMoveToGroup: (groupId: string | null) => void;
  onChanged: () => void;
  onDeleted: () => void;
  onError: (m: string) => void;
}) {
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
        {groups.length > 0 && (
          <label className="block border-t border-gray-100 px-3.5 py-2 text-theme-xs text-gray-500 dark:border-gray-800">
            Grupo
            <select
              data-todo-list-group
              className="mt-1 h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-theme-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              value={list.group_id ?? ""}
              onChange={(e) => {
                setOpen(false);
                onMoveToGroup(e.target.value || null);
              }}
            >
              <option value="">Sem grupo</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
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

      <button
        type="button"
        data-todo-myday
        onClick={() => void patch({ myDay: t.my_day !== todayYmd() })}
        className={cn(
          "mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-theme-sm",
          t.my_day === todayYmd()
            ? "border-brand-200 bg-brand-25 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
            : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5",
        )}
      >
        <Sun size={16} />
        <span className="flex-1">{t.my_day === todayYmd() ? "Adicionada a Meu Dia" : "Adicionar a Meu Dia"}</span>
        {t.my_day === todayYmd() && <X size={14} aria-label="Tirar de Meu Dia" />}
      </button>

      <CrmLinks t={t} onPatch={(p) => void patch(p)} />

      <ReminderField value={t.remind_at} reminded={!!t.reminded_at && !t.done} onChange={(v) => void patch({ remindAt: v })} />
      <RepeatField value={parseRecurrence(t.recurrence)} due={t.due_date} onChange={(v) => void patch({ recurrence: v })} />

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
          <span className="mt-1.5 block">
            <QuickDates onPick={(d) => void patch({ dueDate: d })} />
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

/**
 * Meu Dia: as atividades do CRM de hoje (começam ou terminam hoje, sem as
 * atrasadas — a mesma regra do filtro "Hoje" de Atividades). Concluir e abrir
 * agem na própria atividade; nada é copiado para o To Do.
 */
function CrmToday() {
  const { user } = useSession();
  const [items, setItems] = useState<ActivityListItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => readPref("conectcrm-todo-crm-closed", false));
  const load = useCallback(async () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const from = t.toISOString();
    const to = new Date(t.getTime() + 86400_000).toISOString();
    setItems(await call("activities.list", { from, to, dayOnly: true, ownerIds: [user.id], limit: 200 }));
  }, [user.id]);
  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener(DATA_CHANGED_EVENT, on);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, on);
  }, [load]);
  if (!items.length) return null;
  const pending = items.filter((a) => !a.done).length;
  const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-800" data-todo-crm>
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => {
          setCollapsed(!collapsed);
          writePref("conectcrm-todo-crm-closed", !collapsed);
        }}
        className="mb-1.5 flex items-center gap-1.5 rounded px-1 text-theme-sm font-semibold text-gray-700 hover:bg-white dark:text-gray-300 dark:hover:bg-white/5"
      >
        <ChevronDown size={16} className={cn("transition-transform", collapsed && "-rotate-90")} />
        Atividades do CRM hoje <span className="font-normal text-gray-500">{pending}</span>
      </button>
      {!collapsed && (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <li key={a.id} data-todo-crm-item={a.title} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-theme-xs dark:bg-gray-900">
              <button
                type="button"
                title={a.done ? "Reabrir a atividade" : "Concluir a atividade"}
                onClick={async () => {
                  await call("activities.setDone", { id: a.id, done: !a.done });
                  await load();
                }}
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                  a.done ? "border-success-500 bg-success-500 text-white" : "border-gray-400 text-transparent hover:text-gray-400",
                )}
              >
                <Check size={12} strokeWidth={3} />
              </button>
              <span className="text-brand-500">
                <ActivityIcon name={a.type_icon} />
              </span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(a.id)} title="Abrir a atividade">
                <span className={cn("block truncate text-theme-sm", a.done ? "text-gray-400 line-through" : "text-gray-800 dark:text-white/90")}>{a.title}</span>
                <span className="block truncate text-theme-xs text-gray-500">
                  {time(a.due_at)} · {a.type_name}
                  {a.deal_title ? ` · ${a.deal_title}` : a.person_name ? ` · ${a.person_name}` : ""}
                </span>
              </button>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase text-gray-500 dark:bg-white/5">CRM</span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <TaskModal
          request={{ id: open }}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/** Lâmpada do Meu Dia: o que ficou de dias anteriores, o que vence e as importantes. */
function SuggestionsPanel({ onClose, onAdd, refreshKey }: { onClose: () => void; onAdd: (id: string) => void; refreshKey: number }) {
  const [s, setS] = useState<TodoSuggestions | null>(null);
  useEffect(() => {
    void call("todo.suggestions").then(setS);
  }, [refreshKey]);
  const groups: [string, TodoTask[]][] = s
    ? [
        ["De dias anteriores", s.earlier],
        ["Vencem hoje ou atrasadas", s.due],
        ["Importantes", s.important],
      ]
    : [];
  const empty = s && !s.earlier.length && !s.due.length && !s.important.length;
  return (
    <aside data-todo-suggestions className="w-[340px] shrink-0 self-start rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-white/90">
          <Lightbulb size={18} className="text-warning-500" /> Sugestões
        </h2>
        <button type="button" title="Fechar" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5">
          <X size={16} />
        </button>
      </div>
      {empty && <p className="text-theme-sm text-gray-500">Nada para sugerir agora. Tarefas antigas do Meu Dia, as que vencem e as importantes aparecem aqui.</p>}
      {groups
        .filter(([, l]) => l.length)
        .map(([g, l]) => (
          <div key={g} className="mb-3">
            <h3 className="mb-1 text-theme-xs font-semibold uppercase text-gray-500">{g}</h3>
            <ul className="space-y-1">
              {l.map((t) => {
                const due = t.due_date ? dueLabel(t.due_date) : null;
                return (
                  <li key={t.id} data-todo-suggestion={t.title} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-white/5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-theme-sm text-gray-800 dark:text-white/90">{t.title}</span>
                      <span className="block truncate text-theme-xs text-gray-500">
                        {t.list_name ?? "Tarefas"}
                        {due && <span className={due.tone === "danger" ? "text-error-600" : ""}> · {due.text}</span>}
                      </span>
                    </span>
                    <button
                      type="button"
                      title="Adicionar a Meu Dia"
                      aria-label="Adicionar a Meu Dia"
                      onClick={() => onAdd(t.id)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/15"
                    >
                      <Plus size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </aside>
  );
}

// ---------- Lembrete e repetir (fase 3) ----------

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO → valor do <input type="datetime-local"> (hora local). */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${todayYmd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const at = (days: number, h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d;
};
const nextMonday = () => (8 - new Date().getDay()) % 7 || 7;

/** "Hoje 14:30", "Amanhã 09:00", "sex., 28/11 09:00". */
function remindText(iso: string): string {
  const d = new Date(iso);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const ymd = todayYmd(d);
  if (ymd === todayYmd()) return `Hoje ${hm}`;
  if (ymd === todayYmd(at(1, 0))) return `Amanhã ${hm}`;
  return `${dueLabel(ymd).text.replace(/^Atrasada · /, "")} ${hm}`;
}

function QuickDates({ onPick }: { onPick: (ymd: string) => void }) {
  const opts: [string, Date][] = [
    ["Hoje", at(0, 0)],
    ["Amanhã", at(1, 0)],
    ["Próx. semana", at(nextMonday(), 0)],
  ];
  return (
    <span className="flex gap-1">
      {opts.map(([label, d]) => (
        <button
          key={label}
          type="button"
          data-todo-due-quick={label}
          onClick={() => onPick(todayYmd(d))}
          className="whitespace-nowrap rounded-md border border-gray-200 px-1.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          {label}
        </button>
      ))}
    </span>
  );
}

/** "Lembrar-me": atalhos (mais tarde hoje, amanhã 9h, próxima semana) ou data e hora. */
function ReminderField({ value, reminded, onChange }: { value: string | null; reminded: boolean; onChange: (iso: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const later = at(0, new Date().getHours() + 3);
  const quick: [string, Date][] = [
    ...(later.getDate() === new Date().getDate() ? ([[`Mais tarde hoje (${pad(later.getHours())}:00)`, later]] as [string, Date][]) : []),
    ["Amanhã (09:00)", at(1, 9)],
    ["Próxima semana (seg., 09:00)", at(nextMonday(), 9)],
  ];
  return (
    <div className="mb-2 rounded-lg border border-gray-200 dark:border-gray-800" data-todo-remind>
      <div className="flex items-center gap-2 px-3 py-2">
        <Bell size={16} className={value ? "text-brand-500" : "text-gray-500"} />
        <button type="button" onClick={() => setOpen(!open)} className={cn("flex-1 text-left text-theme-sm", value ? "text-brand-700 dark:text-brand-300" : "text-gray-600 dark:text-gray-300")}>
          {value ? (
            <>
              Lembrete: {remindText(value)}
              {reminded && <span className="block text-theme-xs text-gray-500">Lembrete já enviado</span>}
            </>
          ) : (
            "Lembrar-me"
          )}
        </button>
        {value && (
          <button type="button" title="Tirar o lembrete" data-todo-remind-clear onClick={() => onChange(null)} className="text-gray-400 hover:text-error-600">
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-1 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
          {quick.map(([label, d]) => (
            <button
              key={label}
              type="button"
              data-todo-remind-quick={label}
              onClick={() => {
                onChange(d.toISOString());
                setOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
            >
              {label}
            </button>
          ))}
          <label className="block px-2 pt-1 text-theme-xs text-gray-500">
            Escolher data e hora
            <TaInput
              type="datetime-local"
              data-todo-remind-input
              defaultValue={value ? toLocalInput(value) : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v && !Number.isNaN(new Date(v).getTime())) onChange(new Date(v).toISOString());
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

const WEEK = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEK_FULL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "Repetir": diariamente, dias da semana, semanal, mensal, anual ou personalizado. */
function RepeatField({ value, due, onChange }: { value: Recurrence | null; due: string | null; onChange: (r: Recurrence | null) => void }) {
  const [custom, setCustom] = useState(false);
  const dueDow = due ? new Date(`${due}T12:00:00`).getDay() : new Date().getDay();
  const presets: [string, Recurrence][] = [
    ["Diariamente", { every: 1, unit: "day" }],
    ["Dias da semana", { every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5] }],
    ["Semanalmente", { every: 1, unit: "week" }],
    ["Mensalmente", { every: 1, unit: "month" }],
    ["Anualmente", { every: 1, unit: "year" }],
  ];
  const current = value ? presets.findIndex(([, r]) => JSON.stringify(r) === JSON.stringify(value)) : -1;
  const draft: Recurrence = value ?? { every: 1, unit: "week", weekdays: [dueDow] };
  const set = (r: Partial<Recurrence>) => onChange(parseRecurrence({ ...draft, ...r }));
  return (
    <div className="mb-3 rounded-lg border border-gray-200 dark:border-gray-800" data-todo-repeat>
      <div className="flex items-center gap-2 px-3 py-2">
        <Repeat size={16} className={value ? "text-brand-500" : "text-gray-500"} />
        <select
          data-todo-repeat-select
          className={cn("flex-1 bg-transparent text-theme-sm outline-none", value ? "text-brand-700 dark:text-brand-300" : "text-gray-600 dark:text-gray-300")}
          value={custom || (value && current < 0) ? "custom" : current >= 0 ? String(current) : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "custom") {
              setCustom(true);
              if (!value) onChange(draft);
            } else {
              setCustom(false);
              onChange(v === "" ? null : presets[Number(v)]![1]);
            }
          }}
        >
          <option value="">Repetir</option>
          {presets.map(([label], i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
          <option value="custom">Personalizado…</option>
        </select>
        {value && (
          <button
            type="button"
            title="Não repetir"
            onClick={() => {
              setCustom(false);
              onChange(null);
            }}
            className="text-gray-400 hover:text-error-600"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {value && (custom || current < 0) && (
        <div className="space-y-2 border-t border-gray-100 px-3 py-2 text-theme-sm dark:border-gray-800" data-todo-repeat-custom>
          <div className="flex items-center gap-2">
            A cada
            <input
              type="number"
              min={1}
              max={99}
              data-todo-repeat-every
              className="h-8 w-14 rounded-md border border-gray-300 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"
              value={value.every}
              onChange={(e) => set({ every: Number(e.target.value) || 1 })}
            />
            <select
              data-todo-repeat-unit
              className="h-8 rounded-md border border-gray-300 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"
              value={value.unit}
              onChange={(e) => set({ unit: e.target.value as Recurrence["unit"], weekdays: e.target.value === "week" ? [dueDow] : undefined })}
            >
              <option value="day">{value.every > 1 ? "dias" : "dia"}</option>
              <option value="week">{value.every > 1 ? "semanas" : "semana"}</option>
              <option value="month">{value.every > 1 ? "meses" : "mês"}</option>
              <option value="year">{value.every > 1 ? "anos" : "ano"}</option>
            </select>
          </div>
          {value.unit === "week" && (
            <div className="flex gap-1">
              {WEEK.map((l, i) => {
                const on = value.weekdays?.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    title={WEEK_FULL[i]}
                    data-todo-repeat-day={i}
                    onClick={() => {
                      const cur = value.weekdays ?? [];
                      const next = on ? cur.filter((x) => x !== i) : [...cur, i];
                      set({ weekdays: next.length ? next : undefined });
                    }}
                    className={cn("h-7 w-7 rounded-full text-[11px] font-semibold", on ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300")}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {value && <p className="px-3 pb-2 text-theme-xs text-gray-500">{recurrenceLabel(value)} · ao concluir, cria a próxima</p>}
    </div>
  );
}

// ---------- Vínculos com o CRM (fase 5) ----------

/** Negócio/contato ligados, atividade do CRM ligada e "Criar atividade no CRM". */
function CrmLinks({ t, onPatch }: { t: Detail; onPatch: (p: Record<string, unknown>) => void }) {
  const nav = useDocumentNav();
  const [modal, setModal] = useState<"new" | "open" | null>(null);
  const [linking, setLinking] = useState(false);
  const chip = "flex min-w-0 items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1 text-theme-xs text-gray-700 hover:bg-brand-50 hover:text-brand-700 dark:bg-white/5 dark:text-gray-300";
  return (
    <div className="mb-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800" data-todo-crm-links>
      <p className="mb-1.5 text-theme-xs font-medium text-gray-600 dark:text-gray-400">No CRM</p>
      <div className="flex flex-wrap gap-1.5">
        {t.deal_id && t.deal_title && (
          <span className="flex min-w-0 items-center">
            <button type="button" data-todo-link-deal className={chip} title="Abrir o cartão" onClick={() => t.pipeline_id && nav?.openCard(t.pipeline_id, t.deal_id!)}>
              <Briefcase size={12} className="shrink-0" /> <span className="truncate">{t.deal_title}</span>
            </button>
            <button type="button" title="Desvincular" onClick={() => onPatch({ dealId: null })} className="ml-0.5 text-gray-300 hover:text-error-600">
              <X size={12} />
            </button>
          </span>
        )}
        {t.person_id && t.person_name && (
          <span className="flex min-w-0 items-center">
            <button type="button" data-todo-link-person className={chip} title="Abrir o contato" onClick={() => nav?.openPerson(t.person_id!)}>
              <User size={12} className="shrink-0" /> <span className="truncate">{t.person_name}</span>
            </button>
            <button type="button" title="Desvincular" onClick={() => onPatch({ personId: null })} className="ml-0.5 text-gray-300 hover:text-error-600">
              <X size={12} />
            </button>
          </span>
        )}
        {t.activity_id && t.activity_done !== null && (
          <button type="button" data-todo-link-activity className={chip} title="Abrir a atividade do CRM" onClick={() => setModal("open")}>
            <CheckSquare size={12} className="shrink-0" /> Atividade {t.activity_done ? "concluída" : "pendente"}
          </button>
        )}
      </div>
      {linking ? (
        <div className="mt-2" data-todo-link-search>
          <Combobox
            value={null}
            search={searchLinks}
            placeholder="Buscar negócio, ticket, projeto ou contato"
            onChange={(item) => {
              setLinking(false);
              if (!item) return;
              const [kind, id] = item.id.split(":");
              onPatch(kind === "deal" ? { dealId: id } : { personId: id });
            }}
          />
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          <button type="button" data-todo-link-add onClick={() => setLinking(true)} className="text-theme-xs text-brand-600 hover:underline">
            Vincular a negócio ou contato
          </button>
          {(!t.activity_id || t.activity_done === null) && (
            <button type="button" data-todo-make-activity onClick={() => setModal("new")} className="text-theme-xs text-brand-600 hover:underline">
              Criar atividade no CRM
            </button>
          )}
        </div>
      )}
      {modal === "new" && (
        <TaskModal
          request={{ fromTodo: { title: t.title, description: t.notes, dueDate: t.due_date }, dealId: t.deal_id ?? undefined, personId: t.person_id ?? undefined }}
          onClose={() => setModal(null)}
          onCreated={(id) => onPatch({ activityId: id })}
          onSaved={() => setModal(null)}
        />
      )}
      {modal === "open" && t.activity_id && (
        <TaskModal
          request={{ id: t.activity_id }}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            onPatch({});
          }}
        />
      )}
    </div>
  );
}

/** Vínculo mostrado na linha: o cartão (se o nome não repete o título) ou o contato. */
function crmLabel(t: TodoTask): string | null {
  if (t.deal_title && t.deal_title !== t.title) return t.deal_title;
  return t.person_name;
}
