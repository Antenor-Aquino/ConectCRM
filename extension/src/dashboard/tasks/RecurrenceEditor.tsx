// Campo "Repetir" da atividade (spec 02, recorrentes): diária, dias úteis,
// semanal (dias da semana), mensal (dia ou "2ª terça"), anual, a cada X dias;
// termina nunca, em data ou após N vezes; e "repetir só depois de concluir".
// Embaixo, a frase da regra. Também a escolha "só esta / as próximas / todas".
import { Repeat } from "lucide-react";
import { TaButton, TaInput, TaModal, TaSelect, cn } from "@tailadmin";
import { describeRule, monthlyOrdinal, type RecurrenceRule } from "../../lib/recurrence";

type Preset = "none" | "daily" | "workdays" | "weekly" | "monthly" | "yearly" | "every";

const PRESET_LABEL: Record<Preset, string> = {
  none: "Não repete",
  daily: "Diária",
  workdays: "Dias úteis (segunda a sexta)",
  weekly: "Semanal",
  monthly: "Mensal",
  yearly: "Anual",
  every: "A cada X dias",
};
const DAY_LETTER = ["D", "S", "T", "Q", "Q", "S", "S"];
const DAY_NAME = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ORD = { 1: "1ª", 2: "2ª", 3: "3ª", 4: "4ª", [-1]: "última" } as Record<number, string>;

function presetOf(r: RecurrenceRule | null): Preset {
  if (!r) return "none";
  if (r.freq === "daily") return r.workdaysOnly && r.interval === 1 ? "workdays" : r.interval === 1 ? "daily" : "every";
  return r.freq;
}

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function RecurrenceEditor({ value, start, onChange }: { value: RecurrenceRule | null; start: Date; onChange: (r: RecurrenceRule | null) => void }) {
  const preset = presetOf(value);
  const set = (patch: Partial<RecurrenceRule>) => value && onChange({ ...value, ...patch });
  const choose = (p: Preset) => {
    const end = value?.end ?? { type: "never" as const };
    const afterDone = value?.afterDone;
    if (p === "none") return onChange(null);
    if (p === "daily") return onChange({ freq: "daily", interval: 1, end, afterDone });
    if (p === "workdays") return onChange({ freq: "daily", interval: 1, workdaysOnly: true, end, afterDone });
    if (p === "every") return onChange({ freq: "daily", interval: value?.freq === "daily" && value.interval > 1 ? value.interval : 15, end, afterDone });
    if (p === "weekly") return onChange({ freq: "weekly", interval: 1, weekdays: [start.getDay()], end, afterDone });
    if (p === "monthly") return onChange({ freq: "monthly", interval: 1, monthly: "day", end, afterDone });
    onChange({ freq: "yearly", interval: 1, end, afterDone });
  };
  const ord = monthlyOrdinal(start);
  // "Só depois de concluir" não combina com vários dias da semana.
  const afterDoneAllowed = !!value && !(value.freq === "weekly" && (value.weekdays?.length ?? 0) > 1);

  return (
    <div data-recurrence>
      <TaSelect value={preset} aria-label="Repetir" onChange={(e) => choose(e.target.value as Preset)}>
        {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
          <option key={p} value={p}>
            {PRESET_LABEL[p]}
          </option>
        ))}
      </TaSelect>
      {value && (
        <div className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3 text-theme-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
          {(preset === "every" || preset === "weekly" || preset === "monthly" || preset === "yearly") && (
            <label className="flex items-center gap-2">
              A cada
              <TaInput
                type="number"
                min={1}
                max={365}
                className="w-20"
                aria-label="Intervalo"
                value={value.interval}
                onChange={(e) => set({ interval: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
              />
              {{ every: "dias", weekly: "semana(s)", monthly: "mês(es)", yearly: "ano(s)" }[preset as "every"]}
            </label>
          )}
          {preset === "every" && (
            <label className="flex items-center gap-2 text-theme-xs">
              <input type="checkbox" checked={!!value.workdaysOnly} onChange={(e) => set({ workdaysOnly: e.target.checked || undefined })} /> Só em dias úteis
            </label>
          )}
          {preset === "weekly" && (
            <div className="flex gap-1" role="group" aria-label="Dias da semana">
              {DAY_LETTER.map((l, i) => {
                const on = (value.weekdays ?? [start.getDay()]).includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    title={DAY_NAME[i]}
                    aria-pressed={on}
                    onClick={() => {
                      const cur = value.weekdays ?? [start.getDay()];
                      const next = on ? cur.filter((x) => x !== i) : [...cur, i];
                      if (next.length) set({ weekdays: next.sort(), ...(next.length > 1 ? { afterDone: undefined } : {}) });
                    }}
                    className={cn(
                      "h-8 w-8 rounded-full text-theme-xs font-semibold",
                      on ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-300",
                    )}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          )}
          {preset === "monthly" && (
            <div className="flex flex-col gap-1 text-theme-xs">
              <label className="flex items-center gap-2">
                <input type="radio" checked={value.monthly !== "weekday"} onChange={() => set({ monthly: "day" })} /> No dia {start.getDate()}
                {start.getDate() > 28 && " (ou no último dia do mês)"}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={value.monthly === "weekday"} onChange={() => set({ monthly: "weekday" })} /> Na {ORD[ord.nth]} {DAY_NAME[ord.weekday]!.toLowerCase()}
              </label>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            Termina
            <TaSelect
              className="w-36"
              aria-label="Termina"
              value={value.end.type}
              onChange={(e) => {
                const t = e.target.value;
                set({ end: t === "until" ? { type: "until", date: inDays(90) } : t === "count" ? { type: "count", count: 10 } : { type: "never" } });
              }}
            >
              <option value="never">Nunca</option>
              <option value="until">Em uma data</option>
              <option value="count">Após N vezes</option>
            </TaSelect>
            {value.end.type === "until" && (
              <TaInput type="date" className="w-40" aria-label="Data final" value={value.end.date} onChange={(e) => e.target.value && set({ end: { type: "until", date: e.target.value } })} />
            )}
            {value.end.type === "count" && (
              <label className="flex items-center gap-1">
                <TaInput
                  type="number"
                  min={1}
                  max={1000}
                  className="w-20"
                  aria-label="Quantas vezes"
                  value={value.end.count}
                  onChange={(e) => set({ end: { type: "count", count: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) } })}
                />
                vezes
              </label>
            )}
          </div>
          {afterDoneAllowed && (
            <label className="flex items-start gap-2 text-theme-xs">
              <input type="checkbox" className="mt-0.5" checked={!!value.afterDone} onChange={(e) => set({ afterDone: e.target.checked || undefined })} />
              <span>
                Repetir só depois de concluir a atual
                <span className="block text-gray-500">A próxima é criada ao concluir, contando da conclusão (ex.: ligar 30 dias depois do último contato).</span>
              </span>
            </label>
          )}
          <p className="flex items-start gap-1.5 text-theme-xs text-brand-700 dark:text-brand-300" data-recurrence-summary>
            <Repeat size={13} className="mt-0.5 shrink-0" /> {describeRule(value, start)}
          </p>
        </div>
      )}
    </div>
  );
}

export type Scope = "this" | "following" | "all";

/** "Alterar/Excluir: só esta, esta e as próximas, todas". */
export function ScopeDialog({
  action,
  ruleChanged,
  onChoose,
  onClose,
}: {
  action: "save" | "delete";
  /** Mudou a regra ou a data: "só esta" não se aplica. */
  ruleChanged?: boolean;
  onChoose: (s: Scope) => void;
  onClose: () => void;
}) {
  const verb = action === "save" ? "Alterar" : "Excluir";
  const options: { scope: Scope; label: string; hint: string }[] = [
    ...(!ruleChanged ? [{ scope: "this" as const, label: `${verb} só esta`, hint: "As outras ocorrências continuam como estão." }] : []),
    { scope: "following", label: `${verb} esta e as próximas`, hint: action === "save" ? "As anteriores ficam como estão." : "A série termina antes desta." },
    { scope: "all", label: `${verb} todas`, hint: action === "save" ? "Vale para todas as pendentes; as concluídas ficam como histórico." : "Tira as pendentes e encerra a série; as concluídas ficam." },
  ];
  return (
    <TaModal isOpen onClose={onClose} title={`${verb} atividade recorrente`} width="max-w-md">
      <div className="space-y-2" data-scope-dialog>
        {options.map((o) => (
          <button
            key={o.scope}
            type="button"
            onClick={() => onChoose(o.scope)}
            className="block w-full rounded-xl border border-gray-200 px-4 py-3 text-left hover:border-brand-300 hover:bg-brand-25 dark:border-gray-800 dark:hover:bg-white/5"
          >
            <span className="block text-theme-sm font-medium text-gray-800 dark:text-white/90">{o.label}</span>
            <span className="block text-theme-xs text-gray-500">{o.hint}</span>
          </button>
        ))}
        {action === "delete" && <p className="text-theme-xs text-gray-500">Tudo vai para a lixeira e pode ser restaurado.</p>}
        <div className="pt-2 text-right">
          <TaButton size="sm" onClick={onClose}>
            Cancelar
          </TaButton>
        </div>
      </div>
    </TaModal>
  );
}
