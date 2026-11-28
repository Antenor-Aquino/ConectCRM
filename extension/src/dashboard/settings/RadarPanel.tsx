// Configurações → Integrações → Radar Caixa Escolar MG (spec 25): endereço do
// robô local, funil e etapas de destino, palavras-chave, de onde começar e a
// leitura (a cada 10 min com o Chrome aberto, ou "Sincronizar agora").
import { useEffect, useState } from "react";
import { Plug, Power, RefreshCw } from "lucide-react";
import { TaButton, TaInput, TaPanel, TaSelect } from "@tailadmin";
import { call } from "../../rpc/client";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { fetchRadar, loadRadar, radarBaseUrl, requestRadarPermission, saveRadar, type RadarSettings } from "../../lib/radar";
import { RADAR_MOTIVO_TEXTO, type RadarDecisao, type RadarDuplicado, type RadarMotivo } from "../../db/radar";
import type { RadarInicio, RadarSyncResult } from "../../db/radar";
import { useSession } from "../session";
import { Field } from "../ui/form";

type Msg = { text: string; kind: "ok" | "err" } | null;
type Opt = { id: string; name: string };

const INICIO: { value: RadarInicio; label: string; hint: string }[] = [
  { value: "abertas", label: "Os abertos agora e os que surgirem", hint: "Orçamentos ainda no prazo, propostas enviadas aguardando resultado e os novos." },
  { value: "novas", label: "Só os que surgirem daqui para frente", hint: "Nada do que o Radar já tinha antes de ligar." },
  {
    value: "historico",
    label: "Todo o histórico do Radar",
    hint: "Inclusive os encerrados (entram como Pendente, para a sua avaliação).",
  },
];

export function RadarPanel() {
  const { user } = useSession();
  const [s, setS] = useState<RadarSettings | null>(null);
  const [pipelines, setPipelines] = useState<Opt[]>([]);
  const [stages, setStages] = useState<Opt[]>([]);
  const [resumo, setResumo] = useState<{ cartoes: number; abertos: number } | null>(null);
  const [duplicados, setDuplicados] = useState<RadarDuplicado[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    void loadRadar().then(setS);
    void call("pipelines.list", {}).then((p) => setPipelines(p.filter((x) => x.type === "comercial").map((x) => ({ id: x.id, name: x.name }))));
    void call("radar.resumo").then(setResumo);
    void call("radar.duplicados").then(setDuplicados);
  }, []);

  useEffect(() => {
    if (!s?.pipelineId) return setStages([]);
    void call("stages.list", { pipelineId: s.pipelineId }).then((st) => setStages(st.map((x) => ({ id: x.id, name: x.name }))));
  }, [s?.pipelineId]);

  if (!s) return null;
  const save = async (patch: Partial<RadarSettings>) => {
    const next = { ...(await loadRadar()), ...patch };
    setS(next);
    await saveRadar(next);
  };

  const test = async () => {
    setMsg(null);
    setBusy("test");
    try {
      const url = radarBaseUrl(s.url);
      // A permissão precisa ser pedida no clique (gesto do usuário).
      if (!(await requestRadarPermission(url))) throw new Error("Sem a permissão de acesso ao Radar neste computador não dá para ler os orçamentos.");
      const d = await fetchRadar(url);
      await save({ url, radarVersao: d.radar.versao, termosRadar: d.radar.termos });
      setMsg({ kind: "ok", text: `Radar ${d.radar.versao} conectado: ${d.oportunidades.length} orçamento(s) guardados. Palavras-chave: ${d.radar.termos.join(", ") || "—"}.` });
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const activate = async (on: boolean) => {
    setMsg(null);
    if (on && !s.pipelineId) return setMsg({ kind: "err", text: "Escolha o funil dos cartões antes de ligar." });
    if (on && !s.radarVersao) return setMsg({ kind: "err", text: "Teste a conexão com o Radar antes de ligar." });
    await save({ active: on, ativadoEm: s.ativadoEm ?? (on ? new Date().toISOString() : null) });
    setMsg({ kind: "ok", text: on ? "Integração ligada. Clique em Sincronizar agora para trazer os cartões já." : "Integração desligada. Os cartões já criados continuam no CRM." });
  };

  const syncNow = async () => {
    setMsg(null);
    setBusy("sync");
    try {
      const r = (await chrome.runtime.sendMessage({ target: "background", kind: "radar-sync", userId: user.id })) as { ok: boolean; error?: string; result: RadarSyncResult | null };
      if (!r?.ok) throw new Error(r?.error ?? "Não foi possível ler o Radar.");
      const x = r.result;
      setMsg({
        kind: x?.errors.length ? "err" : "ok",
        text: x
          ? `${x.created} cartão(ões) novo(s), ${x.updated} atualizado(s).${x.convertidos ? ` ${x.convertidos} voltaram para Pendente.` : ""}${x.parecidos.length ? ` ${x.parecidos.length} aguardam a sua confirmação (abaixo).` : ""}${x.errors.length ? ` ${x.errors.length} não entraram: ${x.errors[0]!.error}` : ""}`
          : "Nada a fazer.",
      });
      void call("radar.resumo").then(setResumo);
      void call("radar.duplicados").then(setDuplicados);
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    } finally {
      setBusy(null);
      setS(await loadRadar());
    }
  };

  /** Decisão sobre um orçamento parecido com cartão existente; já sincroniza para aplicar. */
  const decidir = async (id: number, d: RadarDecisao) => {
    const atual = await loadRadar();
    await save({ decisoes: { ...atual.decisoes, [String(id)]: d }, parecidos: atual.parecidos.filter((p) => p.id !== id) });
    await syncNow();
  };

  /** Possível duplicado já criado: juntar no cartão feito à mão ou marcar como diferentes. */
  const resolver = async (dealId: string, acao: { juntarEm: string } | "diferentes") => {
    setMsg(null);
    setBusy("dup");
    try {
      await call("radar.resolverDuplicado", { dealId, acao });
      setMsg({ kind: "ok", text: acao === "diferentes" ? "Certo: ficam os dois cartões." : "Cartões juntados: o Radar passa a acompanhar o cartão que você já tinha." });
      setDuplicados(await call("radar.duplicados"));
      setResumo(await call("radar.resumo"));
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const toggleTermo = (t: string, on: boolean) => {
    const set = new Set(s.termos);
    if (on) set.add(t);
    else set.delete(t);
    void save({ termos: [...set] });
  };

  const stageSelect = (label: string, key: "stageEntrada" | "stageEnviada" | "stageGanha", empty: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <TaSelect value={s[key] ?? ""} onChange={(e) => void save({ [key]: e.target.value || null })} disabled={!s.pipelineId} data-radar-stage={key}>
        <option value="">{empty}</option>
        {stages.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </TaSelect>
    </Field>
  );

  return (
    <TaPanel
      title="Radar Caixa Escolar MG"
      subtitle="Os orçamentos que o Radar acha no portal Caixa Escolar viram cartões e acompanham a proposta até o resultado. Tudo fica neste computador."
    >
      <div className="space-y-5 text-theme-sm" data-radar-panel>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-theme-xs text-gray-600 dark:bg-white/5 dark:text-gray-400">
          O Radar precisa estar ligado neste computador (versão 1.16 ou mais nova). O ConectCRM só <b>lê</b> os orçamentos dele: nada é alterado no Radar nem
          no portal. Cada orçamento vira um cartão uma vez só; depois o cartão só avança (proposta enviada → resultado no portal, quando fica Pendente para a
          sua avaliação) e, se você já ganhou ou perdeu o cartão à mão, o Radar não mexe.
        </div>

        <div className="flex items-end gap-2">
          <Field label="Endereço do Radar" className="flex-1">
            <TaInput value={s.url} onChange={(e) => setS({ ...s, url: e.target.value })} onBlur={() => void save({ url: s.url })} placeholder="http://127.0.0.1:8765" data-radar-url />
          </Field>
          <TaButton variant="outline" startIcon={<Plug size={15} />} disabled={!!busy} onClick={() => void test()} data-radar-test>
            {busy === "test" ? "Testando…" : "Testar conexão"}
          </TaButton>
        </div>

        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Funil dos cartões">
            <TaSelect
              value={s.pipelineId ?? ""}
              onChange={(e) => void save({ pipelineId: e.target.value || null, stageEntrada: null, stageEnviada: null, stageGanha: null })}
              data-radar-pipeline
            >
              <option value="">Escolha um funil comercial</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </TaSelect>
          </Field>
          {stageSelect("Etapa dos orçamentos novos", "stageEntrada", "Primeira etapa do funil")}
          {stageSelect("Ao enviar a proposta no portal", "stageEnviada", "Não mover")}
          {stageSelect("Ao aprovar no portal", "stageGanha", "Não mover", "Enviada, aprovada, recusada ou cancelada no portal: o cartão fica Pendente (amarelo) e você decide se foi ganho ou perdido.")}
        </div>

        <div className="space-y-2">
          <p className="font-medium text-gray-800 dark:text-white/90">Palavras-chave que viram cartão</p>
          {s.termosRadar.length ? (
            <div className="flex flex-wrap gap-3">
              {s.termosRadar.map((t) => (
                <label key={t} className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={s.termos.includes(t)} onChange={(e) => toggleTermo(t, e.target.checked)} data-radar-termo={t} />
                  {t}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-theme-xs text-gray-500">Teste a conexão para ver as palavras-chave do Radar.</p>
          )}
          <p className="text-theme-xs text-gray-500">
            Nenhuma marcada = todos os orçamentos do Radar. Os descartados no Radar não viram cartão. Se já houver cartão de nome parecido feito à mão, o
            ConectCRM pergunta antes de criar.
          </p>
        </div>

        <Field label="Ao ligar, trazer" hint={INICIO.find((x) => x.value === s.inicio)?.hint}>
          <TaSelect value={s.inicio} onChange={(e) => void save({ inicio: e.target.value as RadarInicio })} data-radar-inicio>
            {INICIO.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </TaSelect>
        </Field>

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
          <TaButton variant={s.active ? "outline" : "primary"} startIcon={<Power size={15} />} disabled={!!busy} onClick={() => void activate(!s.active)} data-radar-active>
            {s.active ? "Desligar integração" : "Ligar integração"}
          </TaButton>
          {s.active && (
            <TaButton variant="outline" startIcon={<RefreshCw size={15} />} disabled={!!busy} onClick={() => void syncNow()} data-radar-sync>
              {busy === "sync" ? "Lendo o Radar…" : "Sincronizar agora"}
            </TaButton>
          )}
          <span className="text-theme-xs text-gray-500">
            {s.active ? "Lido a cada 10 minutos com o Chrome aberto." : "Desligada."}
            {s.lastSyncAt && ` Última leitura: ${formatDateTime(s.lastSyncAt)}.`}
            {resumo && resumo.cartoes > 0 && ` ${resumo.cartoes} cartão(ões) vieram do Radar (${resumo.abertos} em aberto).`}
          </span>
          {s.lastResult?.recebidos != null && (
            <span className="w-full text-theme-xs text-gray-600 dark:text-gray-400" data-radar-resumo-leitura>
              Na última leitura o Radar mandou {s.lastResult.recebidos} orçamento(s): {s.lastResult.comCartao ?? 0} já com cartão, {s.lastResult.created} novo(s)
              {Object.entries(s.lastResult.fora ?? {}).length > 0 &&
                `; ficaram de fora ${Object.entries(s.lastResult.fora ?? {})
                  .map(([m, n]) => `${n} ${RADAR_MOTIVO_TEXTO[m as RadarMotivo]}`)
                  .join(", ")}`}
              .
            </span>
          )}
          {s.lastError && <span className="w-full rounded-lg bg-error-50 px-3 py-2 text-theme-xs text-error-700">Última tentativa: {s.lastError}</span>}
        </div>

        {s.parecidos.length > 0 && (
          <div className="space-y-3 rounded-lg border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-500/40 dark:bg-yellow-500/10" data-radar-parecidos>
            <p className="font-medium text-yellow-900 dark:text-yellow-200">
              {s.parecidos.length} orçamento(s) parecido(s) com cartões que já existem. Prosseguir?
            </p>
            {s.parecidos.map((p) => (
              <div key={p.id} className="space-y-2 rounded-lg bg-white p-3 dark:bg-gray-900" data-radar-parecido={p.id}>
                <p>
                  <b>{p.escola}</b> — {p.municipio}
                  {p.pedido && ` · pedido ${p.pedido}`}
                </p>
                <ul className="list-disc pl-5 text-theme-xs text-gray-600 dark:text-gray-400">
                  {p.cartoes.map((c) => (
                    <li key={c.id}>
                      <b>{c.titulo}</b> ({c.funil} › {c.etapa}) · {c.score}% parecido
                      <button
                        type="button"
                        className="ml-2 text-brand-600 underline disabled:opacity-50"
                        disabled={!!busy}
                        onClick={() => void decidir(p.id, `usar:${c.id}`)}
                      >
                        usar este cartão
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <TaButton size="sm" disabled={!!busy} onClick={() => void decidir(p.id, "criar")}>
                    Prosseguir: criar cartão novo
                  </TaButton>
                  <TaButton size="sm" variant="outline" disabled={!!busy} onClick={() => void decidir(p.id, "ignorar")}>
                    Não criar
                  </TaButton>
                </div>
              </div>
            ))}
          </div>
        )}

        {duplicados.length > 0 && (
          <div className="space-y-3 rounded-lg border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-500/40 dark:bg-yellow-500/10" data-radar-duplicados>
            <p className="font-medium text-yellow-900 dark:text-yellow-200">
              {duplicados.length} cartão(ões) do Radar parecido(s) com cartões que você já tinha. Juntar?
            </p>
            {duplicados.map((d) => (
              <div key={d.dealId} className="space-y-2 rounded-lg bg-white p-3 dark:bg-gray-900" data-radar-duplicado={d.dealId}>
                <p>
                  <b>{d.titulo}</b> <span className="text-theme-xs text-gray-500">({d.funil} › {d.etapa}, criado pelo Radar)</span>
                </p>
                <ul className="space-y-1 text-theme-xs text-gray-600 dark:text-gray-400">
                  {d.cartoes.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      <span>
                        <b>{c.titulo}</b> ({c.funil} › {c.etapa}) · {c.score}% parecido
                      </span>
                      <TaButton size="sm" variant="outline" disabled={!!busy} onClick={() => void resolver(d.dealId, { juntarEm: c.id })}>
                        Juntar neste cartão
                      </TaButton>
                    </li>
                  ))}
                </ul>
                <TaButton size="sm" variant="outline" disabled={!!busy} onClick={() => void resolver(d.dealId, "diferentes")}>
                  São diferentes: manter os dois
                </TaButton>
              </div>
            ))}
          </div>
        )}

        {msg && (
          <p className={msg.kind === "ok" ? "rounded-lg bg-success-50 px-3 py-2 text-success-700" : "rounded-lg bg-error-50 px-3 py-2 text-error-700"} data-radar-msg>
            {msg.text}
          </p>
        )}
      </div>
    </TaPanel>
  );
}
