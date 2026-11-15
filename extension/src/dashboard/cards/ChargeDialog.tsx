// "Cobrança" do cartão (specs 21 e 22): escolhe o meio — link de pagamento da
// InfinitePay ou boleto + Pix do Banco Inter — com os produtos e serviços do
// cartão e, em seguida, abre a receita na Gestão Financeira já preenchida.
import { useEffect, useState } from "react";
import { Check, Copy, CreditCard, ExternalLink, FileText, Landmark, Plus, RefreshCw, Trash2, Wallet } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaModal, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { boletoDocumentName, brl, chargeTotal, MIN_CHARGE_CENTS, type Charge, type ChargeDraft, type ChargeItem, type ChargeProvider } from "../../db/charges";
import {
  buildCobranca,
  cancelCobranca,
  cobrancaPdf,
  emitCobranca,
  emptyPayer,
  INTER_ENV_LABEL,
  INTER_MIN_CENTS,
  interStatus,
  loadInterSettings,
  newSeuNumero,
  payCobrancaSandbox,
  payerProblems,
  SITUACAO_LABEL,
  type InterPayer,
  type InterSettings,
  type InterSituacao,
} from "../../lib/inter";
import { applyInterResult, syncGfPending, syncInterCharge } from "../../lib/interSync";
import { fiscalVersion } from "../../lib/nfse/fiscal";
import { formatCepInput, lookupCep } from "../../lib/cep";
import { prepareFile, saveBlobAs, saveContent } from "../../lib/documentFiles";
import { confirmProduction } from "./NfseDialog";
import { fiscalHasInter } from "../settings/InterPanel";
import { buildLinkPayload, createPaymentLink, loadInfinitePay, normalizeHandle, requestInfinitePayPermission, saveInfinitePay } from "../../lib/infinitepay";
import { errorText } from "../../lib/errors";
import { formatCents } from "../../lib/format";
import { MoneyInput } from "../ui/MoneyInput";
import { Field } from "../ui/form";
import type { LaunchPreset } from "./FinanceTab";
import { loadGfSettings, removeLaunch, settleLaunch } from "../../lib/finance/gfBridge";

const today = () => new Date().toLocaleDateString("sv-SE");
const PROVIDER_KEY = "conectcrm-charge-provider";
/** Chamada RPC por nome (para as funções compartilhadas com o service worker). */
const rpcAny = <T,>(method: string, params: Record<string, unknown>) => (call as unknown as (m: string, p: unknown) => Promise<T>)(method, params);

/** Observações da receita (Gestão Financeira) de um boleto do Inter. */
export function interChargeNotes(c: { seuNumero: string; barcode?: string | null; pixCode?: string | null; items: ChargeItem[] }): string {
  return [
    "Cobrança Banco Inter (boleto + Pix)",
    ...(c.barcode ? [`Linha digitável: ${c.barcode}`] : []),
    ...(c.pixCode ? [`Pix copia e cola: ${c.pixCode}`] : []),
    `Pedido: ${c.seuNumero}`,
    "",
    ...c.items.map((i) => `- ${i.quantity} × ${i.description} — ${brl(i.priceCents * i.quantity)}`),
  ].join("\n");
}
const day = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const STATUS: Record<Charge["status"], { label: string; color: "amber" | "green" | "slate" }> = {
  open: { label: "Aguardando pagamento", color: "amber" },
  paid: { label: "Paga", color: "green" },
  canceled: { label: "Cancelada", color: "slate" },
};

/** Observações da receita na Gestão Financeira. */
export function chargeNotes(c: { url: string; orderNsu: string; items: ChargeItem[] }): string {
  return [
    "Cobrança InfinitePay (link de pagamento)",
    `Link: ${c.url}`,
    `Pedido: ${c.orderNsu}`,
    "",
    ...c.items.map((i) => `- ${i.quantity} × ${i.description} — ${brl(i.priceCents * i.quantity)}`),
  ].join("\n");
}

export function ChargeDialog({
  cardId,
  gfActive,
  onClose,
  onChanged,
  onLaunchFinance,
}: {
  cardId: string;
  /** Gestão Financeira conectada (direto ou por pacote). */
  gfActive: boolean;
  onClose: () => void;
  onChanged?: () => void;
  /** Abre a receita na Gestão Financeira (aba Financeiro do cartão). */
  onLaunchFinance: (preset: LaunchPreset) => void;
}) {
  const [draft, setDraft] = useState<ChargeDraft | null>(null);
  const [items, setItems] = useState<ChargeItem[]>([]);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "" });
  const [dueDate, setDueDate] = useState(today());
  const [handle, setHandle] = useState("");
  const [company, setCompany] = useState("");
  const [editHandle, setEditHandle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; preset: LaunchPreset; barcode?: string | null; pixCode?: string | null; chargeId?: string } | null>(null);
  const [provider, setProvider] = useState<ChargeProvider>("infinitepay");
  const [inter, setInter] = useState<InterSettings | null>(null);
  /** null = verificando; false = Fiscal sem Inter ou integração não configurada. */
  const [interReady, setInterReady] = useState<boolean | null>(null);
  const [payer, setPayer] = useState<InterPayer>(emptyPayer());
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async (resetForm: boolean) => {
    try {
      const d = await call("charges.draft", { id: cardId });
      setDraft(d);
      if (resetForm) {
        setItems(d.items);
        setCustomer({ name: d.customer.name ?? "", email: d.customer.email ?? "", phone: d.customer.phone ?? "" });
        setPayer({ ...emptyPayer(), ...d.payer, cep: formatCepInput(d.payer.cep) });
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load(true).then(() => syncGfPending(rpcAny, { cardId }).then(async (r) => {
        if (r.some((x) => x.done)) await load(false);
      }).catch(() => undefined));
    void loadInfinitePay().then((s) => {
      setHandle(s.handle);
      setCompany(s.company);
    });
    void chrome.storage.local.get(PROVIDER_KEY).then((v) => v[PROVIDER_KEY] === "inter" && setProvider("inter"));
    void loadInterSettings().then(async (s) => {
      setInter(s);
      const v = await fiscalVersion();
      if (!fiscalHasInter(v)) return setInterReady(false);
      setInterReady(await interStatus(s.env).then((i) => i.configured).catch(() => false));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseProvider = (p: ChargeProvider) => {
    setProvider(p);
    setCreated(null);
    void chrome.storage.local.set({ [PROVIDER_KEY]: p });
  };

  const total = chargeTotal(items);
  const setItem = (i: number, patch: Partial<ChargeItem>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const problems = [
    !items.length && "Inclua pelo menos um item.",
    items.some((i) => !i.description.trim()) && "Todo item precisa de descrição.",
    items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1) && "Quantidade precisa ser um número inteiro (1, 2, 3…).",
    items.some((i) => i.priceCents <= 0) && "Todo item precisa de valor.",
    ...(provider === "inter"
      ? [
          total < INTER_MIN_CENTS && "O valor mínimo de um boleto no Inter é R$ 2,50.",
          !dueDate && "Informe o vencimento.",
          dueDate && dueDate < today() && "O vencimento não pode ser antes de hoje.",
          interReady === false && "Configure o Banco Inter em Configurações → Integrações → Banco Inter (com o ConectCRM Fiscal 1.1).",
          ...payerProblems(payer),
        ]
      : [total < MIN_CHARGE_CENTS && "O valor mínimo de uma cobrança na InfinitePay é R$ 1,00.", !normalizeHandle(handle) && "Informe a InfiniteTag da conta InfinitePay."]),
  ].filter(Boolean) as string[];

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const generate = async () => {
    // 1º, ainda dentro do clique: a permissão do site da InfinitePay (1º uso).
    const permission = requestInfinitePayPermission();
    setError(null);
    if (!(await permission.catch(() => false))) {
      setError("Sem a permissão de acesso à InfinitePay não dá para gerar o link. Clique em Gerar cobrança de novo e escolha Permitir.");
      return;
    }
    if (!draft) return;
    if (!confirm(`Gerar a cobrança de ${formatCents(total)} na InfinitePay ($${normalizeHandle(handle)})?`)) return;
    setBusy(true);
    try {
      await saveInfinitePay({ handle, company });
      const orderNsu = await call("charges.newOrderNsu", { id: cardId });
      const clean = items.map((i) => ({ ...i, description: i.description.trim() }));
      const payload = buildLinkPayload(handle, orderNsu, clean, {
        name: customer.name.trim() || null,
        email: customer.email.trim() || null,
        phone: customer.phone.trim() || null,
      });
      const { url } = await createPaymentLink(payload);
      const description = `Cobrança InfinitePay — ${draft.cardTitle}`.slice(0, 200);
      await call("charges.save", { id: cardId, handle: payload.handle, orderNsu, url, items: clean, description, dueDate, company });
      const preset: LaunchPreset = { description, amountCents: total, notes: chargeNotes({ url, orderNsu, items: clean }), dueDate, requestId: orderNsu };
      setCreated({ url, preset });
      await load(false);
      onChanged?.();
      // A receita correspondente: abre já preenchida na Gestão Financeira.
      if (gfActive) onLaunchFinance(preset);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Boleto + Pix no Inter: emite, espera a linha digitável, guarda o PDF no GED e lança a receita. */
  const generateInter = async () => {
    if (!draft || !inter) return;
    setError(null);
    setInfo(null);
    const env = inter.env;
    if (env === "producao" ? !confirmProduction(`emitir um boleto real de ${formatCents(total)} no Banco Inter para ${payer.name}`) : !confirm(`Emitir o boleto de teste de ${formatCents(total)} no Inter (Sandbox)?`))
      return;
    setBusy(true);
    try {
      await saveInfinitePay({ handle, company });
      const seuNumero = newSeuNumero();
      const clean = items.map((i) => ({ ...i, description: i.description.trim() }));
      const body = buildCobranca({ seuNumero, amountCents: total, dueDate, payer, settings: inter });
      const cob = await emitCobranca(env, body);
      if (cob.situacao === "FALHA_EMISSAO") throw new Error("O Inter não conseguiu emitir o boleto (falha na emissão). Confira os dados do pagador e tente de novo.");
      const description = `Boleto Inter — ${draft.cardTitle}`.slice(0, 200);
      const chargeId = await rpcAny<string>("charges.saveInter", {
        id: cardId,
        env,
        seuNumero,
        codigoSolicitacao: cob.codigoSolicitacao,
        situacao: cob.situacao,
        items: clean,
        description,
        dueDate,
        company,
        barcode: cob.linhaDigitavel,
        pixCode: cob.pixCopiaECola,
      });
      const preset: LaunchPreset = {
        description,
        amountCents: total,
        notes: interChargeNotes({ seuNumero, barcode: cob.linhaDigitavel, pixCode: cob.pixCopiaECola, items: clean }),
        dueDate,
        requestId: seuNumero,
      };
      setCreated({ url: "", preset, barcode: cob.linhaDigitavel, pixCode: cob.pixCopiaECola, chargeId });
      // PDF do boleto nos documentos do cartão.
      try {
        await storeBoletoPdf(chargeId, env, cob.codigoSolicitacao, seuNumero, total);
      } catch (e) {
        setInfo(`Boleto emitido, mas o PDF não foi guardado nos documentos: ${errorText(e)} Use o botão PDF na lista para tentar de novo.`);
      }
      if (!cob.linhaDigitavel) setInfo("Boleto emitido; o Inter ainda está gerando a linha digitável. Use Atualizar situação daqui a pouco.");
      await load(false);
      onChanged?.();
      if (gfActive) onLaunchFinance(preset);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const storeBoletoPdf = async (chargeId: string, env: InterSettings["env"], codigo: string, seuNumero: string, amountCents: number): Promise<Uint8Array> => {
    const pdf = await cobrancaPdf(env, codigo);
    const name = boletoDocumentName(payer.name || draft?.cardTitle || "", amountCents, seuNumero);
    const prepared = await prepareFile(new File([pdf as Uint8Array<ArrayBuffer>], `${name}.pdf`, { type: "application/pdf" }));
    const file = await saveContent(prepared, name);
    await rpcAny("charges.savePdf", { id: chargeId, file, name });
    return pdf;
  };

  /** Ações de uma cobrança do Inter (situação, PDF, cancelar, simular pagamento no Sandbox). */
  const interAction = async (c: Charge, action: "sync" | "pdf" | "cancel" | "pay") => {
    if (!c.provider_ref || !c.provider_env) return;
    const env = c.provider_env as InterSettings["env"];
    let reason = "";
    if (action === "cancel") {
      const r = prompt(
        `Cancelar o boleto de ${formatCents(c.amount_cents)} no Banco Inter?\n\nO boleto deixa de poder ser pago e a receita dele na Gestão Financeira é excluída (se ainda não foi recebida).\n\nMotivo do cancelamento:`,
        "Cancelada a pedido do cliente",
      );
      if (r === null) return;
      reason = r;
    }
    setBusyRow(c.id);
    setError(null);
    setInfo(null);
    try {
      if (action === "pdf") {
        const pdf = c.pdf_doc_id ? await cobrancaPdf(env, c.provider_ref) : await storeBoletoPdf(c.id, env, c.provider_ref, c.order_nsu, c.amount_cents);
        saveBlobAs(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), `${boletoDocumentName(payer.name || draft?.cardTitle || "", c.amount_cents, c.order_nsu)}.pdf`);
        if (!c.pdf_doc_id) setInfo("PDF do boleto guardado nos documentos do cartão.");
      } else if (action === "cancel") {
        await cancelCobranca(env, c.provider_ref, reason);
        const r = await applyInterResult(rpcAny, c.id, { situacao: "CANCELADO" });
        setInfo(["Boleto cancelado no Inter.", r.gf].filter(Boolean).join(" "));
      } else {
        if (action === "pay") await payCobrancaSandbox(c.provider_ref);
        const r = await syncInterCharge(rpcAny, { id: c.id, provider_ref: c.provider_ref, provider_env: env });
        const label = SITUACAO_LABEL[r.cobranca.situacao as InterSituacao] ?? r.cobranca.situacao;
        setInfo([`Situação no Inter: ${label}.`, r.gf].filter(Boolean).join(" "));
      }
      await load(false);
      onChanged?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyRow(null);
    }
  };

  /** Receita da cobrança (para lançar de novo ao reabrir). */
  const presetOf = (c: Charge): LaunchPreset => ({
    description: c.description,
    amountCents: c.amount_cents,
    notes:
      c.provider === "inter"
        ? interChargeNotes({ seuNumero: c.order_nsu, barcode: c.barcode, pixCode: c.pix_code, items: c.items })
        : chargeNotes({ url: c.url, orderNsu: c.order_nsu, items: c.items }),
    dueDate: c.due_date,
    requestId: c.order_nsu,
  });

  const setStatus = async (c: Charge, status: Charge["status"]) => {
    const q =
      status === "paid"
        ? `Marcar a cobrança de ${formatCents(c.amount_cents)} como paga?\n\nConfira o pagamento no app ou na Conta Web da InfinitePay (Suas vendas → Checkout integrado). A receita dela na Gestão Financeira fica como Recebida (hoje).`
        : status === "canceled"
          ? `Cancelar a cobrança de ${formatCents(c.amount_cents)}?\n\nA receita dela na Gestão Financeira será excluída (se ainda não foi recebida).\nA InfinitePay não permite desativar um link já criado: se o cliente pagar mesmo assim, estorne pelo app ou pela Conta Web.`
          : c.status === "canceled"
            ? "Reabrir esta cobrança?\n\nA receita dela será lançada de novo na Gestão Financeira."
            : c.status === "paid"
              ? "Reabrir esta cobrança?\n\nA receita dela na Gestão Financeira volta a ficar pendente (sem data de recebimento)."
              : "Reabrir esta cobrança?";
    if (!confirm(q)) return;
    setError(null);
    setInfo(null);
    try {
      await call("charges.setStatus", { id: c.id, status });
      await load(false);
      onChanged?.();
    } catch (e) {
      setError(errorText(e));
      return;
    }
    const gf = await loadGfSettings().catch(() => null);
    const direct = !!gf?.gfId && gf.direct;
    if (status === "paid" || (status === "open" && c.status === "paid")) {
      const paid = status === "paid";
      if (!direct) {
        if (gfActive) setInfo(`Cobrança ${paid ? "marcada como paga" : "reaberta"}. Sem a Gestão Financeira aberta neste Chrome, ${paid ? "dê baixa na receita" : "volte a receita para pendente"} lá.`);
        return;
      }
      try {
        const r = await settleLaunch(gf!.gfId!, cardId, c.order_nsu, paid, today());
        setInfo(
          r.total === 0
            ? `Cobrança ${paid ? "marcada como paga" : "reaberta"}. Não achei a receita desta cobrança na Gestão Financeira.`
            : paid
              ? `Cobrança paga e receita marcada como Recebida na Gestão Financeira${r.updated < r.total ? " (já estava recebida)" : ""}.`
              : "Cobrança reaberta e receita de volta a pendente na Gestão Financeira.",
        );
        onChanged?.();
      } catch (e) {
        setError(`Cobrança ${paid ? "marcada como paga" : "reaberta"} no CRM, mas a receita não mudou na Gestão Financeira: ${errorText(e)}`);
      }
    } else if (status === "canceled") {
      if (!direct) {
        if (gfActive) setInfo("Cobrança cancelada. Sem a Gestão Financeira aberta neste Chrome, exclua a receita dela lá (o número do pedido está nas observações).");
        return;
      }
      try {
        const r = await removeLaunch(gf!.gfId!, cardId, c.order_nsu);
        setInfo(
          r.removed
            ? `Cobrança cancelada e receita excluída da Gestão Financeira${r.paid ? ` (${r.paid} já recebida ficou lá: estorne/exclua manualmente)` : ""}.`
            : r.paid
              ? "Cobrança cancelada, mas a receita na Gestão Financeira já está como recebida: não foi excluída. Confira lá."
              : "Cobrança cancelada. Não havia receita desta cobrança na Gestão Financeira.",
        );
        onChanged?.();
      } catch (e) {
        setError(`Cobrança cancelada no CRM, mas a receita não foi excluída na Gestão Financeira: ${errorText(e)}`);
      }
    } else if (status === "open" && c.status === "canceled" && gfActive) {
      // Reaberta: a receita volta (se ainda não existir lá).
      if (direct) {
        try {
          const r = await removeLaunch(gf!.gfId!, cardId, c.order_nsu, true);
          if (r.pending || r.paid) {
            setInfo("Cobrança reaberta. A receita dela continua na Gestão Financeira.");
            return;
          }
        } catch {
          // Gestão Financeira antiga: lança mesmo assim.
        }
      }
      setInfo("Cobrança reaberta: confira e salve a receita na Gestão Financeira.");
      onLaunchFinance(presetOf(c));
    }
  };

  return (
    <TaModal isOpen onClose={onClose} title="Cobrança" width="max-w-3xl">
      <div className="space-y-4 text-theme-sm text-gray-700 dark:text-gray-300" data-charge-dialog>
        {!draft ? (
          error ? <p className="rounded-lg bg-error-50 px-3 py-2 text-error-700">{error}</p> : <p className="text-gray-500">Carregando…</p>
        ) : (
          <>
            <section className="grid gap-2 sm:grid-cols-2" data-charge-provider>
              {(
                [
                  { id: "infinitepay", icon: <CreditCard size={18} />, title: "InfinitePay", text: "Link de pagamento: Pix ou cartão (até 12x)." },
                  { id: "inter", icon: <Landmark size={18} />, title: "Banco Inter", text: "Boleto + Pix com vencimento, multa e juros; baixa automática." },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => chooseProvider(o.id)}
                  aria-pressed={provider === o.id}
                  data-charge-provider-option={o.id}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left",
                    provider === o.id ? "border-brand-300 bg-brand-25 ring-2 ring-brand-500/10 dark:bg-brand-500/10" : "border-gray-200 hover:bg-gray-50 dark:border-gray-700",
                  )}
                >
                  <span className={cn("mt-0.5", provider === o.id ? "text-brand-600" : "text-gray-400")}>{o.icon}</span>
                  <span>
                    <span className="block font-semibold text-gray-800 dark:text-white/90">
                      {o.title}
                      {o.id === "inter" && inter && <span className="ml-2 text-theme-xs font-normal text-gray-500">{INTER_ENV_LABEL[inter.env]}</span>}
                    </span>
                    <span className="block text-theme-xs text-gray-500">{o.text}</span>
                  </span>
                </button>
              ))}
            </section>

            {created && (created.barcode || created.pixCode || (provider === "inter" && created.chargeId)) && (
              <div className="rounded-xl border border-success-200 bg-success-50 p-3 text-success-800 dark:bg-success-500/10" data-charge-created-inter>
                <p className="flex items-center gap-2 font-semibold">
                  <Check size={16} /> Boleto emitido no Inter: {formatCents(created.preset.amountCents)}
                </p>
                {created.barcode && (
                  <p className="mt-1 break-all text-theme-xs">
                    Linha digitável: <b>{created.barcode}</b>
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {created.barcode && (
                    <TaButton size="sm" variant="outline" startIcon={copied === "bar" ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy(created.barcode!, "bar")}>
                      {copied === "bar" ? "Copiado" : "Copiar linha digitável"}
                    </TaButton>
                  )}
                  {created.pixCode && (
                    <TaButton size="sm" variant="outline" startIcon={copied === "pix" ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy(created.pixCode!, "pix")} data-charge-copy-pix>
                      {copied === "pix" ? "Copiado" : "Copiar Pix copia e cola"}
                    </TaButton>
                  )}
                  {gfActive && (
                    <TaButton size="sm" variant="outline" startIcon={<Wallet size={14} />} onClick={() => onLaunchFinance(created.preset)}>
                      Abrir a receita na Gestão Financeira
                    </TaButton>
                  )}
                </div>
                <p className="mt-2 text-theme-xs">
                  O PDF do boleto ficou nos documentos do cartão e a nota com a linha digitável e o Pix ficou nas notas (pronta para copiar e mandar ao cliente).
                  {gfActive ? " A receita foi aberta na Gestão Financeira já preenchida: confira e salve." : ""} A baixa vem sozinha quando o Inter registrar o pagamento.
                </p>
              </div>
            )}
            {created && !created.barcode && !created.pixCode && !created.chargeId && (
              <div className="rounded-xl border border-success-200 bg-success-50 p-3 text-success-800 dark:bg-success-500/10" data-charge-created>
                <p className="flex items-center gap-2 font-semibold">
                  <Check size={16} /> Cobrança gerada: {formatCents(created.preset.amountCents)}
                </p>
                <p className="mt-1 break-all text-theme-xs" data-charge-url>
                  {created.url}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <TaButton size="sm" variant="outline" startIcon={copied === "new" ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy(created.url, "new")} data-charge-copy>
                    {copied === "new" ? "Copiado" : "Copiar link"}
                  </TaButton>
                  <a className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-theme-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300" href={created.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> Abrir
                  </a>
                  {gfActive && (
                    <TaButton size="sm" variant="outline" startIcon={<Wallet size={14} />} onClick={() => onLaunchFinance(created.preset)} data-charge-launch>
                      Abrir a receita na Gestão Financeira
                    </TaButton>
                  )}
                </div>
                <p className="mt-2 text-theme-xs">
                  {gfActive
                    ? "A receita foi aberta na Gestão Financeira já preenchida (valor, vencimento, cliente e o link nas observações): confira a categoria e a conta e salve."
                    : "Conecte a Gestão Financeira (Configurações → Integrações) para lançar a receita desta cobrança."}{" "}
                  O link também ficou nas notas do cartão.
                </p>
              </div>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-theme-xs font-semibold uppercase text-gray-500">Itens da cobrança</p>
                <TaButton size="sm" variant="ghost" startIcon={<Plus size={14} />} onClick={() => setItems((l) => [...l, { description: "", quantity: 1, priceCents: 0 }])} data-charge-add-item>
                  Item
                </TaButton>
              </div>
              {items.length === 0 && <p className="text-theme-xs text-gray-500">O cartão não tem produtos/serviços nem valor. Inclua um item.</p>}
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-[1fr_70px_130px_auto] items-center gap-2" data-charge-item>
                    <TaInput value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Descrição" aria-label="Descrição do item" maxLength={200} />
                    <TaInput
                      value={String(it.quantity)}
                      onChange={(e) => setItem(i, { quantity: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                      inputMode="numeric"
                      aria-label="Quantidade"
                    />
                    <MoneyInput value={it.priceCents} onChange={(c) => setItem(i, { priceCents: c })} />
                    <button type="button" className="text-gray-400 hover:text-error-600" title="Tirar item" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-right text-theme-sm">
                Total: <b data-charge-total>{formatCents(total)}</b>
              </p>
            </section>

            {provider === "inter" && (
              <InterFields payer={payer} setPayer={setPayer} inter={inter} setInter={setInter} dueDate={dueDate} setDueDate={setDueDate} company={company} setCompany={setCompany} />
            )}

            <section className={cn("grid grid-cols-1 gap-3 md:grid-cols-3", provider === "inter" && "hidden")}>
              <Field label="Cliente (vem preenchido no pagamento)">
                <TaInput value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} aria-label="Nome do cliente" />
              </Field>
              <Field label="E-mail">
                <TaInput value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} aria-label="E-mail do cliente" />
              </Field>
              <Field label="Celular (+55…)">
                <TaInput value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} aria-label="Celular do cliente" />
              </Field>
              <Field label="Vencimento da receita">
                <TaInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-charge-due />
              </Field>
              <Field label="Conta InfinitePay (InfiniteTag)">
                {editHandle ? (
                  <TaInput value={handle} onChange={(e) => setHandle(e.target.value)} onBlur={() => setEditHandle(false)} autoFocus data-charge-handle />
                ) : (
                  <p className="py-2">
                    <b>${normalizeHandle(handle)}</b>{" "}
                    <button type="button" className="text-theme-xs text-brand-600 hover:underline" onClick={() => setEditHandle(true)}>
                      alterar
                    </button>
                  </p>
                )}
              </Field>
              <Field label="Empresa (aparece na nota da cobrança)">
                <TaInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Claudia Tecnologia" maxLength={80} data-charge-company />
              </Field>
            </section>

            {problems.length > 0 && (
              <ul className="list-disc rounded-lg bg-warning-50 py-2 pl-7 pr-3 text-theme-xs text-warning-700" data-charge-problems>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {info && (
              <p className="rounded-lg bg-brand-25 px-3 py-2 text-brand-700 dark:bg-brand-500/10" data-charge-info>
                {info}
              </p>
            )}
            {error && (
              <p className="rounded-lg bg-error-50 px-3 py-2 text-error-700" data-charge-error>
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-theme-xs text-gray-500">
                {provider === "inter"
                  ? "Boleto com Pix (QR Code no próprio boleto). O CRM consulta o Inter a cada 30 min e dá baixa sozinho."
                  : "Pix ou cartão (até 12x). O pagamento é avisado na InfinitePay; aqui você dá baixa em “Marcar como paga”."}
              </p>
              <TaButton
                startIcon={busy ? <RefreshCw size={15} className="animate-spin" /> : provider === "inter" ? <Landmark size={15} /> : <CreditCard size={15} />}
                disabled={busy || problems.length > 0 || (provider === "inter" && interReady === null)}
                onClick={() => void (provider === "inter" ? generateInter() : generate())}
                data-charge-generate
              >
                {busy ? (provider === "inter" ? "Emitindo no Inter…" : "Gerando…") : created ? "Gerar outra cobrança" : provider === "inter" ? "Emitir boleto + Pix" : "Gerar cobrança"}
              </TaButton>
            </div>

            {draft.charges.length > 0 && (
              <section data-charge-list>
                <p className="mb-2 text-theme-xs font-semibold uppercase text-gray-500">Cobranças deste cartão</p>
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {draft.charges.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-charge-row={c.status}>
                      <span className="font-medium">{formatCents(c.amount_cents)}</span>
                      <span className="text-theme-xs text-gray-500">{c.provider === "inter" ? `Inter${c.provider_env === "sandbox" ? " (Sandbox)" : ""}` : "InfinitePay"}</span>
                      <TaBadge
                        color={STATUS[c.status].color}
                        label={c.provider === "inter" && c.status === "open" && c.provider_status ? (SITUACAO_LABEL[c.provider_status as InterSituacao] ?? STATUS.open.label) : STATUS[c.status].label}
                      />
                      <span className="text-theme-xs text-gray-500">
                        gerada em {day(c.created_at)}
                        {c.due_date ? ` · vence ${day(c.due_date)}` : ""}
                        {c.paid_at ? ` · paga em ${day(c.paid_at)}` : ""}
                      </span>
                      {c.gf_sync && (
                        <span className="flex w-full items-center gap-2 text-theme-xs text-warning-700" data-charge-gf-pending>
                          Gestão Financeira: {c.gf_sync === "paid" ? "baixa da receita pendente" : "exclusão da receita pendente"}
                          {c.gf_sync_error ? ` — ${c.gf_sync_error}` : ""}
                          <button
                            type="button"
                            className="font-medium text-brand-600 hover:underline"
                            disabled={busyRow === c.id}
                            onClick={async () => {
                              setBusyRow(c.id);
                              setInfo(null);
                              const r = await syncGfPending(rpcAny, { cardId, chargeId: c.id }).catch((e) => [{ id: c.id, done: false, message: errorText(e) }]);
                              setInfo(r[0]?.message || null);
                              await load(false);
                              onChanged?.();
                              setBusyRow(null);
                            }}
                            data-charge-gf-retry
                          >
                            Tentar agora
                          </button>
                        </span>
                      )}
                      {c.provider === "inter" ? (
                        <span className="ml-auto flex flex-wrap gap-1" data-charge-inter-actions>
                          {c.barcode && (
                            <TaButton size="sm" variant="ghost" startIcon={copied === `b${c.id}` ? <Check size={13} /> : <Copy size={13} />} onClick={() => void copy(c.barcode!, `b${c.id}`)}>
                              {copied === `b${c.id}` ? "Copiado" : "Linha digitável"}
                            </TaButton>
                          )}
                          {c.pix_code && (
                            <TaButton size="sm" variant="ghost" startIcon={copied === `p${c.id}` ? <Check size={13} /> : <Copy size={13} />} onClick={() => void copy(c.pix_code!, `p${c.id}`)}>
                              {copied === `p${c.id}` ? "Copiado" : "Pix"}
                            </TaButton>
                          )}
                          <TaButton size="sm" variant="ghost" startIcon={<FileText size={13} />} disabled={busyRow === c.id} onClick={() => void interAction(c, "pdf")}>
                            PDF
                          </TaButton>
                          {c.status === "open" && (
                            <>
                              <TaButton
                                size="sm"
                                variant="ghost"
                                startIcon={<RefreshCw size={13} className={busyRow === c.id ? "animate-spin" : ""} />}
                                disabled={busyRow === c.id}
                                onClick={() => void interAction(c, "sync")}
                                data-charge-sync
                              >
                                Atualizar situação
                              </TaButton>
                              {c.provider_env === "sandbox" && (
                                <TaButton size="sm" variant="ghost" disabled={busyRow === c.id} onClick={() => void interAction(c, "pay")} data-charge-sandbox-pay>
                                  Simular pagamento
                                </TaButton>
                              )}
                              <TaButton size="sm" variant="ghost" disabled={busyRow === c.id} onClick={() => void interAction(c, "cancel")}>
                                Cancelar
                              </TaButton>
                            </>
                          )}
                        </span>
                      ) : (
                      <span className="ml-auto flex gap-1">
                        <TaButton size="sm" variant="ghost" startIcon={copied === c.id ? <Check size={13} /> : <Copy size={13} />} onClick={() => void copy(c.url, c.id)}>
                          {copied === c.id ? "Copiado" : "Link"}
                        </TaButton>
                        {c.status === "open" && (
                          <>
                            <TaButton size="sm" variant="ghost" onClick={() => void setStatus(c, "paid")} data-charge-paid>
                              Marcar como paga
                            </TaButton>
                            <TaButton size="sm" variant="ghost" onClick={() => void setStatus(c, "canceled")}>
                              Cancelar
                            </TaButton>
                          </>
                        )}
                        {c.status !== "open" && (
                          <TaButton size="sm" variant="ghost" onClick={() => void setStatus(c, "open")}>
                            Reabrir
                          </TaButton>
                        )}
                      </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </TaModal>
  );
}

/** Pagador, vencimento e condições do boleto do Inter. */
function InterFields({
  payer,
  setPayer,
  inter,
  setInter,
  dueDate,
  setDueDate,
  company,
  setCompany,
}: {
  payer: InterPayer;
  setPayer: (p: InterPayer) => void;
  inter: InterSettings | null;
  setInter: (s: InterSettings) => void;
  dueDate: string;
  setDueDate: (d: string) => void;
  company: string;
  setCompany: (c: string) => void;
}) {
  const [cepBusy, setCepBusy] = useState(false);
  const set = (p: Partial<InterPayer>) => setPayer({ ...payer, ...p });
  const fillCep = async (v: string) => {
    set({ cep: formatCepInput(v) });
    if (v.replace(/\D/g, "").length !== 8) return;
    setCepBusy(true);
    const a = await lookupCep(v).catch(() => null);
    setCepBusy(false);
    if (a) setPayer({ ...payer, cep: formatCepInput(v), street: a.street || payer.street, district: a.district || payer.district, city: a.city, state: a.state });
  };
  return (
    <section className="space-y-3" data-charge-inter>
      <div>
        <p className="mb-2 text-theme-xs font-semibold uppercase text-gray-500">Pagador (sai impresso no boleto)</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <Field label="Tipo" className="md:col-span-1">
            <TaSelect value={payer.kind} onChange={(e) => set({ kind: e.target.value as InterPayer["kind"] })} aria-label="Tipo de pessoa">
              <option value="JURIDICA">PJ</option>
              <option value="FISICA">PF</option>
            </TaSelect>
          </Field>
          <Field label={payer.kind === "FISICA" ? "CPF" : "CNPJ"} className="md:col-span-2">
            <TaInput value={payer.document} onChange={(e) => set({ document: e.target.value })} inputMode="numeric" aria-label="CPF/CNPJ do pagador" data-payer-doc />
          </Field>
          <Field label={payer.kind === "FISICA" ? "Nome" : "Razão social"} className="md:col-span-3">
            <TaInput value={payer.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} aria-label="Nome do pagador" data-payer-name />
          </Field>
          <Field label={cepBusy ? "CEP (buscando…)" : "CEP"} className="md:col-span-1">
            <TaInput value={payer.cep} onChange={(e) => void fillCep(e.target.value)} inputMode="numeric" aria-label="CEP do pagador" data-payer-cep />
          </Field>
          <Field label="Endereço" className="md:col-span-3">
            <TaInput value={payer.street} onChange={(e) => set({ street: e.target.value })} maxLength={100} aria-label="Endereço do pagador" />
          </Field>
          <Field label="Número" className="md:col-span-1">
            <TaInput value={payer.number} onChange={(e) => set({ number: e.target.value })} maxLength={10} aria-label="Número" />
          </Field>
          <Field label="Complemento" className="md:col-span-1">
            <TaInput value={payer.complement} onChange={(e) => set({ complement: e.target.value })} maxLength={30} aria-label="Complemento" />
          </Field>
          <Field label="Bairro" className="md:col-span-2">
            <TaInput value={payer.district} onChange={(e) => set({ district: e.target.value })} maxLength={60} aria-label="Bairro" />
          </Field>
          <Field label="Cidade" className="md:col-span-3">
            <TaInput value={payer.city} onChange={(e) => set({ city: e.target.value })} maxLength={60} aria-label="Cidade" />
          </Field>
          <Field label="UF" className="md:col-span-1">
            <TaInput value={payer.state} onChange={(e) => set({ state: e.target.value.toUpperCase().slice(0, 2) })} aria-label="UF" />
          </Field>
          <Field label="E-mail (o Inter envia o boleto)" className="md:col-span-3">
            <TaInput value={payer.email} onChange={(e) => set({ email: e.target.value })} maxLength={50} aria-label="E-mail do pagador" />
          </Field>
          <Field label="Celular" className="md:col-span-3">
            <TaInput value={payer.phone} onChange={(e) => set({ phone: e.target.value })} aria-label="Celular do pagador" />
          </Field>
        </div>
        <p className="mt-1 text-theme-xs text-gray-500">Vem da organização do cartão (CNPJ e endereço) ou do contato (CPF). O que mudar aqui vale só para este boleto.</p>
      </div>
      {inter && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Vencimento">
            <TaInput type="date" value={dueDate} min={new Date().toLocaleDateString("sv-SE")} onChange={(e) => setDueDate(e.target.value)} data-charge-due />
          </Field>
          <Field label="Multa (%)">
            <TaInput type="number" min={0} step={0.01} value={String(inter.finePct)} onChange={(e) => setInter({ ...inter, finePct: Math.max(0, Number(e.target.value) || 0) })} aria-label="Multa" />
          </Field>
          <Field label="Juros (% ao mês)">
            <TaInput type="number" min={0} step={0.01} value={String(inter.interestPctMonth)} onChange={(e) => setInter({ ...inter, interestPctMonth: Math.max(0, Number(e.target.value) || 0) })} aria-label="Juros" />
          </Field>
          <Field label="Cancelar sozinho após (dias)">
            <TaInput
              type="number"
              min={0}
              max={60}
              value={String(inter.cancelAfterDays)}
              onChange={(e) => setInter({ ...inter, cancelAfterDays: Math.min(60, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
              aria-label="Cancelamento automático"
            />
          </Field>
          <Field label="Mensagem no boleto" className="md:col-span-2">
            <TaInput value={inter.message} maxLength={78} onChange={(e) => setInter({ ...inter, message: e.target.value })} aria-label="Mensagem no boleto" />
          </Field>
          <Field label="Empresa (aparece na nota da cobrança)" className="md:col-span-2">
            <TaInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Claudia Tecnologia" maxLength={80} />
          </Field>
        </div>
      )}
    </section>
  );
}
