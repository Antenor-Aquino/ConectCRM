// Pastas do GED (spec 08, Pastas): a árvore da coluna da esquerda (com
// contagens, criar/renomear/excluir e arrastar documentos e pastas para
// dentro), o caminho acima da lista e o seletor de pasta dos formulários.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Files, FolderX, Pencil, Trash2 } from "lucide-react";
import { TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { FolderNode, FolderTree } from "../../db/documents";
import { errorText } from "../../lib/errors";

/** Tipos do arrastar: documentos (ids) e uma pasta (id). */
export const DRAG_DOCS = "application/x-conectcrm-docs";
export const DRAG_FOLDER = "application/x-conectcrm-folder";
/** Mesmo limite do banco (db/documentFolders.ts). */
const MAX_FOLDER_DEPTH = 5;
const SUGGESTED = ["Comercial", "Contratos", "Modelos", "Marketing", "Administrativo"];

/** Árvore pronta para desenhar: filhos por pai, em ordem alfabética. */
export function childrenOf(tree: FolderTree | null, parentId: string | null): FolderNode[] {
  return (tree?.folders ?? []).filter((f) => f.parent_id === parentId);
}

/** Pastas em ordem de árvore, com o nível (para listas com recuo). */
export function flatTree(tree: FolderTree | null): { folder: FolderNode; level: number }[] {
  const out: { folder: FolderNode; level: number }[] = [];
  const walk = (parentId: string | null, level: number) => {
    for (const f of childrenOf(tree, parentId)) {
      out.push({ folder: f, level });
      walk(f.id, level + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function useFolderTree(): [FolderTree | null, () => Promise<void>] {
  const [tree, setTree] = useState<FolderTree | null>(null);
  const reload = async () => setTree(await call("documents.folders"));
  useEffect(() => {
    void reload();
  }, []);
  return [tree, reload];
}

/** Seletor de pasta (formulários e "Mover para pasta…"). */
export function FolderSelect({
  tree,
  value,
  onChange,
  placeholder = "Sem pasta",
  className,
  ...rest
}: {
  tree: FolderTree | null;
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <TaSelect className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      <option value="">{placeholder}</option>
      {flatTree(tree).map(({ folder, level }) => (
        <option key={folder.id} value={folder.id}>
          {`${"   ".repeat(level)}${level ? "└ " : ""}${folder.name}`}
        </option>
      ))}
    </TaSelect>
  );
}

/** Caminho da pasta aberta: GED › Comercial › Propostas (cada parte clicável). */
export function FolderBreadcrumb({ tree, folderId, onOpen }: { tree: FolderTree | null; folderId: string | "none" | undefined; onOpen: (id: string | undefined) => void }) {
  if (!folderId) return null;
  const chain: FolderNode[] = [];
  for (let cur = tree?.folders.find((f) => f.id === folderId); cur; cur = tree?.folders.find((f) => f.id === cur!.parent_id)) chain.unshift(cur);
  return (
    <nav className="mt-3 flex flex-wrap items-center gap-1 text-theme-sm" aria-label="Caminho da pasta" data-ged-breadcrumb>
      <button type="button" className="text-gray-500 hover:text-brand-600" onClick={() => onOpen(undefined)}>
        GED
      </button>
      {folderId === "none" ? (
        <>
          <ChevronRight size={14} className="text-gray-400" />
          <span className="font-medium text-gray-800 dark:text-white/90">Sem pasta</span>
        </>
      ) : (
        chain.map((f, i) => (
          <span key={f.id} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-gray-400" />
            {i === chain.length - 1 ? (
              <span className="font-medium text-gray-800 dark:text-white/90">{f.name}</span>
            ) : (
              <button type="button" className="text-gray-500 hover:text-brand-600" onClick={() => onOpen(f.id)}>
                {f.name}
              </button>
            )}
          </span>
        ))
      )}
    </nav>
  );
}

/** Lê o que foi solto numa pasta e faz o movimento. */
async function dropInto(e: React.DragEvent, folderId: string | null): Promise<string | null> {
  const docs = e.dataTransfer.getData(DRAG_DOCS);
  if (docs) {
    const ids = JSON.parse(docs) as string[];
    const n = await call("documents.moveToFolder", { ids, folderId });
    return n ? `${n} documento(s) movido(s).` : null;
  }
  const folder = e.dataTransfer.getData(DRAG_FOLDER);
  if (folder && folder !== folderId) {
    await call("documents.folderMove", { id: folder, parentId: folderId });
    return "Pasta movida.";
  }
  return null;
}

const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_DOCS) || e.dataTransfer.types.includes(DRAG_FOLDER);

/** Painel "Pastas" (coluna da esquerda, acima dos filtros). */
export function FolderPanel({
  tree,
  current,
  onOpen,
  onChanged,
  onMessage,
}: {
  tree: FolderTree | null;
  /** Pasta aberta: id, "none" (Sem pasta) ou undefined (Todos os documentos). */
  current: string | "none" | undefined;
  onOpen: (id: string | "none" | undefined) => void;
  /** Algo mudou (pastas ou documentos movidos): recarregar. */
  onChanged: () => void;
  onMessage: (text: string, kind: "ok" | "err") => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<string | null>(null);

  const act = async (fn: () => Promise<string | null | void>) => {
    try {
      const text = await fn();
      if (text) onMessage(text, "ok");
      onChanged();
    } catch (e) {
      onMessage(errorText(e), "err");
    }
  };
  const create = (parentId: string | null) => {
    const name = prompt(parentId ? "Nome da subpasta:" : "Nome da nova pasta:");
    if (name?.trim())
      void act(async () => {
        const id = await call("documents.folderCreate", { name, parentId });
        if (parentId) setClosed((s) => (s.delete(parentId), new Set(s)));
        onOpen(id);
        return `Pasta “${name.trim()}” criada.`;
      });
  };
  const rename = (f: FolderNode) => {
    const name = prompt("Novo nome da pasta:", f.name);
    if (name?.trim() && name.trim() !== f.name) void act(async () => (await call("documents.folderRename", { id: f.id, name }), "Pasta renomeada."));
  };
  const remove = (f: FolderNode) => {
    const where = f.parent_id ? `para “${tree?.folders.find((x) => x.id === f.parent_id)?.name}”` : "para Sem pasta";
    if (!confirm(`Mover a pasta “${f.name}” para a lixeira?\n\nO que está dentro dela (${f.total} documento(s) e as subpastas) vai ${where}. Nada é apagado.`)) return;
    void act(async () => {
      const notice = await call("documents.folderDelete", { id: f.id });
      if (current === f.id) onOpen(f.parent_id ?? undefined);
      return `${notice.label} foi para a lixeira; o conteúdo subiu ${where}.`;
    });
  };

  const dropProps = (target: string | null, key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      void act(() => dropInto(e, target));
    },
  });

  const row = (opts: { key: string; label: string; icon: React.ReactNode; count: number; active: boolean; onClick: () => void; level?: number; drop?: string | null }) => (
    <div
      key={opts.key}
      {...(opts.drop !== undefined ? dropProps(opts.drop, opts.key) : {})}
      className={cn(
        "flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-theme-sm",
        opts.active ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5",
        over === opts.key && "ring-2 ring-brand-500",
      )}
      style={{ paddingLeft: 8 + (opts.level ?? 0) * 14 }}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={opts.onClick}>
        {opts.icon}
        <span className="truncate">{opts.label}</span>
      </button>
      <span className="text-theme-xs text-gray-400">{opts.count}</span>
    </div>
  );

  const renderFolder = (f: FolderNode, level: number): React.ReactNode => {
    const kids = childrenOf(tree, f.id);
    const isClosed = closed.has(f.id);
    const active = current === f.id;
    return (
      <div key={f.id}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_FOLDER, f.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          {...dropProps(f.id, f.id)}
          data-ged-folder={f.name}
          className={cn(
            "group flex items-center gap-1 rounded-lg py-1.5 pr-1.5 text-theme-sm",
            active ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5",
            over === f.id && "ring-2 ring-brand-500",
          )}
          style={{ paddingLeft: 4 + level * 14 }}
        >
          <button
            type="button"
            className={cn("shrink-0 text-gray-400", !kids.length && "invisible")}
            aria-label={isClosed ? "Abrir subpastas" : "Fechar subpastas"}
            onClick={() =>
              setClosed((s) => {
                const n = new Set(s);
                if (n.has(f.id)) n.delete(f.id);
                else n.add(f.id);
                return n;
              })
            }
          >
            {isClosed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => onOpen(f.id)} title={f.path.join(" › ")}>
            {active ? <FolderOpen size={15} className="shrink-0 text-brand-500" /> : <Folder size={15} className="shrink-0 text-amber-500" />}
            <span className="truncate">{f.name}</span>
          </button>
          <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
            {f.path.length < MAX_FOLDER_DEPTH && (
              <button type="button" title="Nova subpasta" className="rounded p-0.5 text-gray-400 hover:text-brand-600" onClick={() => create(f.id)}>
                <FolderPlus size={13} />
              </button>
            )}
            <button type="button" title="Renomear" className="rounded p-0.5 text-gray-400 hover:text-brand-600" onClick={() => rename(f)}>
              <Pencil size={12} />
            </button>
            <button type="button" title="Excluir pasta" className="rounded p-0.5 text-gray-400 hover:text-error-600" onClick={() => remove(f)} data-ged-folder-delete>
              <Trash2 size={12} />
            </button>
          </span>
          <span className="w-6 text-right text-theme-xs text-gray-400 group-hover:hidden">{f.total}</span>
        </div>
        {!isClosed && kids.map((k) => renderFolder(k, level + 1))}
      </div>
    );
  };

  return (
    <div data-ged-folders>
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Pastas</h2>
        <button type="button" className="flex items-center gap-1 text-theme-xs text-brand-600 hover:underline" onClick={() => create(null)} data-ged-new-folder>
          <FolderPlus size={14} /> Nova pasta
        </button>
      </div>
      {row({ key: "all", label: "Todos os documentos", icon: <Files size={15} className="shrink-0 text-gray-400" />, count: tree?.all ?? 0, active: current === undefined, onClick: () => onOpen(undefined) })}
      {row({
        key: "none",
        label: "Sem pasta",
        icon: <FolderX size={15} className="shrink-0 text-gray-400" />,
        count: tree?.none ?? 0,
        active: current === "none",
        onClick: () => onOpen("none"),
        drop: null,
      })}
      <div className="mt-1">{childrenOf(tree, null).map((f) => renderFolder(f, 0))}</div>
      {tree && !tree.folders.length && (
        <div className="mt-2 px-2 text-theme-xs text-gray-400">
          <p>Organize os documentos em pastas e subpastas: arraste os documentos para a pasta.</p>
          <button
            type="button"
            className="mt-1.5 text-brand-600 hover:underline"
            data-ged-suggested
            onClick={() =>
              void act(async () => {
                for (const name of SUGGESTED) await call("documents.folderCreate", { name, parentId: null });
                return `Pastas criadas: ${SUGGESTED.join(", ")}. Renomeie ou exclua as que não usar.`;
              })
            }
          >
            Criar pastas sugeridas ({SUGGESTED.join(", ")})
          </button>
        </div>
      )}
    </div>
  );
}
