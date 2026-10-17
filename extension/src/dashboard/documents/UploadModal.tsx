// Janela "Novo documento" (spec 08): cada arquivo recebe nome e
// classificação; data, validade, restrito, palavras-chave e vínculos valem
// para todos. Os vínculos da tela de origem já vêm marcados.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Lock, Paperclip, X } from "lucide-react";
import { TaButton, TaInput, TaModal, TaSelect, TaTextarea } from "@tailadmin";
import { call } from "../../rpc/client";
import type { DocLink, DocLinkType, DocumentType } from "../../db/documents";
import { prepareFile, saveContent, type PreparedFile } from "../../lib/documentFiles";
import { formatBytes } from "../../lib/files";
import { Field, SectionLabel } from "../ui/form";
import { Switch } from "../ui/Switch";
import { TagPicker } from "../ui/TagPicker";
import { FileTypeIcon } from "./docUi";
import { LinkEditor } from "./LinkEditor";

interface Row {
  key: string;
  file: File;
  prepared: PreparedFile | null;
  error: string | null;
  name: string;
  typeId: string;
  duplicates: { id: string; name: string; type_name: string | null }[];
  /** Arquivo já existe: vincular o documento existente em vez de enviar de novo. */
  useExisting: boolean;
}

const baseName = (filename: string) =>
  filename
    .replace(/\.[^.]{1,8}$/, "")
    .replace(/[_]+/g, " ")
    .trim() || filename;
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function UploadModal({
  files,
  context,
  onClose,
  onSaved,
}: {
  files: File[];
  /** Tela de origem: define os vínculos automáticos. */
  context?: { type: DocLinkType; id: string } | null;
  onClose: () => void;
  onSaved: (ids: string[]) => void;
}) {
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [docDate, setDocDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [validTouched, setValidTouched] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState<DocLink[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void call("documentTypes.list", {}).then(setTypes);
    if (context) void call("documents.contextLinks", context).then(setLinks);
  }, [context]);

  const addFiles = (list: File[]) => {
    const fresh: Row[] = list.map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      file,
      prepared: null,
      error: null,
      name: baseName(file.name),
      typeId: "",
      duplicates: [],
      useExisting: false,
    }));
    setRows((r) => [...r, ...fresh]);
    for (const row of fresh) {
      void prepareFile(row.file)
        .then(async (prepared) => {
          const duplicates = await call("documents.bySha", { sha256: prepared.sha256 });
          setRows((r) => r.map((x) => (x.key === row.key ? { ...x, prepared, duplicates, useExisting: duplicates.length > 0 } : x)));
        })
        .catch((e: unknown) => setRows((r) => r.map((x) => (x.key === row.key ? { ...x, error: e instanceof Error ? e.message : String(e) } : x))));
    }
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    addFiles(files);
  }, [files]);

  const update = (key: string, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  // Validade sugerida pelo tipo (enquanto o usuário não mexer nela).
  const firstType = types.find((t) => t.id === rows.find((r) => !r.useExisting)?.typeId);
  useEffect(() => {
    if (validTouched) return;
    setValidUntil(firstType?.valid_days ? addDays(docDate || todayStr(), firstType.valid_days) : "");
  }, [firstType, docDate, validTouched]);

  const toSend = rows.filter((r) => !r.useExisting);
  const ready = rows.length > 0 && rows.every((r) => r.prepared && !r.error) && toSend.every((r) => r.name.trim() && r.typeId);
  const multiple = rows.length > 1;
  const firstTypeId = rows[0]?.typeId ?? "";
  const mixedTypes = useMemo(() => new Set(rows.map((r) => r.typeId)).size > 1, [rows]);

  const save = async () => {
    setError(null);
    const ids: string[] = [];
    const refs = links.map(({ type, id, auto }) => ({ type, id, auto }));
    try {
      for (const [i, r] of rows.entries()) {
        setSaving(multiple ? `Salvando ${i + 1} de ${rows.length}…` : "Salvando…");
        if (r.useExisting && r.duplicates[0]) {
          await call("documents.addLinks", { ids: [r.duplicates[0].id], links: refs });
          ids.push(r.duplicates[0].id);
          continue;
        }
        const file = await saveContent(r.prepared!, r.name);
        ids.push(
          await call("documents.create", {
            name: r.name,
            typeId: r.typeId,
            docDate: docDate || null,
            validUntil: validUntil || null,
            restricted,
            tagIds,
            description: description || null,
            links: refs,
            file,
          }),
        );
      }
      onSaved(ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <TaModal isOpen onClose={() => !saving && onClose()} title={multiple ? `Novos documentos (${rows.length})` : "Novo documento"} width="max-w-3xl">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles([...e.dataTransfer.files]);
        }}
      >
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex items-center gap-2 text-theme-xs text-gray-500">
                <FileTypeIcon mime={r.file.type} size={16} />
                <span className="min-w-0 flex-1 truncate">
                  {r.file.name} · {formatBytes(r.file.size)}
                </span>
                {!r.prepared && !r.error && (
                  <span className="flex items-center gap-1">
                    <Loader2 size={13} className="animate-spin" /> lendo arquivo…
                  </span>
                )}
                <button
                  type="button"
                  title="Tirar este arquivo"
                  className="text-gray-400 hover:text-error-600"
                  onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}
                >
                  <X size={14} />
                </button>
              </div>
              {r.error && <p className="mt-2 text-theme-xs text-error-600">{r.error}</p>}
              {r.duplicates.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-800">
                  <AlertTriangle size={14} />
                  <span className="flex-1">
                    Este arquivo já está no GED como <b>{r.duplicates[0]!.name}</b>
                    {r.duplicates[0]!.type_name ? ` (${r.duplicates[0]!.type_name})` : ""}.
                  </span>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={r.useExisting} onChange={() => update(r.key, { useExisting: true })} /> Vincular o existente
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={!r.useExisting} onChange={() => update(r.key, { useExisting: false })} /> Enviar como novo
                  </label>
                </div>
              )}
              {!r.useExisting && (
                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_240px]">
                  <TaInput
                    aria-label="Nome do documento"
                    placeholder="Nome do documento *"
                    value={r.name}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                  />
                  <TaSelect aria-label="Classificação" value={r.typeId} onChange={(e) => update(r.key, { typeId: e.target.value })}>
                    <option value="">Classificação *</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </TaSelect>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex items-center gap-1 text-theme-xs font-medium text-brand-600 hover:underline"
          >
            <Paperclip size={13} /> Adicionar mais arquivos (ou arraste para cá)
          </button>
          {multiple && firstTypeId && mixedTypes && (
            <button
              type="button"
              className="text-theme-xs font-medium text-brand-600 hover:underline"
              onClick={() => setRows((x) => x.map((y) => ({ ...y, typeId: firstTypeId })))}
            >
              Usar a classificação do 1º em todos
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = "";
            if (list.length) addFiles(list);
          }}
        />

        {toSend.length > 0 && (
          <>
            <SectionLabel>{multiple ? "Informações (valem para todos)" : "Informações"}</SectionLabel>
            <div className="grid gap-x-4 md:grid-cols-2">
              <Field label="Data do documento" hint="Ex.: data de emissão.">
                <TaInput type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
              </Field>
              <Field
                label="Validade"
                hint={
                  firstType?.valid_days && !validTouched
                    ? `Sugerida pelo tipo: ${firstType.valid_days} dias.`
                    : "Opcional. O CRM avisa quando estiver para vencer."
                }
              >
                <TaInput
                  type="date"
                  value={validUntil}
                  min={docDate || undefined}
                  onChange={(e) => {
                    setValidTouched(true);
                    setValidUntil(e.target.value);
                  }}
                />
              </Field>
              <Field label="Palavras-chave">
                <TagPicker entity="document" value={tagIds} onChange={setTagIds} />
              </Field>
              <Field label="Acesso">
                <label className="flex h-10 items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                  <Switch checked={restricted} onChange={setRestricted} />
                  <Lock size={14} className="text-gray-400" /> Restrito
                </label>
                <span className="block text-theme-xs text-gray-500">Só quem enviou, administradores e o responsável pelo cartão.</span>
              </Field>
            </div>
            <Field label="Descrição">
              <TaTextarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </>
        )}

        <SectionLabel>Vínculos</SectionLabel>
        <p className="mb-2 text-theme-xs text-gray-500">O documento aparece em todos estes cadastros. Os desta tela já vêm marcados.</p>
        <LinkEditor value={links} onChange={setLinks} />

        {error && <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
        <div className="mt-5 flex items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
          <TaButton variant="primary" disabled={!ready || !!saving} onClick={() => void save()}>
            {saving ?? "Salvar"}
          </TaButton>
          <TaButton variant="outline" disabled={!!saving} onClick={onClose}>
            Cancelar
          </TaButton>
          {!ready && rows.length > 0 && <span className="text-theme-xs text-gray-400">Dê nome e classificação a cada arquivo.</span>}
        </div>
      </div>
    </TaModal>
  );
}
