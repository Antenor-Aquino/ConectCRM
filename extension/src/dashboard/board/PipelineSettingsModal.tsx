// Editar funil (menu ⋯ do quadro): nome, etapas (cor, ordem, probabilidade,
// dias para "parado"), excluir etapa movendo os cartões, campos exibidos no
// cartão (aba Cartão) e arquivar o funil.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { DragHandle, moveItem, useDragSort } from "../ui/dragSort";
import { TaButton, TaInput, TaSelect, badgePalette, type BadgeColor, cn } from "@tailadmin";
import { GuardedModal } from "../ui/GuardedModal";
import { call } from "../../rpc/client";
import type { Pipeline } from "../../db/pipelines";
import { DEFAULT_CARD_FIELDS, parseCardFields } from "../../lib/cardFields";
import { PIPELINE_TYPE_LABEL } from "../../lib/cardTypes";
import { CardLayoutEditor } from "./CardLayoutEditor";
import { CARD_TEXT } from "../../lib/cardTypes";
import { DetailLayoutEditor } from "./DetailLayoutEditor";
import { fieldGroups } from "../../lib/fieldGroups";
import { isDefaultLayout, parseDetailLayout, resolveDetailLayout, type DetailItem } from "../../lib/detailLayout";
import type { CustomField } from "../../db/customFields";
import { ErrorText, Field, SectionLabel } from "../ui/form";
import { colorLabel } from "../../lib/colors";
import { StagesPreview } from "../ui/StageSelect";
import { errorText } from "../../lib/errors";

const COLORS = Object.keys(badgePalette) as BadgeColor[];

interface Draft {
  id?: string;
  /** Chave estável na tela (arrastar e soltar), também para etapas novas. */
  uid: string;
  name: string;
  color: string;
  probability: string;
  staleDays: string;
}

export function PipelineSettingsModal({ pipeline, onClose, onSaved }: { pipeline: Pipeline | null; onClose: () => void; onSaved: (archived: boolean) => void }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [stages, setStages] = useState<Draft[]>([]);
  const [original, setOriginal] = useState<{ id: string; name: string }[]>([]);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"etapas" | "cartao" | "ficha">("etapas");
  const [cardKeys, setCardKeys] = useState<string[]>([]);
  const [detailFields, setDetailFields] = useState<CustomField[]>([]);
  const [detail, setDetail] = useState<DetailItem[]>([]);

  useEffect(() => {
    if (!pipeline) return;
    setName(pipeline.name);
    setCompany(pipeline.company_name ?? "");
    setTab("etapas");
    setCardKeys(parseCardFields(pipeline.card_fields, pipeline.type));
    void call("customFields.list", { entity: CARD_TEXT[pipeline.type].kind, pipelineId: pipeline.id }).then((list) => {
      // Mesma ordem da ficha: por categoria, como no cadastro.
      const visible = fieldGroups(list.filter((f) => !f.hidden)).flatMap((g) => g.fields);
      setDetailFields(visible);
      setDetail(resolveDetailLayout(parseDetailLayout(pipeline.detail_layout), pipeline.type, visible.map((f) => f.id)));
    });
    setError(null);
    setMoveTo({});
    void call("stages.list", { pipelineId: pipeline.id }).then((list) => {
      setOriginal(list.map((s) => ({ id: s.id, name: s.name })));
      setStages(
        list.map((s) => ({ id: s.id, uid: s.id, name: s.name, color: s.color ?? "slate", probability: s.probability?.toString() ?? "", staleDays: s.stale_days?.toString() ?? "" })),
      );
    });
  }, [pipeline]);

  if (!pipeline) return null;
  const removed = original.filter((o) => !stages.some((s) => s.id === o.id));
  const keptIds = stages.filter((s) => s.id);
  const set = (i: number, patch: Partial<Draft>) => setStages((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const drag = useDragSort({
    onMove: (from, to) => setStages((l) => moveItem(l, l.findIndex((x) => x.uid === from), l.findIndex((x) => x.uid === to))),
  });

  async function save() {
    setError(null);
    try {
      const isDefault = JSON.stringify(cardKeys) === JSON.stringify(DEFAULT_CARD_FIELDS[pipeline!.type]);
      const detailDefault = isDefaultLayout(detail, pipeline!.type, detailFields.map((f) => f.id));
      await call("pipelines.update", {
        id: pipeline!.id,
        patch: { name, companyName: company, cardFields: isDefault ? null : cardKeys, detailLayout: detail.length && !detailDefault ? detail : null },
      });
      await call("stages.save", {
        pipelineId: pipeline!.id,
        stages: stages.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          probability: s.probability === "" ? null : Number(s.probability),
          staleDays: s.staleDays === "" ? null : Number(s.staleDays),
        })),
        moveTo,
      });
      onSaved(false);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <GuardedModal isOpen onClose={onClose} title="Editar funil" width="max-w-3xl">
      <Field label="Nome do funil" required>
        <TaInput value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <p className="text-theme-xs text-gray-500">Tipo: {PIPELINE_TYPE_LABEL[pipeline.type]} (não pode ser alterado).</p>
      <Field label="Empresa" hint="Opcional. Assina os lembretes por WhatsApp das atividades dos cartões deste funil (ex.: “Antenor · AEB Sistemas”).">
        <TaInput value={company} placeholder="Nome da empresa" onChange={(e) => setCompany(e.target.value)} data-pipeline-company />
      </Field>

      <div className="mb-1 mt-4 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/5">
        {(
          [
            ["etapas", "Etapas"],
            ["cartao", "Cartão"],
            ["ficha", "Ficha do cartão"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md py-1.5 text-theme-sm font-medium ${tab === id ? "bg-white text-brand-600 shadow-theme-xs dark:bg-gray-900" : "text-gray-600 dark:text-gray-400"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "ficha" && <DetailLayoutEditor pipeline={pipeline} fields={detailFields} items={detail} onChange={setDetail} />}
      {tab === "cartao" && (
        <div className="mt-4">
          <CardLayoutEditor pipeline={pipeline} keys={cardKeys} onChange={setCardKeys} />
        </div>
      )}

      <div className={tab === "etapas" ? "" : "hidden"}>
      <SectionLabel>Etapas</SectionLabel>
      <div className="grid grid-cols-[20px_128px_1fr_90px_90px_28px] gap-2 text-theme-xs text-gray-500">
        <span />
        <span>Cor</span>
        <span>Nome</span>
        <span>{pipeline.type === "comercial" ? "Prob. %" : ""}</span>
        <span>Parado após (dias)</span>
        <span />
      </div>
      {stages.map((s, i) => {
        const rp = drag.rowProps(s.uid);
        return (
        <div key={s.uid} {...rp} className={cn("mt-2 grid grid-cols-[20px_128px_1fr_90px_90px_28px] items-center gap-2 rounded-lg", rp.className)}>
          <DragHandle {...drag.handleProps(s.uid, stages[i - 1]?.uid, stages[i + 1]?.uid)} />
          <TaSelect value={s.color} onChange={(e) => set(i, { color: e.target.value })} style={{ color: badgePalette[s.color as BadgeColor]?.fg }}>
            {COLORS.map((c) => (
              <option key={c} value={c} style={{ color: badgePalette[c].fg }}>
                ● {colorLabel(c)}
              </option>
            ))}
          </TaSelect>
          <TaInput value={s.name} onChange={(e) => set(i, { name: e.target.value })} />
          {pipeline.type === "comercial" ? (
            <TaInput type="number" min={0} max={100} value={s.probability} onChange={(e) => set(i, { probability: e.target.value })} />
          ) : (
            <span />
          )}
          <TaInput type="number" min={1} value={s.staleDays} onChange={(e) => set(i, { staleDays: e.target.value })} />
          <div className="flex items-center gap-1 text-gray-400">
            <button type="button" title="Remover" disabled={stages.length === 1} className="hover:text-error-600 disabled:opacity-30" onClick={() => setStages((l) => l.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        );
      })}
      <TaButton variant="ghost" className="mt-2" startIcon={<Plus size={14} />} onClick={() => setStages((l) => [...l, { uid: crypto.randomUUID(), name: "", color: COLORS[l.length % COLORS.length]!, probability: "", staleDays: "" }])}>
        Adicionar etapa
      </TaButton>
      <StagesPreview stages={stages} />

      {removed.length > 0 && (
        <>
          <SectionLabel>Cartões das etapas removidas</SectionLabel>
          {removed.map((r) => (
            <Field key={r.id} label={`Mover cartões de "${r.name}" para`}>
              <TaSelect value={moveTo[r.id] ?? ""} onChange={(e) => setMoveTo({ ...moveTo, [r.id]: e.target.value })}>
                <option value="">(só necessário se a etapa tiver cartões)</option>
                {keptIds.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </TaSelect>
            </Field>
          ))}
        </>
      )}

      </div>

      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex items-center gap-2">
        <TaButton
          variant="danger"
          onClick={async () => {
            if (!confirm("Arquivar este funil? Ele sai da lista, mas os dados são mantidos.")) return;
            await call("pipelines.update", { id: pipeline.id, patch: { archived: true } });
            onSaved(true);
          }}
        >
          Arquivar funil
        </TaButton>
        <div className="ml-auto flex gap-2">
          <TaButton onClick={onClose}>Cancelar</TaButton>
          <TaButton variant="primary" onClick={() => void save()}>
            Salvar
          </TaButton>
        </div>
      </div>
    </GuardedModal>
  );
}
