// Mesclar duplicado: escolhe o outro registro; ele é incorporado a este.
import { useState } from "react";
import { TaButton, TaModal } from "@tailadmin";
import { Combobox, type ComboItem } from "../ui/Combobox";
import { ErrorText } from "../ui/form";

export function MergeModal({
  keepName,
  keepId,
  noun,
  search,
  onMerge,
  onClose,
}: {
  keepName: string;
  keepId: string;
  noun: "contato" | "organização";
  search: (text: string) => Promise<ComboItem[]>;
  onMerge: (removeId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [other, setOther] = useState<ComboItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <TaModal isOpen onClose={onClose} title={`Mesclar ${noun}`}>
      <p className="mb-3 text-theme-sm text-gray-600 dark:text-gray-300">
        Escolha o cadastro duplicado. Negócios, tarefas, notas, vínculos, tags e campos dele passam para <b>{keepName}</b>, e o duplicado vai para a lixeira.
      </p>
      <Combobox value={other} onChange={setOther} search={async (t) => (await search(t)).filter((i) => i.id !== keepId)} placeholder={`Buscar ${noun} duplicado`} />
      <ErrorText>{error}</ErrorText>
      <div className="mt-5 flex justify-end gap-2">
        <TaButton onClick={onClose}>Cancelar</TaButton>
        <TaButton
          variant="primary"
          disabled={!other}
          onClick={async () => {
            if (!other || !confirm(`Mesclar "${other.label}" em "${keepName}"? Esta ação não pode ser desfeita pela tela.`)) return;
            try {
              await onMerge(other.id);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Mesclar
        </TaButton>
      </div>
    </TaModal>
  );
}
