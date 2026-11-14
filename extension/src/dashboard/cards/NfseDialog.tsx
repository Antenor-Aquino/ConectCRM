// "Nota fiscal" do cartão (spec 19, fase 2). A janela abre já preenchida com:
// empresa emissora (perguntada quando há mais de uma), tomador, serviços e valor.
// A discriminação e a observação são editáveis e revisadas a cada nota, e as
// pendências aparecem no topo. O rascunho fica salvo no cartão. "Emitir no
// Emissor Nacional" (fase 3) abre o portal com o painel do ConectCRM e espera a
// nota emitida voltar (número e chave).
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Download, ExternalLink, FilePlus2, FileText, Pencil, RefreshCw, RotateCcw, Save, Send, XCircle } from "lucide-react";
import { TaButton, TaInput, TaModal, TaSelect, TaTextarea, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { danfseDocumentName, NFSE_LIMITS, unresolvedFields, type NfseDraft, type NfsePending } from "../../db/nfse";
import { formatCnpj } from "../../lib/cnpj";
import { errorText } from "../../lib/errors";
import { formatCents } from "../../lib/format";
import { formatTribNac, municipioPorIbge, servicoNacional } from "../../lib/nfse/tabelas";
import { loadNfseEnvironment, openPortalAssistant, requestPortalPermission } from "../../lib/nfse/portal";
import { buildPortalPayload } from "../../lib/nfse/portalSteps";
import { buildDpsXml } from "../../lib/nfse/dps";
import { emitViaFiscal, eventViaFiscal, nfseNumberFromXml, sefinErrors } from "../../lib/nfse/fiscal";
import { buildCancelEventXml, CANCEL_REASON_LABEL, CANCEL_REASONS, CANCEL_TEXT_MAX, cancelInputError, type CancelReasonCode } from "../../lib/nfse/evento";
import { buildDanfsePdf } from "../../lib/nfse/danfse";
import { prepareFile, saveContent } from "../../lib/documentFiles";
import { PORTAL_BASE } from "../../lib/nfse/portalSteps";
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
  /** Assistente aberto no portal: a janela relê o cartão até a nota emitida voltar. */
  const [waiting, setWaiting] = useState(false);
  /** Emissão pela API: enviando e erros devolvidos pela Receita. */
  const [sending, setSending] = useState(false);
  const [apiErrors, setApiErrors] = useState<string[] | null>(null);
  /** Ambiente lido ao abrir: o pedido de permissão precisa sair já no clique. */
  const [env, setEnv] = useState<"producao" | "producao_restrita">("producao_restrita");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelCode, setCancelCode] = useState<CancelReasonCode>(1);
  const [cancelText, setCancelText] = useState("");

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
    void loadNfseEnvironment().then(setEnv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      const r = await call("nfse.draft", { id: cardId }).catch(() => null);
      if (r?.draft.issued) {
        setDraft(r.draft);
        setPending(r.pending);
        setWaiting(false);
        onChanged?.();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting, cardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = async () => {
    if (!draft?.issuer) return;
    // Primeiro, ainda dentro do clique: a permissão do site do portal (1º uso).
    const permission = requestPortalPermission(env);
    let granted = false;
    try {
      granted = await permission;
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
      return;
    }
    if (!granted) {
      setMsg({ kind: "err", text: "Sem a permissão de acesso ao Emissor Nacional não dá para abrir o portal. Clique em Emitir de novo e escolha Permitir." });
      return;
    }
    const where = env === "producao_restrita" ? "no ambiente de TESTES (produção restrita, sem valor fiscal)" : "em PRODUÇÃO (nota com valor fiscal)";
    if (
      !confirm(
        `Emitir a NFS-e de ${formatCents(draft.services.reduce((n, s) => n + s.valueCents, 0))} para ${draft.taker.name} por ${draft.issuer.legal_name}, ${where}?\n\nO Emissor Nacional abre com o painel do ConectCRM: entre no portal, use "Preencher a etapa" em cada passo, confira e clique em Emitir NFS-e. No fim, "Trazer nota para o CRM".`,
      )
    )
      return;
    setMsg(null);
    try {
      await openPortalAssistant(buildPortalPayload(draft, env, draft.issuers.map((i) => i.cnpj)));
      setWaiting(true);
      setMsg({ kind: "ok", text: "Emissor Nacional aberto com o painel do ConectCRM. Esta janela atualiza sozinha quando a nota for trazida para o CRM." });
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    }
  };

  /** Emissão direta pela API (ConectCRM Fiscal), sem abrir o portal. */
  const emitApi = async () => {
    if (!draft?.issuer?.cert_thumbprint) return;
    const total = draft.services.reduce((n, s) => n + s.valueCents, 0);
    const where = env === "producao_restrita" ? "no ambiente de TESTES (produção restrita, sem valor fiscal)" : "em PRODUÇÃO (nota com valor fiscal)";
    if (!confirm(`Emitir a NFS-e de ${formatCents(total)} para ${draft.taker.name} por ${draft.issuer.legal_name}, ${where}?\n\nA nota vai direto para a Receita. Se o certificado for token (A3), o Windows vai pedir o PIN.`)) return;
    if (env === "producao" && !confirmProduction("emitir uma NFS-e REAL, com valor fiscal")) return;
    setMsg(null);
    setApiErrors(null);
    setSending(true);
    try {
      const dps = await call("nfse.reserveDps", { id: cardId });
      const xml = buildDpsXml(draft, { environment: env, issuedAt: new Date(), series: dps.series, number: dps.number, appVersion: `ConectCRM ${chrome.runtime.getManifest().version}` });
      const r = await emitViaFiscal(env, draft.issuer.cert_thumbprint, xml);
      if (r.httpStatus >= 200 && r.httpStatus < 300 && r.accessKey) {
        await call("nfse.markIssued", { id: cardId, accessKey: r.accessKey, number: nfseNumberFromXml(r.nfseXml), environment: env, nfseXml: r.nfseXml ?? null, via: "api" });
        await load({ keepTexts: true });
        setMsg({ kind: "ok", text: "NFS-e emitida pela Receita e registrada no cartão." });
        void autoStoreDanfse("NFS-e emitida pela Receita e registrada no cartão.");
        onChanged?.();
      } else {
        setApiErrors(sefinErrors(r));
      }
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    } finally {
      setSending(false);
    }
  };

  const saveFile = (data: BlobPart, type: string, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const downloadXml = () => {
    if (!draft?.issued?.xml) return;
    saveFile(draft.issued.xml, "application/xml", `NFSe-${draft.issued.number ?? draft.issued.accessKey}.xml`);
  };

  /** DANFSe (PDF) gerado aqui a partir do XML da nota (NT 008). */
  /** Gera o PDF e o nome "Cliente - 52,00 - DANFSe-NFS-e-1". */
  const makeDanfse = async (d: NfseDraft) => {
    const issued = d.issued!;
    const logo = await fetch(chrome.runtime.getURL("nfse-logo.png"))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    const pdf = await buildDanfsePdf(issued.xml!, { logoPng: logo, canceled: !!issued.canceled });
    const total = d.services.reduce((n, x) => n + x.valueCents, 0);
    return { pdf: pdf as Uint8Array<ArrayBuffer>, name: danfseDocumentName(d.taker.shortName ?? d.taker.name, total, issued.number, issued.accessKey) };
  };

  /**
   * Guarda o DANFSe nos documentos do cartão (GED), se ainda não estiver lá —
   * ou nova versão quando a nota foi cancelada depois. Devolve true se guardou agora.
   */
  const storeDanfse = async (made?: { pdf: Uint8Array<ArrayBuffer>; name: string }): Promise<boolean> => {
    const { draft: d } = await call("nfse.draft", { id: cardId });
    const issued = d.issued;
    if (!issued?.xml) return false;
    if (issued.danfse && (issued.danfse.canceled || !issued.canceled)) return false;
    const { pdf, name } = made ?? (await makeDanfse(d));
    const prepared = await prepareFile(new File([pdf], `${name}.pdf`, { type: "application/pdf" }));
    const file = await saveContent(prepared, name);
    await call("nfse.saveDanfse", { id: cardId, file, name, canceled: !!issued.canceled });
    onChanged?.();
    return true;
  };

  const downloadDanfse = async () => {
    if (!draft?.issued?.xml) return;
    setMsg(null);
    try {
      const made = await makeDanfse(draft);
      saveFile(made.pdf, "application/pdf", `${made.name}.pdf`);
      if (await storeDanfse(made)) {
        await load({ keepTexts: true });
        setMsg({ kind: "ok", text: "DANFSe baixado e guardado nos documentos do cartão." });
      }
    } catch (e) {
      setMsg({ kind: "err", text: `Não foi possível gerar ou guardar o DANFSe: ${errorText(e)}` });
    }
  };

  /** Depois de emitir/cancelar: guarda o DANFSe sem travar a mensagem principal. */
  const autoStoreDanfse = async (okText: string) => {
    try {
      const saved = await storeDanfse();
      await load({ keepTexts: true });
      setMsg({ kind: "ok", text: saved ? `${okText} DANFSe guardado nos documentos do cartão.` : okText });
    } catch (e) {
      setMsg({ kind: "err", text: `${okText} Mas não foi possível guardar o DANFSe: ${errorText(e)}` });
    }
  };

  /** Cancelamento pela API: pedido de evento e101101 assinado pelo ConectCRM Fiscal. */
  const cancelApi = async () => {
    const issued = draft?.issued;
    const thumb = draft?.issuer?.cert_thumbprint;
    if (!issued || !draft?.issuer || !thumb) return;
    const err = cancelInputError(cancelCode, cancelText);
    if (err) return setMsg({ kind: "err", text: err });
    const amb = issued.environment === "producao_restrita" ? " (ambiente de testes)" : "";
    if (issued.environment === "producao" && !confirmProduction("cancelar uma NFS-e REAL")) return;
    if (!confirm(`Cancelar a NFS-e${issued.number ? ` nº ${issued.number}` : ""}${amb} na Receita?\n\nMotivo: ${CANCEL_REASON_LABEL[cancelCode]} — ${cancelText.trim()}\n\nO cancelamento não pode ser desfeito. Se o certificado for token (A3), o Windows vai pedir o PIN.`)) return;
    setMsg(null);
    setApiErrors(null);
    setSending(true);
    try {
      const xml = buildCancelEventXml({
        accessKey: issued.accessKey,
        cnpj: draft.issuer.cnpj,
        environment: issued.environment,
        code: cancelCode,
        reason: cancelText,
        at: new Date(),
        appVersion: `ConectCRM ${chrome.runtime.getManifest().version}`,
      });
      const { result, signed } = await eventViaFiscal(issued.environment, thumb, issued.accessKey, xml);
      if (result.httpStatus >= 200 && result.httpStatus < 300) {
        await call("nfse.markCanceled", { id: cardId, accessKey: issued.accessKey, code: cancelCode, reason: cancelText.trim(), eventXml: result.eventXml || signed });
        setCancelOpen(false);
        await load({ keepTexts: true });
        setMsg({ kind: "ok", text: "NFS-e cancelada na Receita. O registro está nas notas do cartão." });
        void autoStoreDanfse("NFS-e cancelada na Receita. O registro está nas notas do cartão.");
        onChanged?.();
      } else {
        setApiErrors(sefinErrors(result));
      }
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    } finally {
      setSending(false);
    }
  };

  /** Nota emitida pelo portal: o cancelamento é feito lá; aqui só se registra. */
  const markPortalCanceled = async () => {
    const issued = draft?.issued;
    if (!issued) return;
    if (!confirm(`Confirma que a NFS-e${issued.number ? ` nº ${issued.number}` : ""} já foi cancelada no Emissor Nacional?`)) return;
    try {
      await call("nfse.markCanceled", { id: cardId, accessKey: issued.accessKey });
      setCancelOpen(false);
      await load({ keepTexts: true });
      onChanged?.();
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    }
  };

  /** Depois de cancelar: rascunho novo com os mesmos textos e empresa. */
  const reopen = async () => {
    try {
      await call("nfse.reopen", { id: cardId });
      setApiErrors(null);
      await load();
      setMsg({ kind: "ok", text: "Nova nota preparada com os mesmos textos. Revise e emita." });
      onChanged?.();
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    }
  };

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
        {env === "producao" && !draft.issued && (
          <p className="flex items-center gap-2 rounded-lg border border-error-300 bg-error-50 px-3 py-2 font-medium text-error-700 dark:bg-error-500/10" data-nfse-env-producao>
            <AlertTriangle size={15} /> Ambiente de PRODUÇÃO: a nota emitida aqui tem valor fiscal. Para testar, mude para Produção restrita em Configurações → Nota fiscal.
          </p>
        )}
        {draft.issued && (
          <div
            className={cn(
              "rounded-xl border p-3",
              draft.issued.canceled ? "border-error-200 bg-error-50 text-error-800 dark:bg-error-500/10" : "border-success-200 bg-success-50 text-success-800 dark:bg-success-500/10",
            )}
            data-nfse-issued
          >
            <p className="flex items-center gap-2 font-semibold">
              {draft.issued.canceled ? <XCircle size={16} /> : <CheckCircle2 size={16} />} NFS-e{draft.issued.number ? ` nº ${draft.issued.number}` : ""}{" "}
              {draft.issued.canceled ? "cancelada" : "emitida"}
              {draft.issued.environment === "producao_restrita" && <span className="font-normal">(ambiente de testes, sem valor fiscal)</span>}
            </p>
            <p className="mt-1 break-all text-theme-xs">Chave de acesso: {draft.issued.accessKey}</p>
            <p className="text-theme-xs">Emitida em {new Date(draft.issued.issuedAt).toLocaleString("pt-BR")}. O registro também está nas notas do cartão.</p>
            {draft.issued.canceled && (
              <p className="text-theme-xs" data-nfse-canceled>
                Cancelada em {new Date(draft.issued.canceled.at).toLocaleString("pt-BR")}
                {draft.issued.canceled.via === "api"
                  ? ` pela API. Motivo: ${CANCEL_REASON_LABEL[draft.issued.canceled.code ?? 0] ?? "-"}${draft.issued.canceled.reason ? ` — ${draft.issued.canceled.reason}` : ""}.`
                  : " no Emissor Nacional (registrado aqui)."}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {draft.issued.xml && (
                <TaButton size="sm" variant="outline" startIcon={<FileText size={14} />} onClick={() => void downloadDanfse()} data-nfse-download-pdf>
                  Baixar DANFSe (PDF)
                </TaButton>
              )}
              {draft.issued.xml && (
                <TaButton size="sm" variant="outline" startIcon={<Download size={14} />} onClick={downloadXml} data-nfse-download-xml>
                  Baixar XML da NFS-e
                </TaButton>
              )}
              {!draft.issued.canceled && !cancelOpen && (
                <TaButton size="sm" variant="outline" startIcon={<Ban size={14} />} onClick={() => setCancelOpen(true)} data-nfse-cancel-open>
                  Cancelar NFS-e
                </TaButton>
              )}
              {draft.issued.canceled && (
                <TaButton size="sm" startIcon={<FilePlus2 size={14} />} onClick={() => void reopen()} data-nfse-reopen>
                  Preparar nova nota
                </TaButton>
              )}
            </div>
            {cancelOpen && !draft.issued.canceled && (
              <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" data-nfse-cancel-form>
                {draft.issued.xml && draft.issuer?.cert_thumbprint ? (
                  <>
                    <p className="font-medium">Cancelar na Receita (pela API)</p>
                    <label className="block text-theme-xs">
                      Motivo
                      <TaSelect value={String(cancelCode)} onChange={(e) => setCancelCode(Number(e.target.value) as CancelReasonCode)} data-nfse-cancel-code>
                        {CANCEL_REASONS.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </TaSelect>
                    </label>
                    <label className="block text-theme-xs">
                      Descrição do motivo (15 a {CANCEL_TEXT_MAX} caracteres)
                      <TaTextarea rows={2} maxLength={CANCEL_TEXT_MAX} value={cancelText} onChange={(e) => setCancelText(e.target.value)} data-nfse-cancel-text />
                    </label>
                    <p className="text-theme-xs text-gray-500">
                      O prazo e as regras de cancelamento são do município; fora do prazo, a Receita recusa e o pedido precisa ir para análise fiscal no portal.
                    </p>
                    <div className="flex gap-2">
                      <TaButton size="sm" variant="danger" startIcon={sending ? <RefreshCw size={14} className="animate-spin" /> : <Ban size={14} />} disabled={sending || !!cancelInputError(cancelCode, cancelText)} onClick={() => void cancelApi()} data-nfse-cancel-confirm>
                        Cancelar na Receita
                      </TaButton>
                      <TaButton size="sm" variant="outline" disabled={sending} onClick={() => setCancelOpen(false)}>
                        Voltar
                      </TaButton>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Cancelar no Emissor Nacional</p>
                    <p className="text-theme-xs">
                      {draft.issued.xml
                        ? "A empresa emissora está sem certificado escolhido (Configurações → Nota fiscal), então o cancelamento pela API não está disponível."
                        : "Esta nota foi emitida pelo portal: o cancelamento também é feito lá (consulte a nota em Notas emitidas e use Cancelar)."}{" "}
                      Depois de cancelar, registre aqui.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <a className="inline-flex items-center gap-1 text-theme-xs font-medium text-brand-600 hover:underline" href={PORTAL_BASE[draft.issued.environment]} target="_blank" rel="noreferrer">
                        <ExternalLink size={13} /> Abrir o Emissor Nacional
                      </a>
                      <TaButton size="sm" variant="outline" onClick={() => void markPortalCanceled()} data-nfse-cancel-portal>
                        Já cancelei no portal
                      </TaButton>
                      <TaButton size="sm" variant="outline" onClick={() => setCancelOpen(false)}>
                        Voltar
                      </TaButton>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {waiting && !draft.issued && (
          <p className="flex items-center gap-2 rounded-lg bg-brand-25 px-3 py-2 text-brand-700 dark:bg-brand-500/10" data-nfse-waiting>
            <RefreshCw size={15} className="animate-spin" /> Aguardando a nota no Emissor Nacional… (use “Trazer nota para o CRM” no painel do portal)
          </p>
        )}
        {apiErrors && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-3 text-error-700 dark:bg-error-500/10" data-nfse-api-errors>
            <p className="font-semibold">{draft.issued ? "A Receita recusou o cancelamento:" : "A Receita recusou a nota:"}</p>
            <ul className="mt-1 list-disc pl-5 text-theme-xs">
              {apiErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <p className="mt-1 text-theme-xs">
              {draft.issued
                ? "A nota continua valendo. Se o prazo de cancelamento do município passou, peça o cancelamento por análise fiscal no Emissor Nacional."
                : "Corrija e clique em Emitir de novo (o número da DPS é o mesmo)."}
            </p>
          </div>
        )}
        {sending && (
          <p className="flex items-center gap-2 rounded-lg bg-brand-25 px-3 py-2 text-brand-700 dark:bg-brand-500/10" data-nfse-sending>
            <RefreshCw size={15} className="animate-spin" /> Enviando à Receita… (com token A3, digite o PIN na janela do Windows)
          </p>
        )}
        {/* Pendências */}
        {draft.issued ? null : errors.length || warnings.length ? (
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
        {!errors.length && !draft.issued && (
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
              disabled={!!draft.issued}
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
          <TaButton variant="outline" startIcon={<Save size={15} />} disabled={busy || !!draft.issued} onClick={() => void save()} data-nfse-save-draft>
            Salvar rascunho
          </TaButton>
          {draft.issuer?.cert_thumbprint ? (
            <>
              <TaButton
                variant="outline"
                startIcon={<ExternalLink size={15} />}
                disabled={!!errors.length || !!draft.issued || sending}
                title="Alternativa: abrir o Emissor Nacional com o painel do ConectCRM"
                onClick={() => void emit()}
                data-nfse-emit
              >
                Pelo portal
              </TaButton>
              <TaButton
                variant="primary"
                startIcon={<Send size={15} />}
                disabled={!!errors.length || !!draft.issued || sending}
                title={errors.length ? "Resolva as pendências acima" : "Envia a nota direto à Receita (ConectCRM Fiscal)"}
                onClick={() => void emitApi()}
                data-nfse-emit-api
              >
                {sending ? "Enviando…" : "Emitir NFS-e"}
              </TaButton>
            </>
          ) : (
            <TaButton
              variant="primary"
              startIcon={<ExternalLink size={15} />}
              disabled={!!errors.length || !!draft.issued}
              title={errors.length ? "Resolva as pendências acima" : "Abre o Emissor Nacional com o painel do ConectCRM para preencher e emitir"}
              onClick={() => void emit()}
              data-nfse-emit
            >
              Emitir no Emissor Nacional
            </TaButton>
          )}
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

/** Em produção, além do confirm: digitar PRODUÇÃO (evita emitir nota real por engano). */
export function confirmProduction(what: string): boolean {
  const typed = prompt(`Atenção: o ambiente é PRODUÇÃO. Você vai ${what}.\n\nPara confirmar, digite PRODUÇÃO:`);
  const ok = typed != null && typed.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase() === "PRODUCAO";
  if (typed != null && !ok) alert("Texto diferente de PRODUÇÃO: nada foi enviado à Receita.");
  return ok;
}

