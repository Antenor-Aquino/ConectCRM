// Mesclar dois registros (spec 17): negócios/tickets/etapas, contatos ou
// organizações. Lado a lado: qual registro fica e, campo a campo, qual valor
// fica (observações/descrição podem ficar os dois). Tudo o que está ligado ao
// que sai vem junto. Sem o segundo registro, começa pela busca.
import { useEffect, useState } from "react";
import { AlertTriangle, Banknote, GitMerge } from "lucide-react";
import { TaButton, TaModal, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { MergeEntity, MergePreview } from "../../db/mergeRecords";
import { errorText } from "../../lib/errors";
import { formatDate } from "../../lib/format";
import { Combobox, type ComboItem } from "./Combobox";

type Side = "a" | "b";
type Choice = Side | "both";

const NOUN: Record<MergeEntity, { one: string; the: string }> = {
  deal: { one: "cartão", the: "o cartão" },
  person: { one: "contato", the: "o contato" },
  organization: { one: "organização", the: "a organização" },
};
const JOINABLE = new Set(["notes", "description"]);

export function MergeDialog({
  entity,
  aId,
  bId,
  search,
  onClose,
  onMerged,
}: {
  entity: MergeEntity;
  aId: string;
  /** Sem ele, escolhe-se pela busca. */
  bId?: string;
  search?: (text: string) => Promise<ComboItem[]>;
  onClose: () => void;
  /** Id do registro que ficou. */
  onMerged: (keepId: string) => void;
}) {
  const [other, setOther] = useState<string | null>(bId ?? null);
  const [picked, setPicked] = useState<ComboItem | null>(null);
  const [preview, setPreview] = useState<(MergePreview & { defaults: { takeFromRemoved: string[]; joinBoth: string[] } }) | null>(null);
  const [keep, setKeep] = useState<Side>("a");
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noun = NOUN[entity];

  /** Escolha padrão para quem fica (campos vazios completados, textos longos juntos). */
  const applyDefaults = (p: MergePreview, keepSide: Side, d: { takeFromRemoved: string[]; joinBoth: string[] }) => {
    const removed: Side = keepSide === "a" ? "b" : "a";
    const c: Record<string, Choice> = {};
    for (const g of p.groups) c[g.key] = d.joinBoth.includes(g.key) ? "both" : d.takeFromRemoved.includes(g.key) ? removed : keepSide;
    for (const f of p.custom) c[f.fieldId] = d.takeFromRemoved.includes(f.fieldId) ? removed : keepSide;
    setChoices(c);
  };

  useEffect(() => {
    if (!other) return;
    setError(null);
    void call("merge.preview", { entity, a: aId, b: other })
      .then((p) => {
        setPreview(p);
        const side: Side = p.suggestedKeep === p.b.id ? "b" : "a";
        setKeep(side);
        applyDefaults(p, side, p.defaults);
      })
      .catch((e) => setError(errorText(e)));
  }, [entity, aId, other]);

  const changeKeep = async (side: Side) => {
    if (!preview || side === keep) return;
    setKeep(side);
    const keepId = preview[side].id;
    const removeId = preview[side === "a" ? "b" : "a"].id;
    applyDefaults(preview, side, await call("merge.defaults", { entity, keepId, removeId }));
  };

  const submit = async () => {
    if (!preview) return;
    const removed: Side = keep === "a" ? "b" : "a";
    const keepRec = preview[keep];
    const removedRec = preview[removed];
    if (!confirm(`Mesclar “${removedRec.label}” em “${keepRec.label}”?\n\n“${removedRec.label}” deixa de existir e tudo o que estava ligado a ele vem para “${keepRec.label}”. Não dá para desfazer.`))
      return;
    setBusy(true);
    setError(null);
    try {
      const id = await call("merge.run", {
        entity,
        keepId: keepRec.id,
        removeId: removedRec.id,
        takeFromRemoved: Object.entries(choices)
          .filter(([, v]) => v === removed)
          .map(([k]) => k),
        joinBoth: Object.entries(choices)
          .filter(([, v]) => v === "both")
          .map(([k]) => k),
      });
      onMerged(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const cell = (key: string, side: Side, text: string | null) => {
    const on = choices[key] === side || choices[key] === "both";
    return (
      <button
        type="button"
        data-merge-pick={`${key}:${side}`}
        onClick={() => setChoices((c) => ({ ...c, [key]: side }))}
        className={cn(
          "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-theme-sm",
          on ? "border-brand-400 bg-brand-25 dark:bg-brand-500/10" : "border-gray-200 hover:border-gray-300 dark:border-gray-700",
        )}
      >
        <span className={cn("mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2", on ? "border-brand-500 bg-brand-500" : "border-gray-300")} />
        <span className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words", text ? "text-gray-800 dark:text-white/90" : "italic text-gray-400")}>{text ?? "(vazio)"}</span>
      </button>
    );
  };

  const removedSide: Side = keep === "a" ? "b" : "a";
  return (
    <TaModal isOpen onClose={onClose} title={entity === "organization" ? "Mesclar organizações" : `Mesclar ${noun.one}s`} width="max-w-4xl">
      <div data-merge-dialog className="space-y-4 text-theme-sm text-gray-700 dark:text-gray-300">
        {!other && search && (
          <div>
            <p className="mb-2">Escolha {noun.the} duplicad{entity === "organization" ? "a" : "o"} para mesclar com este registro.</p>
            <Combobox
              value={picked}
              onChange={(it) => {
                setPicked(it);
                if (it) setOther(it.id);
              }}
              search={async (t) => (await search(t)).filter((i) => i.id !== aId)}
              placeholder={`Buscar ${noun.one}`}
            />
          </div>
        )}
        {preview && (
          <>
            <div className="grid grid-cols-[160px_1fr_1fr] items-stretch gap-2">
              <span className="self-center text-theme-xs font-semibold uppercase text-gray-500">Fica</span>
              {(["a", "b"] as Side[]).map((s) => {
                const r = preview[s];
                const locked = !!preview.blocked || (preview[s === "a" ? "b" : "a"].finance && !r.finance);
                return (
                  <button
                    key={s}
                    type="button"
                    data-merge-keep={s}
                    disabled={locked}
                    onClick={() => void changeKeep(s)}
                    className={cn(
                      "rounded-xl border-2 px-3 py-2.5 text-left disabled:cursor-not-allowed",
                      keep === s ? "border-success-500 bg-success-50 dark:bg-success-500/10" : "border-gray-200 opacity-80 dark:border-gray-700",
                    )}
                  >
                    <span className="block truncate font-semibold text-gray-800 dark:text-white/90">{r.label}</span>
                    <span className="block text-theme-xs text-gray-500">
                      {keep === s ? "Fica" : "Sai (vem tudo para o outro)"} · criado em {formatDate(r.createdAt)}
                    </span>
                    {r.finance && (
                      <span className="mt-1 flex items-center gap-1 text-theme-xs text-warning-700">
                        <Banknote size={12} /> Ligado à Gestão Financeira
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {preview.blocked && (
              <p className="flex gap-2 rounded-lg bg-error-50 px-3 py-2 text-error-700" data-merge-blocked>
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {preview.blocked}
              </p>
            )}
            {!preview.blocked && (
              <>
                <div className="max-h-[48vh] space-y-1.5 overflow-y-auto pr-1">
                  {[...preview.groups.map((g) => ({ key: g.key, label: g.label, a: g.a, b: g.b })), ...preview.custom.map((f) => ({ key: f.fieldId, label: f.label, a: f.a, b: f.b }))].map((g) => (
                    <div key={g.key} className="grid grid-cols-[160px_1fr_1fr] gap-2" data-merge-field={g.key}>
                      <span className="pt-2 text-theme-xs font-medium text-gray-500">
                        {g.label}
                        {JOINABLE.has(g.key) && g.a && g.b && (
                          <button
                            type="button"
                            data-merge-both={g.key}
                            onClick={() => setChoices((c) => ({ ...c, [g.key]: "both" }))}
                            className={cn("mt-1 block rounded px-1.5 py-0.5 text-[11px]", choices[g.key] === "both" ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-600 dark:bg-white/5")}
                          >
                            Os dois juntos
                          </button>
                        )}
                      </span>
                      {cell(g.key, "a", g.a)}
                      {cell(g.key, "b", g.b)}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/5" data-merge-related>
                  <p className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-white/90">
                    <GitMerge size={15} /> Vem de “{preview[removedSide].label}” para “{preview[keep].label}”
                  </p>
                  <p className="mt-0.5 text-theme-xs text-gray-500">
                    {preview[removedSide].related.length
                      ? preview[removedSide].related.map((r) => r.text).join(" · ")
                      : "Nada ligado além dos campos"}
                    {" · e também histórico, vínculos de importação, tarefas do To Do e envios de WhatsApp."}
                  </p>
                </div>
              </>
            )}
          </>
        )}
        {error && <p className="rounded-lg bg-error-50 px-3 py-2 text-error-700">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-theme-xs text-gray-500">O registro que sai deixa de existir (não vai para a lixeira).</span>
          <TaButton variant="ghost" onClick={onClose}>
            Cancelar
          </TaButton>
          <TaButton variant="primary" startIcon={<GitMerge size={15} />} disabled={!preview || !!preview.blocked || busy} data-merge-run onClick={() => void submit()}>
            Mesclar
          </TaButton>
        </div>
      </div>
    </TaModal>
  );
}
