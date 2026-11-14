// "Nota fiscal" do cartão (spec 19, fase 2). A janela abre já preenchida com:
// empresa emissora (perguntada quando há mais de uma), tomador, serviços e valor.
// A discriminação e a observação são editáveis e revisadas a cada nota, e as
// pendências aparecem no topo. O rascunho fica salvo no cartão. A emissão pelo
// Emissor Nacional entra na fase 3.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Pencil, RefreshCw, RotateCcw, Save } from "lucide-react";
import { TaButton, TaInput, TaModal, TaTextarea, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { NFSE_LIMITS, unresolvedFields, type NfseDraft, type NfsePending } from "../../db/nfse";
import { formatCnpj } from "../../lib/cnpj";
import { errorText } from "../../lib/errors";
import { formatCents } from "../../lib/format";
import { formatTribNac, municipioPorIbge, servicoNacional } from "../../lib/nfse/tabelas";
import { OrganizationFormModal } from "../contacts/OrganizationFormModal";
import { PersonFormModal } from "../contacts/PersonFormModal";

type Texts = { description: string; notes: string; orderNumber: string };

const fmtDoc = (d: string | null) => {
  const x = (d ?? "").replace(/\D/g, "");
  return x.length === 14 ? formatCnpj(x) : x.length === 11 ? x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : (d ?? "");
};

export function NfseDialog({ cardId, onClose, onChanged }: { cardId: string; onClose: () => void; onChanged?: () => void }) {
  const [draft, setDraft] = useState<NfseDraft | null>(null);
  const [pending, setPending] = useState<NfsePending[]>([]);
  const [issuerId, setIssuerId] = useState<string | null>(null);
  const [texts, setTexts] = useState<Texts>({ description: "", notes: "", orderNumber: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editTaker, setEditTaker] = useState(false);

  /** Recarrega o rascunho; os textos só são trocados quando não há edição pendente (ou quando pedido). */
  const load = useCallback(
    async (o: { issuerId?: string | null; fromTemplate?: boolean; keepTexts?: boolean } = {}) => {
      setMsg(null);
      try {
        const r = await call("nfse.draft", {
          id: cardId,
          ...(o.issuerId !== undefined ? { issuerId: o.issuerId } : {}),
          ...(o.fromTemplate ? { fromTemplate: true, orderNumber: texts.orderNumber } : {}),
        });
        setDraft(r.draft);
        setPending(r.pending);
        setIssuerId(r.draft.issuer?.id ?? null);
        if (!o.keepTexts) {
          setTexts({ description: r.draft.texts.description, notes: r.draft.texts.notes, orderNumber: r.draft.texts.orderNumber });
          setDirty(!!o.fromTemplate);
        }
      } catch (e) {
        setMsg({ kind: "err", text: errorText(e) });
      }
    },
    [cardId, texts.orderNumber],
  );

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setText = (k: keyof Texts, v: string) => {
    setTexts((t) => ({ ...t, [k]: v }));
    setDirty(true);
  };

  /** Pendências: as do servidor (dados do cartão) + as dos textos como estão na tela. */
  const shown = useMemo(() => {
    const list = pending.filter((p) => !p.field.startsWith("texts."));
    const err = (field: string, message: string) => list.push({ field, message, level: "error" });
    if (!texts.description.trim()) err("texts.description", "Preencha a discriminação dos serviços.");
    else if (texts.description.length > NFSE_LIMITS.description) err("texts.description", `A discriminação passa de ${NFSE_LIMITS.description} caracteres.`);
    if (texts.notes.length > NFSE_LIMITS.notes) err("texts.notes", `A observação passa de ${NFSE_LIMITS.notes} caracteres.`);
    if (texts.orderNumber.length > NFSE_LIMITS.orderNumber) err("texts.orderNumber", `O nº do pedido passa de ${NFSE_LIMITS.orderNumber} caracteres.`);
    const open = unresolvedFields(`${texts.description}\n${texts.notes}`);
    if (open.length) err("texts.fields", `Texto com campo sem preencher: ${open.join(", ")}.`);
    if (dirty || !draft?.texts.saved) err("texts.review", "Revise a discriminação e a observação e clique em Salvar rascunho.");
    return list;
  }, [pending, texts, dirty, draft]);
  const errors = shown.filter((p) => p.level === "error");
  const warnings = shown.filter((p) => p.level === "warning");

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await call("nfse.saveDraft", { id: cardId, issuerId, description: texts.description, notes: texts.notes, orderNumber: texts.orderNumber });
      setDirty(false);
      await load({ keepTexts: true });
      setDraft((d) => (d ? { ...d, texts: { ...d.texts, saved: true } } : d));
      setMsg({ kind: "ok", text: "Rascunho da nota salvo no cartão." });
      onChanged?.();
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const requestClose = () => {
    if (dirty && !confirm("Os textos da nota foram alterados e não foram salvos. Fechar mesmo assim?")) return;
    onClose();
  };

  if (!draft)
    return (
      <TaModal isOpen onClose={onClose} title="Nota fiscal de serviço" width="max-w-3xl">
        {msg ? <p className="rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{msg.text}</p> : <p className="text-theme-sm text-gray-500">Carregando…</p>}
      </TaModal>
    );

  const total = draft.services.reduce((n, s) => n + s.valueCents, 0);
  const place = municipioPorIbge(draft.placeIbge);
  const t = draft.taker;
  return (
    <TaModal isOpen onClose={requestClose} title="Nota fiscal de serviço (NFS-e)" width="max-w-3xl">
      <div className="space-y-4 text-theme-sm text-gray-700 dark:text-gray-300" data-nfse-dialog>
        {/* Pendências */}
        {errors.length || warnings.length ? (
          <div className="space-y-1.5" data-nfse-pending>
            {errors.map((p, i) => (
              <p key={`e${i}`} className="flex gap-2 rounded-lg bg-error-50 px-3 py-2 text-error-700 dark:bg-error-500/10" data-nfse-pending-item={p.field}>
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {p.message}
              </p>
            ))}
            {warnings.map((p, i) => (
              <p key={`w${i}`} className="flex gap-2 rounded-lg bg-warning-50 px-3 py-2 text-warning-700 dark:bg-warning-500/10" data-nfse-pending-item={p.field}>
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {p.message}
              </p>
            ))}
          </div>
        ) : null}
        {!errors.length && (
          <p className="flex items-center gap-2 rounded-lg bg-success-50 px-3 py-2 font-medium text-success-700 dark:bg-success-500/10" data-nfse-ready>
            <CheckCircle2 size={16} /> Tudo preenchido: a nota está pronta para emitir.
          </p>
        )}

        {/* Empresa emissora */}
        <section>
          <h4 className="mb-1.5 text-theme-xs font-semibold uppercase text-gray-500">Emitir por</h4>
          {!draft.issuers.length ? (
            <p className="text-gray-500">Nenhuma empresa emissora cadastrada (Configurações → Nota fiscal).</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2" data-nfse-issuer-choice>
              {draft.issuers.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => {
                    setIssuerId(i.id);
                    void load({ issuerId: i.id, keepTexts: dirty || draft.texts.saved });
                    setDirty(true);
                  }}
                  className={cn(
                    "rounded-xl border-2 px-3 py-2 text-left",
                    issuerId === i.id ? "border-brand-500 bg-brand-25 dark:bg-brand-500/10" : "border-gray-200 hover:border-gray-300 dark:border-gray-700",
                  )}
                  data-nfse-issuer-option={i.cnpj}
                >
                  <span className="block truncate font-semibold text-gray-800 dark:text-white/90">{i.legal_name}</span>
                  <span className="block text-theme-xs text-gray-500">
                    CNPJ {formatCnpj(i.cnpj)} · {i.access === "a3" ? "certificado A3" : i.access === "a1" ? "certificado A1" : "gov.br"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Tomador e serviço */}
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800" data-nfse-taker>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-theme-xs font-semibold uppercase text-gray-500">Tomador (cliente)</h4>
              {t.id && (
                <button type="button" className="flex items-center gap-1 text-theme-xs text-brand-600 hover:underline" onClick={() => setEditTaker(true)} data-nfse-edit-taker>
                  <Pencil size={12} /> Corrigir cadastro
                </button>
              )}
            </div>
            {t.kind ? (
              <>
                <p className="font-semibold text-gray-800 dark:text-white/90">{t.name}</p>
                <p className="text-theme-xs text-gray-500">{t.kind === "organization" ? "CNPJ" : "CPF"} {fmtDoc(t.document) || "—"}</p>
                {t.address && (
                  <p className="mt-1 text-theme-xs text-gray-500">
                    {[t.address.street, t.address.number, t.address.complement, t.address.district].filter(Boolean).join(", ")}
                    <br />
                    {t.address.city}/{t.address.uf} · CEP {t.address.cep} {t.address.cityIbge ? `· IBGE ${t.address.cityIbge}` : ""}
                  </p>
                )}
              </>
            ) : (
              <p className="text-gray-500">Sem organização nem contato no cartão.</p>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800" data-nfse-services>
            <h4 className="mb-1 text-theme-xs font-semibold uppercase text-gray-500">Serviço</h4>
            {draft.services.map((s, i) => (
              <div key={i} className="mb-1.5">
                <p className="font-medium text-gray-800 dark:text-white/90">
                  {s.tribNac ? `${formatTribNac(s.tribNac)} — ${servicoNacional(s.tribNac)?.descricao ?? ""}` : "Sem código de tributação"}
                </p>
                <p className="text-theme-xs text-gray-500">{formatCents(s.valueCents)}</p>
              </div>
            ))}
            <p className="mt-2 border-t border-gray-100 pt-2 text-theme-xs text-gray-500 dark:border-gray-800">
              Valor da nota: <b className="text-gray-800 dark:text-white/90">{formatCents(total)}</b> · Competência {draft.competence.split("-").reverse().join("/")}
              {place && ` · Local: ${place.nome}/${place.uf}`}
            </p>
          </div>
        </section>

        {/* Textos personalizados */}
        <section className="rounded-xl border-2 border-brand-200 p-3 dark:border-brand-500/30" data-nfse-texts>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-white/90">
              <FileText size={15} /> Textos desta nota
            </h4>
            <TaButton
              size="sm"
              variant="ghost"
              startIcon={<RotateCcw size={14} />}
              title="Descarta os textos desta nota e volta ao texto padrão da empresa (com o nº do pedido digitado)"
              onClick={() => {
                if (dirty || draft.texts.saved) if (!confirm("Trocar a discriminação e a observação pelo texto padrão da empresa?")) return;
                void load({ fromTemplate: true, issuerId });
              }}
              data-nfse-reapply
            >
              Reaplicar texto padrão
            </TaButton>
          </div>
          <label className="mb-3 block">
            <span className="mb-1 block text-theme-xs font-medium text-gray-600 dark:text-gray-400">Nº do pedido / processo de compra</span>
            <TaInput value={texts.orderNumber} onChange={(e) => setText("orderNumber", e.target.value)} placeholder="Opcional (ex.: 2026191944)" data-nfse-order />
          </label>
          <TextBox
            label="Discriminação dos serviços"
            value={texts.description}
            max={NFSE_LIMITS.description}
            rows={5}
            onChange={(v) => setText("description", v)}
            hint={draft.texts.source.description === "saved" && !dirty ? "Salva neste cartão." : "Do texto padrão da empresa: ajuste para este cliente."}
            data="description"
          />
          <TextBox
            label="Observação"
            value={texts.notes}
            max={NFSE_LIMITS.notes}
            rows={3}
            onChange={(v) => setText("notes", v)}
            hint={
              draft.texts.source.notes === "last-taker" && !dirty
                ? "Copiada da última nota deste cliente: confira se continua valendo."
                : draft.texts.source.notes === "saved" && !dirty
                  ? "Salva neste cartão."
                  : "Do texto padrão da empresa."
            }
            data="notes"
          />
        </section>

        {msg && <p className={cn("rounded-lg px-3 py-2", msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700")} data-nfse-msg>{msg.text}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <TaButton variant="ghost" startIcon={<RefreshCw size={15} />} className="mr-auto" title="Relê os dados do cartão (depois de corrigir o cadastro ou os produtos)" onClick={() => void load({ keepTexts: true, issuerId })}>
            Atualizar dados
          </TaButton>
          <TaButton onClick={requestClose}>Fechar</TaButton>
          <TaButton variant="outline" startIcon={<Save size={15} />} disabled={busy} onClick={() => void save()} data-nfse-save-draft>
            Salvar rascunho
          </TaButton>
          <TaButton
            variant="primary"
            startIcon={<ExternalLink size={15} />}
            disabled={!!errors.length}
            title={errors.length ? "Resolva as pendências acima" : "A emissão pelo Emissor Nacional entra na próxima versão (fase 3)"}
            onClick={() => setMsg({ kind: "ok", text: "Rascunho pronto. O preenchimento automático do Emissor Nacional chega na fase 3; até lá, use os textos acima no portal." })}
            data-nfse-emit
          >
            Emitir no Emissor Nacional
          </TaButton>
        </div>
      </div>
      {editTaker && t.kind === "organization" && (
        <OrganizationFormModal
          organizationId={t.id}
          onClose={() => setEditTaker(false)}
          onSaved={() => {
            setEditTaker(false);
            void load({ keepTexts: true, issuerId });
          }}
        />
      )}
      {editTaker && t.kind === "person" && (
        <PersonFormModal
          personId={t.id}
          onClose={() => setEditTaker(false)}
          onSaved={() => {
            setEditTaker(false);
            void load({ keepTexts: true, issuerId });
          }}
        />
      )}
    </TaModal>
  );
}

function TextBox({ label, value, max, rows, onChange, hint, data }: { label: string; value: string; max: number; rows: number; onChange: (v: string) => void; hint: string; data: string }) {
  const over = value.length > max;
  return (
    <label className="mb-3 block">
      <span className="mb-1 flex items-center justify-between text-theme-xs font-medium text-gray-600 dark:text-gray-400">
        {label}
        <span className={cn("tabular-nums", over ? "font-semibold text-error-600" : "text-gray-400")} data-nfse-count={data}>
          {value.length}/{max}
        </span>
      </span>
      <TaTextarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={over ? "border-error-400" : ""} data-nfse-text={data} />
      <span className="mt-1 block text-theme-xs text-gray-500">{hint}</span>
    </label>
  );
}
