// Menu GED - Gerenciamento eletrônico de documentos (spec 08): busca livre
// em qualquer campo, filtros (classificação, funil, cartão, contato,
// organização, tarefa, formato, validade, quem enviou, período, palavras-
// chave), lista ou grade com miniaturas, ações em lote, prévia, versões,
// auditoria e lixeira. Os filtros ficam na URL (#ged?...).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  CalendarClock,
  Download,
  FileQuestion,
  Files,
  KeyRound,
  LayoutGrid,
  List,
  Search,
  Tags,
  Trash2,
  Unlink,
  Upload,
  X,
} from "lucide-react";
import { TaButton, TaInput, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { DocFormat, DocLink, DocumentFilter, DocumentListItem, DocumentStats, DocumentType, DocValidity } from "../../db/documents";
import type { Pipeline } from "../../db/pipelines";
import { PIPELINE_TYPE_LABEL, PIPELINE_TYPE_ORDER } from "../../lib/cardTypes";
import { deleteOrphans, downloadZip, fetchVersion, isImage, isPdf, runDocumentMaintenance } from "../../lib/documentFiles";
import { documentsFolderStatus, requestDocumentsFolderAccess } from "../../lib/fileStore";
import { formatBytes } from "../../lib/files";
import { formatDateTime } from "../../lib/format";
import { pdfThumbnail } from "../../lib/pdf";
import { useSession } from "../session";
import { TagPicker } from "../ui/TagPicker";
import { DocumentViewer } from "./DocumentViewer";
import { FileTypeIcon, LINK_TYPE_LABEL, LinkChip, LinkIcon, RestrictedBadge, TypeBadge, ValidityBadge } from "./docUi";
import { UploadModal } from "./UploadModal";
import { errorText } from "../../lib/errors";

const PAGE = 25;

type Filter = Omit<DocumentFilter, "viewer" | "limit" | "offset" | "today"> & {
  /** Cadastro escolhido em "Vinculado a" (para mostrar o nome). */
  linkLabel?: string;
};

const FORMAT_LABEL: Record<DocFormat, string> = { pdf: "PDF", image: "Imagem", sheet: "Planilha", text: "Texto/Word", other: "Outros" };
const VALIDITY_LABEL: Record<DocValidity, string> = {
  expired: "Vencidos",
  soon: "Vencem em até 30 dias",
  valid: "Válidos (mais de 30 dias)",
  none: "Sem validade",
};
const SORT_LABEL: Record<NonNullable<DocumentFilter["sort"]>, string> = {
  created_at: "Data de envio",
  name: "Nome",
  type: "Classificação",
  valid_until: "Validade",
  size: "Tamanho",
};
const ENTITY_KEY = { deal: "dealId", activity: "activityId", person: "personId", organization: "organizationId" } as const;

function readUrlFilter(): Filter {
  if (!location.hash.startsWith("#ged?")) return {};
  const p = new URLSearchParams(location.hash.slice(5));
  const f: Record<string, unknown> = {};
  for (const [k, v] of p) f[k] = k === "tagIds" ? v.split(",").filter(Boolean) : k === "unlinked" || k === "trash" ? v === "1" : v;
  return f as Filter;
}

function writeUrlFilter(f: Filter): void {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : v === true ? "1" : String(v));
  }
  history.replaceState(null, "", `${location.pathname}${location.search}#ged?${p.toString()}`);
}

/** Miniatura da grade (imagem ou 1ª página do PDF). */
function Thumb({ d }: { d: DocumentListItem }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    if (!isImage(d) && !isPdf(d)) return;
    void fetchVersion(d.version_id, "index")
      .then(async ({ blob }) => {
        if (isImage(d)) url = URL.createObjectURL(blob);
        const s = url ?? (await pdfThumbnail(blob));
        if (alive) setSrc(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [d]);
  return (
    <div className="flex h-36 items-center justify-center overflow-hidden rounded-t-xl bg-gray-100 dark:bg-gray-950">
      {src ? <img src={src} alt="" className="h-full w-full object-cover object-top" /> : <FileTypeIcon mime={d.mime} size={36} />}
    </div>
  );
}

function LinkFilter({
  value,
  label,
  onChange,
}: {
  value: { type: DocLink["type"]; id: string } | null;
  label?: string;
  onChange: (l: DocLink | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DocLink[]>([]);
  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => void call("documents.linkTargets", { q }).then(setResults), 200);
    return () => clearTimeout(t);
  }, [q]);
  if (value) {
    return (
      <span className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-25 px-2.5 py-2 text-theme-xs text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10">
        <LinkIcon type={value.type} />
        <span className="min-w-0 flex-1 truncate">
          {LINK_TYPE_LABEL[value.type]}: {label}
        </span>
        <button type="button" title="Limpar" onClick={() => onChange(null)}>
          <X size={13} />
        </button>
      </span>
    );
  }
  return (
    <div className="relative">
      <TaInput placeholder="Cartão, atividade, contato ou organização" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-64 w-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-theme-lg dark:border-gray-700 dark:bg-gray-900">
          {results.map((r) => (
            <button
              key={`${r.type}:${r.id}`}
              type="button"
              onClick={() => {
                onChange(r);
                setQ("");
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-theme-xs hover:bg-gray-100 dark:hover:bg-white/5"
            >
              <LinkIcon type={r.type} />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="text-gray-400">{LINK_TYPE_LABEL[r.type]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GedView() {
  const { user, users } = useSession();
  const [filter, setFilter] = useState<Filter>(readUrlFilter);
  const [search, setSearch] = useState(filter.search ?? "");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"list" | "grid">(() => {
    try {
      return localStorage.getItem("conectcrm-ged-view") === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });
  const [data, setData] = useState<{ items: DocumentListItem[]; total: number }>({ items: [], total: 0 });
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [upload, setUpload] = useState<File[] | null>(null);
  const [bulkLink, setBulkLink] = useState(false);
  const [folderPrompt, setFolderPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  // Busca enquanto digita (com pausa).
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.search === search ? f : { ...f, search })), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const { linkLabel: _l, ...f } = filter;
    const [list, st] = await Promise.all([call("documents.list", { ...f, limit: PAGE, offset: page * PAGE }), call("documents.stats")]);
    setData(list);
    setStats(st);
  }, [filter, page]);

  useEffect(() => {
    writeUrlFilter(filter);
    setSelected(new Set());
    void load();
  }, [filter, page, load]);

  useEffect(() => {
    void call("documentTypes.list", { includeInactive: true }).then(setTypes);
    void call("pipelines.list", {}).then(setPipelines);
    // Rotina: lixeira vencida, texto de PDFs antigos, mudança para a pasta.
    void runDocumentMaintenance()
      .then(() => load())
      .catch(() => {});
    void documentsFolderStatus().then((s) => setFolderPrompt(s.configured && s.permission !== "granted"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<Filter>) => {
    setPage(0);
    setFilter((f) => ({ ...f, ...patch }));
  };
  const linkValue = useMemo(() => {
    for (const [type, key] of Object.entries(ENTITY_KEY) as [DocLink["type"], (typeof ENTITY_KEY)[keyof typeof ENTITY_KEY]][]) {
      if (filter[key]) return { type, id: filter[key]! };
    }
    return null;
  }, [filter]);
  const activeCount = Object.entries(filter).filter(
    ([k, v]) =>
      k !== "search" && k !== "sort" && k !== "dir" && k !== "linkLabel" && v !== undefined && v !== "" && v !== false && !(Array.isArray(v) && !v.length),
  ).length;

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ text, kind: "ok" });
      await load();
    } catch (e) {
      setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };
  const chosen = data.items.filter((d) => selected.has(d.id));
  const allChecked = data.items.length > 0 && data.items.every((d) => selected.has(d.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pages = Math.max(1, Math.ceil(data.total / PAGE));

  const statCards: { label: string; value: string; icon: React.ReactNode; active: boolean; onClick: () => void; tone: string }[] = stats
    ? [
        {
          label: "Documentos",
          value: `${stats.total} · ${formatBytes(stats.bytes)}`,
          icon: <Files size={18} />,
          active: !activeCount && !filter.trash,
          onClick: () => setFilter({ search: filter.search }),
          tone: "text-brand-600",
        },
        {
          label: "Vencem em 30 dias",
          value: String(stats.soon),
          icon: <CalendarClock size={18} />,
          active: filter.validity === "soon",
          // Clicar de novo no cartão marcado desliga o filtro (os outros continuam).
          onClick: () => set({ validity: filter.validity === "soon" ? undefined : "soon", trash: false }),
          tone: "text-warning-600",
        },
        {
          label: "Vencidos",
          value: String(stats.expired),
          icon: <AlertTriangle size={18} />,
          active: filter.validity === "expired",
          onClick: () => set({ validity: filter.validity === "expired" ? undefined : "expired", trash: false }),
          tone: "text-error-600",
        },
        {
          label: "Não classificados",
          value: String(stats.unclassified),
          icon: <FileQuestion size={18} />,
          active: filter.typeId === "none",
          onClick: () => set({ typeId: filter.typeId === "none" ? undefined : "none", trash: false }),
          tone: "text-gray-600",
        },
        {
          label: "Sem vínculo",
          value: String(stats.unlinked),
          icon: <Unlink size={18} />,
          active: !!filter.unlinked,
          onClick: () => set({ unlinked: filter.unlinked ? undefined : true, trash: false }),
          tone: "text-gray-600",
        },
        {
          label: "Lixeira",
          value: String(stats.trash),
          icon: <Trash2 size={18} />,
          active: !!filter.trash,
          onClick: () => set({ trash: !filter.trash }),
          tone: "text-gray-600",
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {statCards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.onClick}
            aria-pressed={c.active}
            title={c.active && c.label !== "Documentos" ? "Clique para tirar este filtro" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 text-left shadow-theme-xs dark:bg-gray-900",
              c.active ? "border-brand-500 ring-1 ring-brand-500" : "border-gray-200 hover:border-gray-300 dark:border-gray-800",
            )}
          >
            <span className={c.tone}>{c.icon}</span>
            <span className="min-w-0">
              <span className="block truncate text-theme-xs text-gray-500">{c.label}</span>
              <span className="block truncate text-theme-sm font-semibold text-gray-800 dark:text-white/90">{c.value}</span>
            </span>
          </button>
        ))}
      </div>

      {folderPrompt && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning-200 bg-warning-50 px-4 py-2.5 text-theme-sm text-warning-800">
          <KeyRound size={16} />
          <span className="flex-1">
            O Chrome precisa da sua autorização para usar a pasta de documentos. Até lá, os arquivos da pasta não abrem e os novos ficam no navegador.
          </span>
          <TaButton
            size="sm"
            variant="primary"
            onClick={() =>
              void requestDocumentsFolderAccess().then((ok) => {
                if (!ok) return;
                setFolderPrompt(false);
                void runDocumentMaintenance().then(() => load());
              })
            }
          >
            Conceder acesso
          </TaButton>
        </div>
      )}

      <div className="flex gap-5">
        <aside className="w-64 shrink-0 space-y-3 self-start rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Filtros</h2>
            {activeCount > 0 && (
              <button
                type="button"
                className="text-theme-xs text-brand-600 hover:underline"
                onClick={() => setFilter({ search: filter.search, sort: filter.sort, dir: filter.dir })}
              >
                Limpar ({activeCount})
              </button>
            )}
          </div>
          <label className="block text-theme-xs text-gray-500">
            Classificação
            <TaSelect className="mt-1" value={filter.typeId ?? ""} onChange={(e) => set({ typeId: e.target.value || undefined })}>
              <option value="">Todas</option>
              <option value="none">Não classificados</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </TaSelect>
          </label>
          <label className="block text-theme-xs text-gray-500">
            Funil
            <TaSelect className="mt-1" value={filter.pipelineId ?? ""} onChange={(e) => set({ pipelineId: e.target.value || undefined })}>
              <option value="">Todos</option>
              {PIPELINE_TYPE_ORDER.filter((t) => pipelines.some((p) => p.type === t)).map((t) => (
                <optgroup key={t} label={PIPELINE_TYPE_LABEL[t]}>
                  {pipelines
                    .filter((p) => p.type === t)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </TaSelect>
          </label>
          <div className="text-theme-xs text-gray-500">
            Vinculado a
            <div className="mt-1">
              <LinkFilter
                value={linkValue}
                label={filter.linkLabel}
                onChange={(l) =>
                  set({
                    dealId: undefined,
                    activityId: undefined,
                    personId: undefined,
                    organizationId: undefined,
                    linkLabel: l?.label,
                    ...(l ? { [ENTITY_KEY[l.type]]: l.id } : {}),
                  })
                }
              />
            </div>
          </div>
          <label className="block text-theme-xs text-gray-500">
            Formato
            <TaSelect className="mt-1" value={filter.format ?? ""} onChange={(e) => set({ format: (e.target.value || undefined) as DocFormat | undefined })}>
              <option value="">Todos</option>
              {(Object.keys(FORMAT_LABEL) as DocFormat[]).map((k) => (
                <option key={k} value={k}>
                  {FORMAT_LABEL[k]}
                </option>
              ))}
            </TaSelect>
          </label>
          <label className="block text-theme-xs text-gray-500">
            Validade
            <TaSelect
              className="mt-1"
              value={filter.validity ?? ""}
              onChange={(e) => set({ validity: (e.target.value || undefined) as DocValidity | undefined })}
            >
              <option value="">Qualquer</option>
              {(Object.keys(VALIDITY_LABEL) as DocValidity[]).map((k) => (
                <option key={k} value={k}>
                  {VALIDITY_LABEL[k]}
                </option>
              ))}
            </TaSelect>
          </label>
          <label className="block text-theme-xs text-gray-500">
            Enviado por
            <TaSelect className="mt-1" value={filter.uploadedBy ?? ""} onChange={(e) => set({ uploadedBy: e.target.value || undefined })}>
              <option value="">Qualquer pessoa</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </TaSelect>
          </label>
          <div className="text-theme-xs text-gray-500">
            Enviado entre
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              <TaInput type="date" aria-label="De" value={filter.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
              <TaInput type="date" aria-label="Até" value={filter.to ?? ""} min={filter.from} onChange={(e) => set({ to: e.target.value || undefined })} />
            </div>
          </div>
          <div className="text-theme-xs text-gray-500">
            Palavras-chave
            <div className="mt-1">
              <TagPicker entity="document" value={filter.tagIds ?? []} onChange={(tagIds) => set({ tagIds })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-theme-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={!!filter.unlinked} onChange={(e) => set({ unlinked: e.target.checked || undefined })} /> Só sem vínculo
          </label>
          <label className="flex items-center gap-2 text-theme-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={!!filter.trash} onChange={(e) => set({ trash: e.target.checked || undefined })} /> Lixeira
          </label>
        </aside>

        <section className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <TaInput
                className="pl-9"
                placeholder="Buscar em qualquer campo: nome, classificação, contato, cartão, texto do PDF…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <TaSelect
              aria-label="Ordenar por"
              className="w-44"
              value={filter.sort ?? "created_at"}
              onChange={(e) => set({ sort: e.target.value as DocumentFilter["sort"] })}
            >
              {(Object.keys(SORT_LABEL) as NonNullable<DocumentFilter["sort"]>[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </TaSelect>
            <button
              type="button"
              title={(filter.dir ?? "desc") === "desc" ? "Decrescente" : "Crescente"}
              onClick={() => set({ dir: (filter.dir ?? "desc") === "desc" ? "asc" : "desc" })}
              className="h-10 rounded-lg border border-gray-300 px-3 text-theme-sm text-gray-600 dark:border-gray-700 dark:text-gray-300"
            >
              {(filter.dir ?? "desc") === "desc" ? "↓" : "↑"}
            </button>
            <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-white/5">
              {(["list", "grid"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  title={v === "list" ? "Lista" : "Grade"}
                  onClick={() => {
                    setView(v);
                    try {
                      localStorage.setItem("conectcrm-ged-view", v);
                    } catch {
                      /* só conveniência */
                    }
                  }}
                  className={cn("rounded-md px-2.5 py-1.5", view === v ? "bg-white text-brand-600 shadow-theme-xs dark:bg-gray-900" : "text-gray-500")}
                >
                  {v === "list" ? <List size={16} /> : <LayoutGrid size={16} />}
                </button>
              ))}
            </div>
            <label className="cursor-pointer">
              <span className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-theme-sm font-medium text-white hover:bg-brand-600">
                <Upload size={15} /> Enviar documentos
              </span>
              <input
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  if (files.length) setUpload(files);
                }}
              />
            </label>
          </div>

          {selected.size > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-25 px-3 py-2 text-theme-sm dark:bg-brand-500/10">
              <span className="font-medium text-brand-700 dark:text-brand-300">{selected.size} selecionado(s)</span>
              {!filter.trash ? (
                <>
                  <TaButton
                    size="sm"
                    startIcon={<Download size={14} />}
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        downloadZip(
                          chosen.map((d) => ({ versionId: d.version_id, name: d.name })),
                          "documentos.zip",
                        ),
                      )
                    }
                  >
                    Baixar (.zip)
                  </TaButton>
                  <TaSelect
                    aria-label="Reclassificar"
                    className="h-9 w-48 text-theme-xs"
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      const typeId = e.target.value;
                      if (typeId)
                        void run(
                          async () => (await call("documents.reclassify", { ids: [...selected], typeId }), `${selected.size} documento(s) reclassificado(s).`),
                        );
                    }}
                  >
                    <option value="">Reclassificar como…</option>
                    {types
                      .filter((t) => t.active)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </TaSelect>
                  <div className="relative">
                    <TaButton size="sm" startIcon={<Tags size={14} />} disabled={busy} onClick={() => setBulkLink((b) => !b)}>
                      Vincular a…
                    </TaButton>
                    {bulkLink && (
                      <div className="absolute left-0 top-full z-40 mt-1 w-80 rounded-xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-700 dark:bg-gray-900">
                        <LinkFilter
                          value={null}
                          onChange={(l) => {
                            setBulkLink(false);
                            if (l)
                              void run(
                                async () =>
                                  `${await call("documents.addLinks", { ids: [...selected], links: [{ type: l.type, id: l.id }] })} vínculo(s) criado(s) com ${l.label}.`,
                              );
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <TaButton
                    size="sm"
                    startIcon={<Trash2 size={14} />}
                    disabled={busy}
                    onClick={() =>
                      confirm(`Mover ${selected.size} documento(s) para a lixeira? Eles saem de todos os cadastros.`) &&
                      void run(async () => (await call("documents.trash", { ids: [...selected] }), "Movido(s) para a lixeira."))
                    }
                  >
                    Lixeira
                  </TaButton>
                </>
              ) : (
                <>
                  <TaButton
                    size="sm"
                    startIcon={<ArchiveRestore size={14} />}
                    disabled={busy}
                    onClick={() => void run(async () => (await call("documents.restore", { ids: [...selected] }), "Restaurado(s)."))}
                  >
                    Restaurar
                  </TaButton>
                  {user.role === "admin" && (
                    <TaButton
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        confirm(`Excluir ${selected.size} documento(s) definitivamente? Os arquivos são apagados e não podem ser recuperados.`) &&
                        void run(async () => {
                          await deleteOrphans(await call("documents.purge", { ids: [...selected] }));
                          return "Excluído(s) definitivamente.";
                        })
                      }
                    >
                      Excluir definitivamente
                    </TaButton>
                  )}
                </>
              )}
              <button type="button" className="ml-auto text-theme-xs text-gray-500 hover:underline" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </button>
            </div>
          )}
          {msg && (
            <p className={cn("mt-3 rounded-lg px-3 py-2 text-theme-sm", msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700")}>
              {msg.text}
            </p>
          )}
          {filter.trash && <p className="mt-3 text-theme-xs text-gray-500">Documentos excluídos ficam aqui e na Lixeira do CRM até o prazo da lixeira; depois são apagados.</p>}

          <p className="mt-3 text-theme-xs text-gray-500">
            {data.total} documento(s){filter.search ? ` para "${filter.search}"` : ""}
          </p>

          {view === "list" ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-theme-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                    <th className="w-8 py-2">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(data.items.map((d) => d.id)))}
                      />
                    </th>
                    <th className="py-2">Documento</th>
                    <th className="py-2">Classificação</th>
                    <th className="py-2">Vínculos</th>
                    <th className="py-2">Validade</th>
                    <th className="py-2 text-right">Enviado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => (
                    <tr key={d.id} data-doc-id={d.id} className="border-b border-gray-100 align-top dark:border-gray-800">
                      <td className="py-2.5">
                        <input type="checkbox" aria-label={`Selecionar ${d.name}`} checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5">
                            <FileTypeIcon mime={d.mime} />
                          </span>
                          <span className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setOpen(d.id)}
                              className="block max-w-[320px] truncate text-left font-medium text-gray-800 hover:text-brand-600 dark:text-white/90"
                            >
                              {d.name}
                            </button>
                            <span className="block text-theme-xs text-gray-400">
                              {d.filename} · {formatBytes(d.size_bytes)}
                              {d.versions > 1 && ` · v${d.version_number}`}
                            </span>
                            {(d.tags.length > 0 || d.restricted > 0) && (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {!!d.restricted && <RestrictedBadge />}
                                {d.tags.map((t) => (
                                  <span
                                    key={t.id}
                                    className="rounded-full bg-gray-100 px-1.5 py-px text-[10px] text-gray-600 dark:bg-white/5 dark:text-gray-300"
                                  >
                                    #{t.name}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <TypeBadge name={d.type_name} color={d.type_color} />
                      </td>
                      <td className="max-w-[340px] py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {d.links.slice(0, 3).map((l) => (
                            <LinkChip key={`${l.type}:${l.id}`} link={l} />
                          ))}
                          {d.links.length > 3 && (
                            <button type="button" onClick={() => setOpen(d.id)} className="text-theme-xs text-brand-600 hover:underline">
                              +{d.links.length - 3}
                            </button>
                          )}
                          {d.links.length === 0 && <span className="text-theme-xs text-gray-400">—</span>}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <ValidityBadge validUntil={d.valid_until} />
                      </td>
                      <td className="py-2.5 text-right text-theme-xs text-gray-500">
                        {formatDateTime(d.created_at)}
                        {d.created_by_name && <span className="block">{d.created_by_name}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {data.items.map((d) => (
                <div
                  key={d.id}
                  data-doc-id={d.id}
                  className={cn(
                    "relative rounded-xl border bg-white dark:bg-gray-900",
                    selected.has(d.id) ? "border-brand-500 ring-1 ring-brand-500" : "border-gray-200 dark:border-gray-800",
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${d.name}`}
                    className="absolute left-2 top-2 z-10"
                    checked={selected.has(d.id)}
                    onChange={() => toggle(d.id)}
                  />
                  <button type="button" className="block w-full text-left" onClick={() => setOpen(d.id)}>
                    <Thumb d={d} />
                    <span className="block p-2.5">
                      <span className="block truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">{d.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <TypeBadge name={d.type_name} color={d.type_color} />
                        <ValidityBadge validUntil={d.valid_until} />
                      </span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
          {data.items.length === 0 && (
            <p className="py-10 text-center text-theme-sm text-gray-400">
              {filter.search || activeCount
                ? "Nenhum documento encontrado com esses critérios."
                : "Nenhum documento ainda. Envie por aqui ou anexe num cartão, atividade, contato ou organização."}
            </p>
          )}

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2 text-theme-sm text-gray-600 dark:text-gray-300">
              <TaButton size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </TaButton>
              <span>
                Página {page + 1} de {pages}
              </span>
              <TaButton size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </TaButton>
            </div>
          )}
        </section>
      </div>

      {upload && (
        <UploadModal
          files={upload}
          onClose={() => setUpload(null)}
          onSaved={(ids) => {
            setUpload(null);
            void load();
            if (ids.length === 1) setOpen(ids[0]!);
          }}
        />
      )}
      {open && <DocumentViewer documentId={open} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </div>
  );
}
