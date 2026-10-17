// Menu Contatos: lista com busca, filtros (responsável, tag), colunas,
// paginação, exportar e importar planilha.
import { useCallback, useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { TaSelect } from "@tailadmin";
import { call } from "../../rpc/client";
import type { PersonListItem } from "../../db/contacts";
import type { Tag } from "../../db/tags";
import { downloadSpreadsheet } from "../../lib/spreadsheet";
import { useSession } from "../session";
import { Avatar } from "../ui/Avatar";
import { DataList, PAGE_SIZE, type Column } from "../ui/DataList";
import { useImages } from "../ui/ImageUpload";
import { formatPhone } from "../ui/PhoneInput";
import { ImportModal, type ImportField } from "./ImportModal";

const IMPORT_FIELDS: ImportField[] = [
  { key: "name", label: "Nome", required: true, aliases: ["nome", "name", "contato", "nome do contato"] },
  { key: "email", label: "E-mail", aliases: ["email", "e-mail", "mail"] },
  { key: "phone", label: "Celular", aliases: ["celular", "telefone", "whatsapp", "fone", "phone", "telefone celular"] },
  { key: "organizationName", label: "Organização", aliases: ["organizacao", "organização", "empresa", "company"] },
  { key: "notes", label: "Notas", aliases: ["notas", "observacoes", "observações", "obs"] },
];

export function PersonsView({ refreshKey, onOpen, onNew }: { refreshKey: number; onOpen: (id: string) => void; onNew: () => void }) {
  const { users } = useSession();
  const [rows, setRows] = useState<PersonListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [tagId, setTagId] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [importing, setImporting] = useState(false);
  const [customNames, setCustomNames] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const avatars = useImages(rows.map((r) => r.avatar_id));

  const filter = { search, ownerId: ownerId || undefined, tagIds: tagId ? [tagId] : undefined };
  const load = useCallback(async () => {
    const [list, count] = await Promise.all([
      call("persons.list", { ...filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      call("persons.count", filter),
    ]);
    setRows(list);
    setTotal(count);
  }, [search, ownerId, tagId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, refreshKey, reload, search]);
  useEffect(() => setPage(0), [search, ownerId, tagId]);
  useEffect(() => {
    void call("tags.list", { entity: "person" }).then(setTags);
    void call("customFields.list", { entity: "person" }).then((f) => setCustomNames(f.map((x) => x.name)));
  }, []);

  const columns: Column<PersonListItem>[] = [
    {
      key: "name",
      label: "Nome",
      render: (r) => (
        <span className="flex items-center gap-2 font-medium text-gray-800 dark:text-white/90">
          {r.avatar_id && avatars[r.avatar_id] ? <img src={avatars[r.avatar_id]} alt="" className="h-7 w-7 rounded-full object-cover" /> : <Avatar name={r.name} size={28} />}
          {r.name}
          {!!r.is_private && <Lock size={12} className="text-gray-400" />}
        </span>
      ),
    },
    { key: "org", label: "Organização", render: (r) => r.primary_organization_name ?? "—" },
    { key: "email", label: "E-mail", render: (r) => r.email ?? "—" },
    { key: "phone", label: "Celular", render: (r) => formatPhone(r.phone) || "—", className: "whitespace-nowrap" },
    { key: "owner", label: "Responsável", render: (r) => r.owner_name ?? "—" },
  ];

  async function exportExcel() {
    const all = await call("persons.list", { ...filter, limit: 100_000, offset: 0 });
    downloadSpreadsheet(
      `contatos-${new Date().toISOString().slice(0, 10)}.xlsx`,
      "Contatos",
      ["Nome", "Organização", "E-mail", "Celular", "Responsável", "Notas"],
      all.map((r) => [r.name, r.primary_organization_name, r.email, formatPhone(r.phone), r.owner_name, r.notes]),
    );
  }

  return (
    <>
      <DataList
        title="Contatos"
        storageKey="conectcrm-cols-persons"
        columns={columns}
        rows={rows}
        total={total}
        page={page}
        onPage={setPage}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Pesquisar por nome, e-mail ou telefone…"
        filters={
          <>
            <TaSelect className="w-48" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Responsável: todos</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </TaSelect>
            {tags.length > 0 && (
              <TaSelect className="w-40" value={tagId} onChange={(e) => setTagId(e.target.value)}>
                <option value="">Tag: todas</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </TaSelect>
            )}
          </>
        }
        onNew={onNew}
        newLabel="Contato"
        onExport={() => void exportExcel()}
        onImport={() => setImporting(true)}
        onRowClick={(r) => onOpen(r.id)}
        empty={search || ownerId || tagId ? "Nenhum contato encontrado com esses filtros." : "Nenhum contato cadastrado ainda."}
      />
      {importing && (
        <ImportModal
          title="Importar contatos"
          fields={IMPORT_FIELDS}
          customFieldNames={customNames}
          onImport={(rows) => call("persons.import", { rows: rows as never })}
          onClose={() => {
            setImporting(false);
            setReload((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
