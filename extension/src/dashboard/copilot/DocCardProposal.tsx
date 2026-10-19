// Copiloto: cartão a partir de um documento (spec 12). Aqui ficam a análise
// (ler → IA → conferir o que já existe no CRM) e a confirmação: o usuário vê
// os dados identificados, corrige o que precisar, escolhe o funil e a etapa e
// só então o CRM grava (organização, contato, tags, cartão, documento no GED
// e a origem no histórico).
import { useEffect, useState } from "react";
import { AlertTriangle, Building2, Check, ChevronDown, ExternalLink, FileText, Plus, Sparkles, Tag, User, X } from "lucide-react";
import { TaButton, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { AI_LABELS, AI_READS_IMAGES, type AiSettings } from "../../lib/ai";
import { proposeFromDocument, type CrmStructureLite, type DocProposal } from "../../lib/copilot/docExtract";
import { readDocument } from "../../lib/copilot/docRead";
import { prepareFile, saveContent } from "../../lib/documentFiles";
import { errorText } from "../../lib/errors";
import { formatBytes } from "../../lib/files";
import { formatCents, parseMoneyToCents } from "../../lib/format";
import { cnpjDigits } from "../../lib/validate";
import { formatCnpj } from "../../lib/cnpj";

type Match = { id: string; name: string; why: string } | null;

export interface DocAnalysis {
  file: File;
  provider: string;
  kind: string;
  truncated: boolean;
  usedImages: number;
  proposal: DocProposal;
  structure: CrmStructureLite;
  gedTypes: { id: string; name: string }[];
  orgMatch: Match;
  personMatch: Match;
}

const KIND_BY_TYPE: Record<string, "deal" | "ticket" | "project"> = { comercial: "deal", operacional: "ticket", projeto: "project" };

/** Lê o documento, pede os dados à IA e procura no CRM o que já existe. */
export async function analyzeDocument(settings: AiSettings, file: File, instruction: string, onStep: (text: string) => void): Promise<DocAnalysis> {
  const provider = AI_LABELS[settings.provider];
  onStep("Lendo o documento…");
  const read = await readDocument(file, AI_READS_IMAGES.includes(settings.provider));
  if (!read.text.trim() && !read.images.length) throw new Error("Não encontrei texto neste documento.");
  const [structure, types, tags] = await Promise.all([
    call("copilot.structure") as Promise<CrmStructureLite>,
    call("documentTypes.list", {}),
    call("tags.list", { entity: "deal" }),
  ]);
  const gedTypes = types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }));
  onStep(`Identificando os dados com a IA (${provider})…`);
  const proposal = await proposeFromDocument(
    settings,
    read,
    file.name,
    instruction,
    structure,
    tags.map((t) => t.name),
    gedTypes.map((t) => t.name),
  );
  onStep("Conferindo o que já existe no CRM…");
  let orgMatch: Match = null;
  const o = proposal.organizacao;
  if (o?.cnpj) {
    const dup = await call("organizations.findByCnpj", { cnpj: o.cnpj });
    if (dup) orgMatch = { id: dup.id, name: dup.name, why: "mesmo CNPJ" };
  }
  if (!orgMatch && o?.nome) {
    const sim = (await call("similar.organizations", { name: o.nome }))[0];
    if (sim && sim.score >= 85) orgMatch = { id: sim.id, name: sim.name, why: `nome parecido (${sim.score}%)` };
  }
  let personMatch: Match = null;
  const c = proposal.contato;
  if (c?.telefone) {
    const dup = (await call("persons.findByPhone", { phone: c.telefone }).catch(() => []))[0];
    if (dup) personMatch = { id: dup.id, name: dup.name, why: "mesmo telefone" };
  }
  if (!personMatch && c?.nome) {
    const sim = (await call("similar.persons", { name: c.nome }))[0];
    if (sim && sim.score >= 90) personMatch = { id: sim.id, name: sim.name, why: `nome parecido (${sim.score}%)` };
  }
  return { file, provider, kind: read.kind, truncated: read.truncated, usedImages: read.images.length, proposal, structure, gedTypes, orgMatch, personMatch };
}

/** Como a análise volta para o histórico da conversa (a IA sabe o que aconteceu). */
export function analysisToHistory(a: DocAnalysis, created: boolean): string {
  return `Li o documento "${a.file.name}" (${a.proposal.tipoDocumento}) e preparei o cartão "${a.proposal.cartao.titulo}" para o usuário confirmar${created ? "; ele confirmou e o cartão foi criado" : ""}.`;
}

const input =
  "h-9 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-theme-sm text-gray-800 focus:border-brand-300 focus:outline-none focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90";

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-theme-xs text-gray-500">{label}</span>
      {children}
    </label>
  );
}

type Mode = "new" | "existing" | "none";

function ModePick({ mode, onChange, match, noun }: { mode: Mode; onChange: (m: Mode) => void; match: Match; noun: "a organização" | "o contato" }) {
  const opts: { v: Mode; label: string }[] = [
    ...(match ? [{ v: "existing" as Mode, label: `Vincular a ${match.name}` }] : []),
    { v: "new", label: match ? "Criar nova" : "Criar" },
    { v: "none", label: "Não vincular" },
  ];
  return (
    <div className="mb-2">
      {match && (
        <p className="mb-1.5 text-theme-xs text-warning-700">
          Já existe no CRM: <b>{match.name}</b> ({match.why}).
        </p>
      )}
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`O que fazer com ${noun}`}>
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-theme-xs",
              mode === o.v ? "border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-500/15" : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DocCardProposalView({
  analysis,
  disabled,
  onCreated,
  onOpenCard,
}: {
  analysis: DocAnalysis;
  disabled?: boolean;
  onCreated: (cardId: string) => void;
  onOpenCard: (cardId: string) => void;
}) {
  const { proposal: p, structure, gedTypes } = analysis;
  const [org, setOrg] = useState(() => ({ ...(p.organizacao ?? { nome: "", razaoSocial: "", cnpj: "", email: "", telefone: "", endereco: "", cidade: "", uf: "" }) }));
  const [orgMode, setOrgMode] = useState<Mode>(analysis.orgMatch ? "existing" : p.organizacao ? "new" : "none");
  const [person, setPerson] = useState(() => ({ ...(p.contato ?? { nome: "", cargo: "", email: "", telefone: "" }) }));
  const [personMode, setPersonMode] = useState<Mode>(analysis.personMatch ? "existing" : p.contato ? "new" : "none");
  const [title, setTitle] = useState(p.cartao.titulo);
  const [value, setValue] = useState(p.cartao.valor ? formatCents(Math.round(p.cartao.valor * 100)) : "");
  const [due, setDue] = useState(p.cartao.prazo);
  const [description, setDescription] = useState(p.resumo);
  const [tags, setTags] = useState<string[]>(p.tags);
  const [newTag, setNewTag] = useState("");
  const [docName, setDocName] = useState(p.documento.nome);
  const [docType, setDocType] = useState(gedTypes.find((t) => t.name === p.documento.tipoGed)?.id ?? "");
  // Onde criar: o usuário escolhe (a sugestão da IA é só um atalho).
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [showEvidence, setShowEvidence] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "done" | "cancelled">("idle");
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const funil = structure.funis.find((f) => f.id === pipelineId);
  const suggestion = p.destino ? structure.funis.find((f) => f.id === p.destino!.funilId) : null;
  const suggestionStage = suggestion?.etapas.find((e) => e.id === p.destino!.etapaId);
  useEffect(() => {
    const kind = KIND_BY_TYPE[funil?.tipo ?? "comercial"] ?? "deal";
    void call("tags.list", { entity: kind, includeInactive: true }).then((t) => setExistingTags(t.map((x) => x.name.toLowerCase())));
  }, [funil?.tipo]);

  const choose = (fid: string, sid?: string) => {
    setPipelineId(fid);
    const f = structure.funis.find((x) => x.id === fid);
    setStageId(sid ?? f?.etapas[0]?.id ?? "");
  };

  const create = async () => {
    if (!pipelineId || !stageId) return setError("Escolha o funil e a etapa onde o cartão será criado.");
    if (!title.trim()) return setError("Informe o título do cartão.");
    if (orgMode === "new" && !org.nome.trim()) return setError("Informe o nome da organização (ou escolha Não vincular).");
    if (personMode === "new" && !person.nome.trim()) return setError("Informe o nome do contato (ou escolha Não vincular).");
    const cents = value.trim() ? parseMoneyToCents(value) : null;
    if (value.trim() && cents === null) return setError("Valor inválido.");
    setError(null);
    setState("saving");
    try {
      const prepared = await prepareFile(analysis.file);
      const file = await saveContent(prepared, docName.trim() || analysis.file.name);
      const r = await call("copilot.createFromDocument", {
        pipelineId,
        stageId,
        title: title.trim(),
        description: description.trim() || null,
        valueCents: cents,
        expectedCloseAt: due ? new Date(`${due}T12:00:00`).toISOString() : null,
        organization:
          orgMode === "existing" && analysis.orgMatch
            ? { id: analysis.orgMatch.id }
            : orgMode === "new"
              ? {
                  create: {
                    name: org.nome.trim(),
                    legalName: org.razaoSocial.trim() || null,
                    cnpj: org.cnpj ? cnpjDigits(org.cnpj) : null,
                    email: org.email.trim() || null,
                    phone: org.telefone.trim() || null,
                    street: org.endereco.trim() || null,
                    city: org.cidade.trim() || null,
                    state: org.uf.trim() || null,
                  },
                }
              : null,
        person:
          personMode === "existing" && analysis.personMatch
            ? { id: analysis.personMatch.id }
            : personMode === "new"
              ? { create: { name: person.nome.trim(), email: person.email.trim() || null, phone: person.telefone.trim() || null, notes: person.cargo.trim() ? `Cargo: ${person.cargo.trim()}` : null } }
              : null,
        tags,
        document: { name: docName.trim() || analysis.file.name, typeId: docType || null, description: `Enviado ao Copiloto para criar o cartão "${title.trim()}".`, file },
        source: { fileName: analysis.file.name, docType: p.tipoDocumento, provider: analysis.provider },
      });
      setCreatedId(r.cardId);
      setState("done");
      onCreated(r.cardId);
    } catch (e) {
      setError(errorText(e));
      setState("idle");
    }
  };

  if (state === "cancelled")
    return <p className="text-theme-sm italic text-gray-500">Criação do cartão cancelada. Nada foi gravado.</p>;

  if (state === "done" && createdId)
    return (
      <div className="rounded-2xl border border-success-200 bg-success-50/60 p-4 dark:border-success-500/30 dark:bg-success-500/10" data-doc-created>
        <p className="flex items-center gap-2 text-theme-sm font-semibold text-success-800 dark:text-success-400">
          <Check size={16} /> Cartão criado em {funil?.nome} › {funil?.etapas.find((e) => e.id === stageId)?.nome}
        </p>
        <ul className="mt-2 space-y-0.5 text-theme-xs text-gray-700 dark:text-gray-300">
          <li>• {title}</li>
          {orgMode !== "none" && <li>• Organização: {orgMode === "existing" ? `${analysis.orgMatch?.name} (existente)` : `${org.nome} (nova)`}</li>}
          {personMode !== "none" && <li>• Contato: {personMode === "existing" ? `${analysis.personMatch?.name} (existente)` : `${person.nome} (novo)`}</li>}
          {tags.length > 0 && <li>• Tags: {tags.join(", ")}</li>}
          <li>• Documento salvo no GED: {docName}</li>
          <li>• A origem ficou registrada no histórico do cartão.</li>
        </ul>
        <TaButton size="sm" className="mt-3" startIcon={<ExternalLink size={14} />} onClick={() => onOpenCard(createdId)}>
          Abrir cartão
        </TaButton>
      </div>
    );

  const busy = disabled || state === "saving";
  const isNewTag = (t: string) => !existingTags.includes(t.toLowerCase());

  return (
    <div className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800" data-doc-proposal>
      <div className="mb-3 flex items-start gap-2">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-brand-500" />
        <div className="min-w-0">
          <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
            Identifiquei um(a) {p.tipoDocumento.toLowerCase()} em "{analysis.file.name}"
          </p>
          <p className="text-theme-xs text-gray-500">
            {analysis.kind} · {formatBytes(analysis.file.size)}
            {analysis.usedImages ? ` · ${analysis.usedImages} imagem(ns) lida(s) pela IA` : ""}
            {analysis.truncated ? " · documento longo: li só o começo" : ""}. Confira e corrija antes de criar.
          </p>
        </div>
      </div>

      {p.avisos.length > 0 && (
        <ul className="mb-3 space-y-0.5 rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-800 dark:bg-warning-500/10 dark:text-warning-400">
          {p.avisos.map((a) => (
            <li key={a} className="flex gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {a}
            </li>
          ))}
        </ul>
      )}

      <section className="mb-3 rounded-xl bg-brand-25 p-3 dark:bg-brand-500/10" data-doc-destino>
        <p className="mb-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">Onde devo criar o cartão?</p>
        {suggestion && suggestionStage && pipelineId !== suggestion.id && (
          <button
            type="button"
            onClick={() => choose(suggestion.id, suggestionStage.id)}
            className="mb-2 rounded-full border border-brand-300 bg-white px-2.5 py-1 text-theme-xs text-brand-700 hover:bg-brand-50 dark:bg-gray-900"
            title={p.destino?.motivo || undefined}
          >
            Sugestão: {suggestion.nome} › {suggestionStage.nome}
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <select className={input} aria-label="Funil" value={pipelineId} onChange={(e) => choose(e.target.value)} disabled={busy}>
            <option value="">Escolha o funil…</option>
            {structure.funis.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
          <select className={input} aria-label="Etapa" value={stageId} onChange={(e) => setStageId(e.target.value)} disabled={busy || !funil}>
            {!funil && <option value="">Etapa</option>}
            {funil?.etapas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mb-3">
        <p className="mb-2 flex items-center gap-1.5 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">
          <FileText size={13} /> Cartão
        </p>
        <Line label="Título">
          <input className={input} aria-label="Título do cartão" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        </Line>
        <div className="grid grid-cols-2 gap-2">
          <Line label="Valor">
            <input className={input} aria-label="Valor" placeholder="Não informado" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
          </Line>
          <Line label="Previsão / prazo">
            <input type="date" className={input} aria-label="Prazo" value={due} onChange={(e) => setDue(e.target.value)} disabled={busy} />
          </Line>
        </div>
        <Line label="Descrição">
          <textarea
            rows={3}
            className={cn(input, "h-auto py-2")}
            aria-label="Descrição do cartão"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
        </Line>
      </section>

      <section className="mb-3" data-doc-org>
        <p className="mb-2 flex items-center gap-1.5 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">
          <Building2 size={13} /> Organização
        </p>
        <ModePick mode={orgMode} onChange={setOrgMode} match={analysis.orgMatch} noun="a organização" />
        {orgMode === "new" && (
          <>
            <Line label="Nome">
              <input className={input} aria-label="Nome da organização" value={org.nome} onChange={(e) => setOrg({ ...org, nome: e.target.value })} disabled={busy} />
            </Line>
            <div className="grid grid-cols-2 gap-2">
              <Line label="CNPJ">
                <input
                  className={input}
                  aria-label="CNPJ"
                  placeholder="Não informado"
                  value={org.cnpj ? formatCnpj(org.cnpj) : ""}
                  onChange={(e) => setOrg({ ...org, cnpj: e.target.value })}
                  disabled={busy}
                />
              </Line>
              <Line label="Telefone">
                <input className={input} aria-label="Telefone da organização" value={org.telefone} onChange={(e) => setOrg({ ...org, telefone: e.target.value })} disabled={busy} />
              </Line>
              <Line label="Cidade">
                <input className={input} aria-label="Cidade" value={org.cidade} onChange={(e) => setOrg({ ...org, cidade: e.target.value })} disabled={busy} />
              </Line>
              <Line label="UF">
                <input className={input} aria-label="UF" maxLength={2} value={org.uf} onChange={(e) => setOrg({ ...org, uf: e.target.value.toUpperCase() })} disabled={busy} />
              </Line>
            </div>
            {(org.endereco || org.email) && (
              <div className="grid grid-cols-2 gap-2">
                <Line label="Endereço">
                  <input className={input} aria-label="Endereço" value={org.endereco} onChange={(e) => setOrg({ ...org, endereco: e.target.value })} disabled={busy} />
                </Line>
                <Line label="E-mail">
                  <input className={input} aria-label="E-mail da organização" value={org.email} onChange={(e) => setOrg({ ...org, email: e.target.value })} disabled={busy} />
                </Line>
              </div>
            )}
          </>
        )}
      </section>

      <section className="mb-3" data-doc-person>
        <p className="mb-2 flex items-center gap-1.5 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">
          <User size={13} /> Contato
        </p>
        {!p.contato && !analysis.personMatch && personMode === "none" ? (
          <p className="text-theme-xs text-gray-500">
            O documento não traz uma pessoa de contato.{" "}
            <button type="button" className="text-brand-600 hover:underline" onClick={() => setPersonMode("new")}>
              Informar contato
            </button>
          </p>
        ) : (
          <>
            <ModePick mode={personMode} onChange={setPersonMode} match={analysis.personMatch} noun="o contato" />
            {personMode === "new" && (
              <div className="grid grid-cols-2 gap-2">
                <Line label="Nome">
                  <input className={input} aria-label="Nome do contato" value={person.nome} onChange={(e) => setPerson({ ...person, nome: e.target.value })} disabled={busy} />
                </Line>
                <Line label="Cargo">
                  <input className={input} aria-label="Cargo" value={person.cargo} onChange={(e) => setPerson({ ...person, cargo: e.target.value })} disabled={busy} />
                </Line>
                <Line label="Telefone">
                  <input className={input} aria-label="Telefone do contato" value={person.telefone} onChange={(e) => setPerson({ ...person, telefone: e.target.value })} disabled={busy} />
                </Line>
                <Line label="E-mail">
                  <input className={input} aria-label="E-mail do contato" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} disabled={busy} />
                </Line>
              </div>
            )}
          </>
        )}
      </section>

      <section className="mb-3" data-doc-tags>
        <p className="mb-2 flex items-center gap-1.5 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">
          <Tag size={13} /> Tags
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-theme-xs text-gray-700 dark:bg-white/10 dark:text-gray-300">
              {t}
              {isNewTag(t) && <span className="text-brand-600">· nova</span>}
              <button type="button" aria-label={`Tirar ${t}`} disabled={busy} onClick={() => setTags(tags.filter((x) => x !== t))} className="text-gray-400 hover:text-error-600">
                <X size={11} />
              </button>
            </span>
          ))}
          <form
            className="inline-flex"
            onSubmit={(e) => {
              e.preventDefault();
              const t = newTag.trim();
              if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tags, t]);
              setNewTag("");
            }}
          >
            <input
              className="h-7 w-28 rounded-full border border-dashed border-gray-300 bg-transparent px-2.5 text-theme-xs dark:border-gray-700"
              placeholder="+ tag"
              aria-label="Nova tag"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="sr-only">
              <Plus size={12} />
            </button>
          </form>
        </div>
      </section>

      <section className="mb-3">
        <p className="mb-2 flex items-center gap-1.5 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">
          <FileText size={13} /> Documento no GED
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input className={input} aria-label="Nome do documento" value={docName} onChange={(e) => setDocName(e.target.value)} disabled={busy} />
          <select className={cn(input, "w-40")} aria-label="Tipo do documento" value={docType} onChange={(e) => setDocType(e.target.value)} disabled={busy}>
            <option value="">Outros</option>
            {gedTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1 text-theme-xs text-gray-500">O arquivo original fica no GED, vinculado ao cartão, à organização e ao contato.</p>
      </section>

      {p.evidencias.length > 0 && (
        <div className="mb-3">
          <button type="button" className="flex items-center gap-1 text-theme-xs text-gray-500 hover:text-gray-800" onClick={() => setShowEvidence(!showEvidence)}>
            <ChevronDown size={13} className={cn("transition", showEvidence && "rotate-180")} /> De onde tirei cada dado
          </button>
          {showEvidence && (
            <ul className="mt-1.5 space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-theme-xs text-gray-600 dark:bg-white/5 dark:text-gray-400" data-doc-evidence>
              {p.evidencias.map((e, i) => (
                <li key={i}>
                  <b className="text-gray-700 dark:text-gray-300">{e.campo}</b>: “{e.trecho}”
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <TaButton size="sm" disabled={busy} onClick={() => setState("cancelled")}>
          Cancelar
        </TaButton>
        <TaButton size="sm" variant="primary" startIcon={<Check size={14} />} disabled={busy || !pipelineId || !stageId} onClick={() => void create()}>
          {state === "saving" ? "Criando…" : "Confirmar e criar cartão"}
        </TaButton>
      </div>
    </div>
  );
}
