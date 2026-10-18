// Classificação do documento (GED) com busca: digitar um tipo que não existe
// oferece "Criar classificação" e já seleciona o novo tipo.
import { useCallback, useEffect, useState } from "react";
import { call } from "../../rpc/client";
import type { DocumentType } from "../../db/documents";
import { normalizeText } from "../../lib/search";
import { Combobox, type ComboItem } from "../ui/Combobox";

export function DocumentTypePicker({
  value,
  onChange,
  onCreated,
  preferred,
  placeholder = "Classificação *",
}: {
  /** Id do tipo ("" = nenhum). */
  value: string;
  onChange: (id: string) => void;
  /** Avisa quem também guarda a lista de tipos (ex.: validade sugerida). */
  onCreated?: () => void;
  /** Nome do tipo escolhido ao abrir, se nada estiver escolhido. */
  preferred?: string;
  placeholder?: string;
}) {
  const [types, setTypes] = useState<DocumentType[]>([]);
  const load = useCallback(() => call("documentTypes.list", { includeInactive: true }).then((list) => (setTypes(list), list)), []);
  useEffect(() => {
    void load().then((list) => {
      const p = preferred && list.find((t) => t.active && t.name === preferred);
      if (p && !value) onChange(p.id);
    });
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = types.find((t) => t.id === value);
  const item: ComboItem | null = current ? { id: current.id, label: current.name } : null;
  const search = async (text: string): Promise<ComboItem[]> => {
    const q = normalizeText(text);
    return types.filter((t) => t.active && (!q || normalizeText(t.name).includes(q))).map((t) => ({ id: t.id, label: t.name }));
  };
  const create = async (name: string): Promise<ComboItem> => {
    // Nome que já existe (sem acento/maiúsculas): usa o existente.
    const same = types.find((t) => t.active && normalizeText(t.name) === normalizeText(name));
    if (same) return { id: same.id, label: same.name };
    const id = await call("documentTypes.create", { name: name.trim() });
    await load();
    onCreated?.();
    return { id, label: name.trim() };
  };

  return <Combobox value={item} onChange={(i) => onChange(i?.id ?? "")} search={search} placeholder={placeholder} onCreate={create} createLabel="Criar classificação" />;
}
