// Campo personalizado do tipo Documento: escolhe um documento do GED (ou
// envia um novo) e mostra nome + validade, com prévia ao clicar.
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { call } from "../../rpc/client";
import { Combobox, type ComboItem } from "../ui/Combobox";
import { DocumentViewer } from "./DocumentViewer";
import { ValidityBadge } from "./docUi";
import { UploadModal } from "./UploadModal";

async function searchDocuments(text: string): Promise<ComboItem[]> {
  const { items } = await call("documents.list", { search: text, limit: 10 });
  return items.map((d) => ({ id: d.id, label: d.name, sublabel: [d.type_name, d.valid_until && `validade ${d.valid_until.split("-").reverse().join("/")}`].filter(Boolean).join(" · ") }));
}

export function DocumentFieldInput({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [item, setItem] = useState<ComboItem | null>(null);
  const [upload, setUpload] = useState<File[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!value) return setItem(null);
    if (item?.id === value) return;
    void call("documents.get", { id: value })
      .then((d) => setItem(d ? { id: d.id, label: d.name } : null))
      .catch(() => setItem({ id: value, label: "Documento sem acesso" }));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex items-start gap-1.5">
      <div className="min-w-0 flex-1">
        <Combobox
          value={item}
          onChange={(i) => {
            setItem(i);
            onChange(i?.id ?? null);
          }}
          search={searchDocuments}
          placeholder="Buscar no GED"
        />
      </div>
      <button
        type="button"
        title="Enviar um documento novo"
        onClick={() => input.current?.click()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:text-brand-600 dark:border-gray-700"
      >
        <Upload size={15} />
      </button>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setUpload([f]);
        }}
      />
      {upload && (
        <UploadModal
          files={upload}
          onClose={() => setUpload(null)}
          onSaved={(ids) => {
            setUpload(null);
            if (ids[0]) {
              setItem(null);
              onChange(ids[0]);
            }
          }}
        />
      )}
    </div>
  );
}

export function DocumentFieldView({ id }: { id: string }) {
  const [doc, setDoc] = useState<{ name: string; valid_until: string | null } | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void call("documents.get", { id })
      .then((d) => setDoc(d && !d.deleted_at ? d : null))
      .catch(() => setDoc(null));
  }, [id]);
  if (doc === undefined) return null;
  if (!doc) return <span className="text-gray-400">Documento indisponível</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button type="button" className="text-brand-600 hover:underline" onClick={() => setOpen(true)}>
        {doc.name}
      </button>
      <ValidityBadge validUntil={doc.valid_until} />
      {open && <DocumentViewer documentId={id} onClose={() => setOpen(false)} />}
    </span>
  );
}
