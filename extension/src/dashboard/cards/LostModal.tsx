// Marcar como perdido: motivo (cadastro rápido) e observação.
import { useEffect, useState } from "react";
import { TaButton, TaInput, TaModal, TaSelect, TaTextarea } from "@tailadmin";
import { call } from "../../rpc/client";
import { ErrorText, Field } from "../ui/form";

export function LostModal({ cardId, onClose, onDone }: { cardId: string | null; onClose: () => void; onDone: () => void }) {
  const [reasons, setReasons] = useState<{ id: string; name: string }[]>([]);
  const [reasonId, setReasonId] = useState("");
  const [newReason, setNewReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId) return;
    setReasonId("");
    setNewReason("");
    setNote("");
    setError(null);
    void call("lossReasons.list", {}).then(setReasons);
  }, [cardId]);

  async function confirm() {
    try {
      let id = reasonId === "__new" ? "" : reasonId;
      if (reasonId === "__new") id = await call("lossReasons.create", { name: newReason });
      await call("cards.setStatus", { id: cardId!, status: "lost", lossReasonId: id || null, lossNote: note });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <TaModal isOpen={cardId !== null} onClose={onClose} title="Marcar como perdido" accent="var(--color-error-500)">
      <Field label="Motivo da perda">
        <TaSelect value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          <option value="">Sem motivo</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          <option value="__new">+ Novo motivo…</option>
        </TaSelect>
      </Field>
      {reasonId === "__new" && (
        <Field label="Novo motivo">
          <TaInput autoFocus value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="Ex.: Preço" />
        </Field>
      )}
      <Field label="Observação">
        <TaTextarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="mt-4 flex justify-end gap-2">
        <TaButton onClick={onClose}>Cancelar</TaButton>
        <TaButton variant="danger" onClick={() => void confirm()}>
          Marcar como perdido
        </TaButton>
      </div>
    </TaModal>
  );
}
