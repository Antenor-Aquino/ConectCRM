// Visão em lista: edição rápida de uma célula (valor, etapa, tags, datas,
// responsável, origem, descrição e campos personalizados do cartão). Abre um
// painel flutuante sobre a célula; Enter/Salvar grava, Esc/clicar fora cancela.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { TaButton, TaInput, TaSelect, TaTextarea } from "@tailadmin";
import { call } from "../../rpc/client";
import type { CustomField, CustomValue } from "../../db/customFields";
import type { CardDetail } from "../../db/deals";
import type { TagEntity } from "../../db/tags";
import { errorText } from "../../lib/errors";
import { fromDateInput, toDateInput } from "../../lib/format";
import { FieldInput } from "../ui/CustomFieldsForm";
import { MoneyInput } from "../ui/MoneyInput";
import { SlaPicker } from "../ui/SlaPicker";
import { TagPicker } from "../ui/TagPicker";
import { UserSelect } from "../ui/UserSelect";

/** Colunas da lista que dá para editar na própria célula. */
const EDITABLE = new Set(["etapa", "valor", "previsao_fechamento", "inicio", "prazo", "sla", "descricao", "tags", "responsavel", "origem"]);

export function isEditableListKey(key: string): boolean {
  return EDITABLE.has(key) || key.startsWith("cf:");
}

type Patch = Record<string, unknown>;

export function ListCellEditor({
  cardId,
  fieldKey,
  label,
  stages,
  anchor,
  onClose,
  onSaved,
}: {
  cardId: string;
  fieldKey: string;
  label: string;
  stages: { id: string; name: string }[];
  /** Célula clicada (posição na tela). */
  anchor: DOMRect;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<CardDetail | null>(null);
  const [field, setField] = useState<CustomField | null>(null);
  const [draft, setDraft] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.left, top: anchor.bottom + 4 });
  const cfId = fieldKey.startsWith("cf:") ? fieldKey.slice(3) : null;

  useEffect(() => {
    void (async () => {
      try {
        const c = await call("cards.get", { id: cardId });
        if (!c) return setError("Cartão não encontrado.");
        let f: CustomField | null = null;
        if (cfId) {
          f = (await call("customFields.list", { entity: c.kind, dealId: cardId })).find((x) => x.id === cfId) ?? null;
          if (!f) return setError("Este campo não vale para este cartão.");
        }
        setCard(c);
        setField(f);
        setDraft(initial(fieldKey, c, f));
      } catch (e) {
        setError(errorText(e));
      }
    })();
  }, [cardId, fieldKey, cfId]);

  // Fica dentro da tela: abre para cima quando não cabe embaixo.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8));
    const below = anchor.bottom + 4;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, anchor.top - h - 4) : below;
    setPos({ left, top });
  }, [anchor, card, error]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const save = async () => {
    if (!card || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (fieldKey === "etapa") {
        if (draft !== card.stage_id) await call("cards.move", { id: cardId, stageId: String(draft) });
      } else {
        await call("cards.update", { id: cardId, patch: toPatch(fieldKey, draft, cfId) as never });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const set = (v: unknown) => setDraft(v);
  let editor: ReactNode = null;
  if (card && draft !== undefined) {
    switch (fieldKey) {
      case "etapa":
        editor = (
          <TaSelect value={String(draft)} onChange={(e) => set(e.target.value)} autoFocus>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </TaSelect>
        );
        break;
      case "valor":
        editor = (
          <>
            <MoneyInput value={Number(draft) || 0} onChange={set} />
            {!!card.value_from_items && <p className="mt-1 text-[11px] text-gray-500">Hoje o valor vem dos produtos; ao salvar ele passa a ser informado à mão.</p>}
          </>
        );
        break;
      case "previsao_fechamento":
      case "inicio":
      case "prazo":
        editor = <TaInput type="date" value={String(draft ?? "")} onChange={(e) => set(e.target.value)} autoFocus />;
        break;
      case "sla":
        editor = <SlaPicker value={(draft as string | null) ?? null} onChange={set} />;
        break;
      case "descricao":
        editor = <TaTextarea rows={4} value={String(draft ?? "")} onChange={(e) => set(e.target.value)} autoFocus />;
        break;
      case "origem":
        editor = <TaInput value={String(draft ?? "")} onChange={(e) => set(e.target.value)} autoFocus />;
        break;
      case "tags":
        editor = <TagPicker entity={card.kind as TagEntity} value={draft as string[]} onChange={set} />;
        break;
      case "responsavel":
        editor = <UserSelect value={(draft as string | null) ?? null} onChange={set} />;
        break;
      default:
        if (field) editor = <FieldInput field={field} value={draft as CustomValue} onChange={set} />;
    }
  }

  return (
    <div
      ref={ref}
      data-list-cell-editor
      className="fixed z-[100000] w-80 rounded-xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Enter grava (menos na descrição/texto longo, onde é quebra de linha).
        if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <p className="mb-2 text-theme-xs font-semibold uppercase text-gray-500">{label}</p>
      {!card && !error && <p className="text-theme-sm text-gray-400">Carregando…</p>}
      {editor}
      {error && <p className="mt-2 rounded-lg bg-error-50 px-2 py-1.5 text-theme-xs text-error-700">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <TaButton size="sm" variant="outline" onClick={onClose}>
          Cancelar
        </TaButton>
        <TaButton size="sm" variant="primary" disabled={!card || busy} onClick={() => void save()}>
          Salvar
        </TaButton>
      </div>
    </div>
  );
}

function initial(key: string, c: CardDetail, f: CustomField | null): unknown {
  switch (key) {
    case "etapa":
      return c.stage_id;
    case "valor":
      return c.value_cents;
    case "previsao_fechamento":
      return toDateInput(c.expected_close_at);
    case "inicio":
      return toDateInput(c.start_at);
    case "prazo":
      return toDateInput(c.due_at);
    case "sla":
      return c.sla_at;
    case "descricao":
      return c.description ?? "";
    case "origem":
      return c.origin ?? "";
    case "tags":
      return c.tags.map((t) => t.id);
    case "responsavel":
      return c.owner_id;
    default:
      return f ? (c.customValues[f.id] ?? null) : null;
  }
}

/** Rascunho da célula → patch de cards.update. */
export function toPatch(key: string, v: unknown, cfId: string | null = null): Patch {
  switch (key) {
    case "valor":
      return { valueCents: Number(v) || 0 };
    case "previsao_fechamento":
      return { expectedCloseAt: fromDateInput(String(v ?? "")) };
    case "inicio":
      return { startAt: fromDateInput(String(v ?? "")) };
    case "prazo":
      return { dueAt: fromDateInput(String(v ?? "")) };
    case "sla":
      return { slaAt: (v as string | null) ?? null };
    case "descricao":
      return { description: String(v ?? "") };
    case "origem":
      return { origin: String(v ?? "") };
    case "tags":
      return { tagIds: v as string[] };
    case "responsavel":
      return { ownerId: (v as string | null) ?? null };
    default:
      if (!cfId) throw new Error(`Coluna ${key} não é editável.`);
      return { customValues: { [cfId]: (v as CustomValue) ?? null } };
  }
}
