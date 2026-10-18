// Documento aberto (GED): prévia à esquerda; à direita informações
// editáveis, vínculos, versões e trilha de auditoria.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArchiveRestore, Download, History, Lock, RotateCcw, Trash2, Upload } from "lucide-react";
import { TaButton, TaInput, TaModal, TaTextarea, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { AuditEntry, DocLink, DocumentDetail, DocumentType } from "../../db/documents";
import { deleteOrphans, downloadVersion, prepareFile, saveContent } from "../../lib/documentFiles";
import { formatBytes } from "../../lib/files";
import { formatDateTime } from "../../lib/format";
import { useSession } from "../session";
import { Field } from "../ui/form";
import { Switch } from "../ui/Switch";
import { TagPicker } from "../ui/TagPicker";
import { DOC_NAV_EVENT, LinkChip, RestrictedBadge, TypeBadge, ValidityBadge } from "./docUi";
import { LinkEditor } from "./LinkEditor";
import { Preview } from "./Preview";
import { errorText } from "../../lib/errors";
import { DocumentTypePicker } from "./DocumentTypePicker";

type Tab = "info" | "links" | "versions" | "audit";
const TABS: { id: Tab; label: string }[] = [
  { id: "info", label: "Informações" },
  { id: "links", label: "Vínculos" },
  { id: "versions", label: "Versões" },
  { id: "audit", label: "Auditoria" },
];

export function DocumentViewer({ documentId, onClose, onChanged }: { documentId: string; onClose: () => void; onChanged?: () => void }) {
  const { user } = useSession();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [tab, setTab] = useState<Tab>("info");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Edição das informações
  const [form, setForm] = useState({ name: "", typeId: "", docDate: "", validUntil: "", restricted: false, description: "", tagIds: [] as string[] });
  const [links, setLinks] = useState<DocLink[]>([]);
  const versionInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await call("documents.get", { id: documentId });
    setDoc(d);
    if (d) {
      setForm({
        name: d.name,
        typeId: d.type_id ?? "",
        docDate: d.doc_date ?? "",
        validUntil: d.valid_until ?? "",
        restricted: !!d.restricted,
        description: d.description ?? "",
        tagIds: d.tagIds,
      });
      setLinks(d.links);
    }
  }, [documentId]);
  useEffect(() => {
    void load().catch((e: unknown) => setError(errorText(e)));
    void call("documentTypes.list", { includeInactive: true }).then(setTypes);
  }, [load]);
  useEffect(() => {
    window.addEventListener(DOC_NAV_EVENT, onClose);
    return () => window.removeEventListener(DOC_NAV_EVENT, onClose);
  }, [onClose]);
  useEffect(() => {
    if (tab === "audit") void call("documents.audit", { id: documentId }).then(setAudit);
  }, [tab, documentId, doc]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged?.();
      after?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!doc) {
    return (
      <TaModal isOpen onClose={onClose} title="Documento" width="max-w-md">
        <p className="text-theme-sm text-gray-500">{error ?? "Carregando…"}</p>
      </TaModal>
    );
  }
  const trashed = !!doc.deleted_at;
  const canManage = user.role !== "vendedor" || doc.created_by === user.id;
  const dirty =
    form.name !== doc.name ||
    form.typeId !== (doc.type_id ?? "") ||
    form.docDate !== (doc.doc_date ?? "") ||
    form.validUntil !== (doc.valid_until ?? "") ||
    form.restricted !== !!doc.restricted ||
    form.description !== (doc.description ?? "") ||
    form.tagIds.join() !== doc.tagIds.join();
  const key = (l: { type: string; id: string }) => `${l.type}:${l.id}`;
  const added = links.filter((l) => !doc.links.some((x) => key(x) === key(l)));
  const removed = doc.links.filter((l) => !links.some((x) => key(x) === key(l)));

  return (
    <TaModal isOpen onClose={onClose} title={doc.name} width="max-w-6xl">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="h-[70vh] overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <Preview key={doc.version_id} versionId={doc.version_id} mime={doc.mime} filename={doc.filename} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge name={doc.type_name} color={doc.type_color} />
            <ValidityBadge validUntil={doc.valid_until} />
            {!!doc.restricted && <RestrictedBadge />}
            {trashed && <span className="rounded-full bg-error-50 px-2 py-0.5 text-[11px] font-medium text-error-700">Na lixeira</span>}
          </div>
          <p className="mt-2 text-theme-xs text-gray-500">
            {doc.filename} · {formatBytes(doc.size_bytes)} · versão {doc.version_number}
            <br />
            Enviado por {doc.created_by_name ?? "sistema"} em {formatDateTime(doc.created_at)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <TaButton size="sm" variant="primary" startIcon={<Download size={14} />} onClick={() => void run(() => downloadVersion(doc.version_id))}>
              Baixar
            </TaButton>
            {!trashed && canManage && (
              <TaButton
                size="sm"
                variant="outline"
                startIcon={<Trash2 size={14} />}
                disabled={busy}
                onClick={() =>
                  confirm(
                    `Mover "${doc.name}" para a lixeira? Ele sai de todos os cadastros (${doc.links.length} vínculo(s)) e pode ser restaurado em até 30 dias.`,
                  ) && void run(() => call("documents.trash", { ids: [doc.id] }), onClose)
                }
              >
                Lixeira
              </TaButton>
            )}
            {trashed && canManage && (
              <TaButton
                size="sm"
                variant="outline"
                startIcon={<ArchiveRestore size={14} />}
                disabled={busy}
                onClick={() => void run(() => call("documents.restore", { ids: [doc.id] }))}
              >
                Restaurar
              </TaButton>
            )}
            {trashed && user.role === "admin" && (
              <TaButton
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  confirm(`Excluir "${doc.name}" definitivamente? O arquivo é apagado e não pode ser recuperado.`) &&
                  void run(async () => deleteOrphans(await call("documents.purge", { ids: [doc.id] })), onClose)
                }
              >
                Excluir definitivamente
              </TaButton>
            )}
          </div>

          <div className="mt-4 flex gap-1 border-b border-gray-200 dark:border-gray-800">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-theme-sm",
                  tab === t.id ? "border-brand-500 font-medium text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700",
                )}
              >
                {t.label}
                {t.id === "links" && ` (${doc.links.length})`}
                {t.id === "versions" && ` (${doc.versions})`}
              </button>
            ))}
          </div>

          <div className="max-h-[52vh] overflow-y-auto pt-3">
            {tab === "info" && (
              <div>
                <Field label="Nome" required>
                  <TaInput value={form.name} disabled={trashed} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="Classificação" required>
                  {trashed ? (
                    <TaInput value={types.find((t) => t.id === form.typeId)?.name ?? "Não classificado"} disabled />
                  ) : (
                    <DocumentTypePicker value={form.typeId} onChange={(typeId) => setForm({ ...form, typeId })} placeholder="Não classificado" />
                  )}
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Data do documento">
                    <TaInput type="date" value={form.docDate} disabled={trashed} onChange={(e) => setForm({ ...form, docDate: e.target.value })} />
                  </Field>
                  <Field label="Validade">
                    <TaInput type="date" value={form.validUntil} disabled={trashed} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
                  </Field>
                </div>
                <Field label="Palavras-chave">
                  <TagPicker entity="document" value={form.tagIds} onChange={(tagIds) => setForm({ ...form, tagIds })} />
                </Field>
                <Field label="Descrição">
                  <TaTextarea rows={3} value={form.description} disabled={trashed} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </Field>
                <label className={cn("mb-3 flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300", !canManage && "opacity-50")}>
                  <Switch checked={form.restricted} disabled={!canManage || trashed} onChange={(restricted) => setForm({ ...form, restricted })} />
                  <Lock size={14} className="text-gray-400" /> Restrito
                </label>
                {!trashed && (
                  <TaButton
                    variant="primary"
                    disabled={!dirty || busy || !form.name.trim() || !form.typeId}
                    onClick={() =>
                      void run(() =>
                        call("documents.update", {
                          id: doc.id,
                          patch: {
                            name: form.name,
                            typeId: form.typeId,
                            docDate: form.docDate || null,
                            validUntil: form.validUntil || null,
                            description: form.description || null,
                            tagIds: form.tagIds,
                            ...(form.restricted !== !!doc.restricted ? { restricted: form.restricted } : {}),
                          },
                        }),
                      )
                    }
                  >
                    Salvar alterações
                  </TaButton>
                )}
              </div>
            )}

            {tab === "links" &&
              (trashed ? (
                <div className="flex flex-wrap gap-1.5">
                  {doc.links.map((l) => (
                    <LinkChip key={key(l)} link={l} />
                  ))}
                </div>
              ) : (
                <div>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {doc.links.map((l) => (
                      <LinkChip key={key(l)} link={l} />
                    ))}
                  </div>
                  <p className="mb-2 text-theme-xs text-gray-500">Editar vínculos (clique no × para tirar; busque para acrescentar):</p>
                  <LinkEditor value={links} onChange={setLinks} />
                  <TaButton
                    className="mt-3"
                    variant="primary"
                    disabled={busy || (!added.length && !removed.length)}
                    onClick={() =>
                      void run(async () => {
                        if (added.length) await call("documents.addLinks", { ids: [doc.id], links: added.map(({ type, id }) => ({ type, id })) });
                        for (const r of removed) await call("documents.removeLink", { id: doc.id, type: r.type, entityId: r.id });
                      })
                    }
                  >
                    Salvar vínculos
                  </TaButton>
                </div>
              ))}

            {tab === "versions" && (
              <div>
                {!trashed && (
                  <>
                    <TaButton size="sm" startIcon={<Upload size={14} />} disabled={busy} onClick={() => versionInput.current?.click()}>
                      Enviar nova versão
                    </TaButton>
                    <input
                      ref={versionInput}
                      type="file"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void run(async () => call("documents.addVersion", { id: doc.id, file: await saveContent(await prepareFile(f), doc.name) }));
                      }}
                    />
                  </>
                )}
                <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                  {doc.versionList.map((v) => (
                    <li key={v.id} className="flex items-center gap-2 py-2 text-theme-sm">
                      <span className={cn("w-9 shrink-0 text-theme-xs font-semibold", v.id === doc.version_id ? "text-brand-600" : "text-gray-400")}>
                        v{v.number}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-gray-800 dark:text-white/90">{v.filename}</span>
                        <span className="block text-theme-xs text-gray-400">
                          {formatBytes(v.size_bytes)} · {formatDateTime(v.created_at)}
                          {v.created_by_name && ` · ${v.created_by_name}`}
                          {v.id === doc.version_id && " · atual"}
                        </span>
                      </span>
                      <button
                        type="button"
                        title="Baixar esta versão"
                        className="text-gray-400 hover:text-brand-600"
                        onClick={() => void run(() => downloadVersion(v.id))}
                      >
                        <Download size={15} />
                      </button>
                      {v.id !== doc.version_id && !trashed && (
                        <button
                          type="button"
                          title="Restaurar esta versão (vira a atual)"
                          className="text-gray-400 hover:text-brand-600"
                          onClick={() => void run(() => call("documents.restoreVersion", { id: doc.id, versionId: v.id }))}
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-theme-xs text-gray-400">Integridade: SHA-256 {doc.sha256.slice(0, 16)}…</p>
              </div>
            )}

            {tab === "audit" && (
              <ol className="space-y-2">
                {audit.map((a, i) => (
                  <li key={i} className="flex gap-2 text-theme-sm">
                    <History size={14} className="mt-0.5 shrink-0 text-gray-400" />
                    <span>
                      <span className="text-gray-800 dark:text-white/90">{a.text}</span>
                      <span className="block text-theme-xs text-gray-400">
                        {formatDateTime(a.at)} · {a.user_name ?? "sistema"}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {error && <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
        </div>
      </div>
    </TaModal>
  );
}
