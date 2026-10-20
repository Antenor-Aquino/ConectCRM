// Configurações → Integrações → Gestão Financeira (spec 13): encontra a
// extensão Gestão Financeira neste Chrome, pede a conexão (o usuário permite
// lá), testa e define as formas de integração.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileDown, Link2, MonitorSmartphone, Plug, RefreshCw, Unplug } from "lucide-react";
import { TaButton, TaInput, TaPanel } from "@tailadmin";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import {
  findGfInstalls,
  GF_ENV_LABEL,
  hello,
  loadGfSettings,
  ping,
  responseText,
  saveGfSettings,
  type GfInstall,
  type GfSettings,
} from "../../lib/finance/gfBridge";
import type { IntegrationResponse } from "../../lib/finance/protocol";
import { SwitchRow } from "../ui/Switch";

type Paired = Extract<IntegrationResponse, { status: "paired" }>;
type Status = { kind: "checking" } | { kind: "paired"; info: Paired } | { kind: "msg"; text: string; warn?: boolean } | { kind: "idle" };

export function GestaoFinanceiraPanel() {
  const [s, setS] = useState<GfSettings | null>(null);
  const [installs, setInstalls] = useState<GfInstall[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [manualId, setManualId] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const waiting = useRef(0);

  const persist = async (next: GfSettings) => {
    setS(next);
    await saveGfSettings(next);
  };

  const check = async (cfg: GfSettings) => {
    if (!cfg.gfId) return setStatus({ kind: "idle" });
    setStatus({ kind: "checking" });
    try {
      const r = await ping(cfg.gfId);
      setStatus(r.ok && r.status === "paired" ? { kind: "paired", info: r } : { kind: "msg", text: responseText(r), warn: true });
    } catch (e) {
      setStatus({ kind: "msg", text: errorText(e), warn: true });
    }
  };

  const refresh = async () => {
    const cfg = await loadGfSettings();
    setS(cfg);
    setInstalls(await findGfInstalls().catch(() => []));
    await check(cfg);
  };

  useEffect(() => {
    void refresh();
    return () => void waiting.current++;
  }, []);

  /** Pede a conexão e espera o usuário permitir na Gestão Financeira (até 3 min). */
  const connect = async (gfId: string) => {
    if (!s) return;
    const my = ++waiting.current;
    setBusy(true);
    try {
      let r = await hello(gfId);
      const until = Date.now() + 180_000;
      while (r.ok && r.status === "pending" && my === waiting.current && Date.now() < until) {
        setStatus({ kind: "msg", text: responseText(r) });
        await new Promise((res) => setTimeout(res, 2000));
        r = await hello(gfId);
      }
      if (my !== waiting.current) return;
      if (r.ok && r.status === "paired") {
        await persist({ ...s, gfId, pairedAt: new Date().toISOString() });
        setStatus({ kind: "paired", info: r });
      } else setStatus({ kind: "msg", text: r.ok && r.status === "pending" ? "Tempo esgotado esperando a permissão. Tente de novo." : responseText(r), warn: true });
    } catch (e) {
      setStatus({ kind: "msg", text: errorText(e), warn: true });
    } finally {
      if (my === waiting.current) setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!s || !confirm("Desconectar a Gestão Financeira? Os cartões deixam de abrir lançamentos lá até conectar de novo.")) return;
    waiting.current++;
    await persist({ ...s, gfId: null, pairedAt: null });
    setStatus({ kind: "idle" });
  };

  if (!s || !installs) return null;
  const found = installs.filter((i) => i.enabled);
  const target = s.gfId ?? found[0]?.id ?? null;

  return (
    <TaPanel
      title="Gestão Financeira"
      subtitle="Lance receitas e despesas dos cartões na extensão Gestão Financeira instalada neste Chrome e acompanhe o resultado de cada negócio, projeto ou atendimento."
    >
      <div data-gf-panel>
        {status.kind === "paired" ? (
          <div className="mb-4 rounded-xl border border-success-200 bg-success-50 p-4 dark:border-success-500/30 dark:bg-success-500/10" data-gf-status="paired">
            <p className="flex items-center gap-2 text-theme-sm font-semibold text-success-800 dark:text-success-400">
              <CheckCircle2 size={16} /> Conectado à Gestão Financeira {status.info.version}
            </p>
            <p className="mt-1 text-theme-xs text-gray-600 dark:text-gray-400">
              Ambiente: <b>{GF_ENV_LABEL[status.info.env]}</b>
              {s.pairedAt ? ` · desde ${formatDateTime(s.pairedAt)}` : ""}
            </p>
            {status.info.env === "demo" && (
              <p className="mt-2 flex items-start gap-1.5 text-theme-xs text-warning-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> A Gestão Financeira está no Ambiente de Teste: lançamentos iriam para os dados de exemplo. Volte
                para Produção lá antes de lançar.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <TaButton size="sm" startIcon={<RefreshCw size={14} />} onClick={() => void check(s)}>
                Testar conexão
              </TaButton>
              <TaButton size="sm" startIcon={<Unplug size={14} />} onClick={() => void disconnect()}>
                Desconectar
              </TaButton>
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800" data-gf-status="not-paired">
            {target ? (
              <>
                <p className="text-theme-sm text-gray-700 dark:text-gray-300">
                  {s.gfId ? "Gestão Financeira configurada" : `Encontrei a ${found[0]!.name} ${found[0]!.version} neste Chrome`}. Conecte para os cartões abrirem os
                  lançamentos lá.
                </p>
                <TaButton className="mt-3" variant="primary" startIcon={<Plug size={15} />} disabled={busy} onClick={() => void connect(target)}>
                  {busy ? "Aguardando a permissão…" : "Conectar"}
                </TaButton>
                <p className="mt-2 text-theme-xs text-gray-500">A Gestão Financeira abre e pergunta se você permite a conexão.</p>
              </>
            ) : (
              <p className="text-theme-sm text-gray-700 dark:text-gray-300">
                {installs.length ? "A Gestão Financeira está desativada em chrome://extensions. Ative-a e " : "Não encontrei a extensão Gestão Financeira neste Chrome. Instale-a e "}
                <button type="button" className="text-brand-600 hover:underline" onClick={() => void refresh()}>
                  procure de novo
                </button>
                .
              </p>
            )}
            {status.kind === "checking" && <p className="mt-2 text-theme-xs text-gray-500">Conferindo…</p>}
            {status.kind === "msg" && (
              <p className={`mt-3 text-theme-sm ${status.warn ? "text-warning-700" : "text-gray-600"}`} data-gf-msg>
                {status.text}
              </p>
            )}
            <button type="button" className="mt-3 flex items-center gap-1 text-theme-xs text-gray-500 hover:text-gray-800" onClick={() => setShowManual((v) => !v)}>
              <Link2 size={12} /> Informar o ID da Gestão Financeira manualmente
            </button>
            {showManual && (
              <div className="mt-2 flex gap-2">
                <TaInput
                  value={manualId}
                  placeholder="ID (Gestão Financeira → Configurações → Integrações)"
                  aria-label="ID da Gestão Financeira"
                  onChange={(e) => setManualId(e.target.value.trim())}
                />
                <TaButton disabled={!/^[a-p]{32}$/.test(manualId) || busy} onClick={() => void connect(manualId)}>
                  Conectar
                </TaButton>
              </div>
            )}
          </div>
        )}

        <p className="mb-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">Formas de integração</p>
        <SwitchRow
          icon={<MonitorSmartphone size={16} />}
          label="Direta (mesmo Chrome)"
          help="Os cartões abrem as telas de lançamento da Gestão Financeira e o resultado volta sozinho para o CRM."
          checked={s.direct}
          onChange={(v) => void persist({ ...s, direct: v })}
        />
        <SwitchRow
          icon={<FileDown size={16} />}
          label="Por pacote de arquivo (opcional)"
          help="O CRM gera um arquivo com os lançamentos e a Gestão Financeira importa (como o app de captura). Útil quando ela não está neste Chrome."
          checked={s.package}
          onChange={(v) => void persist({ ...s, package: v })}
        />
        <p className="mt-3 text-theme-xs text-gray-500">
          Os lançamentos pelos cartões (aba Financeiro) chegam na próxima etapa da integração; esta etapa liga e testa a conexão.
        </p>
      </div>
    </TaPanel>
  );
}
