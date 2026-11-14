// Dados da nota organizados como no Emissor Nacional web (spec 19, fase 3):
// etapas Pessoas → Serviço → Valores, com os rótulos dos campos conforme o
// Guia do Emissor Público Nacional Web v1.3 (gov.br). O assistente no portal
// usa os rótulos para achar cada campo; o que não achar fica com "Copiar".
import type { NfseDraft, NfseEnvironment } from "../../db/nfse";
import { formatNbs, formatTribNac, municipioPorIbge, nbs, servicoNacional } from "./tabelas";

export type PortalStep = "pessoas" | "servico" | "valores";
export type PortalFieldKind = "text" | "combo" | "choice" | "copy";

export interface PortalField {
  id: string;
  step: PortalStep;
  /** Bloco da tela onde o campo fica (ex.: "Tomador"); evita confundir com o do prestador. */
  section?: string;
  /** Rótulos aceitos (o primeiro que existir na tela). */
  labels: string[];
  /** O que vai no campo. */
  value: string;
  /** Como aparece no painel. */
  title: string;
  /** text: digita; combo: digita e escolhe a sugestão; choice: marca a opção com este texto; copy: só copiar. */
  kind: PortalFieldKind;
}

export interface PortalPayload {
  cardId: string;
  environment: NfseEnvironment;
  issuer: { cnpj: string; name: string };
  /** CNPJ das outras empresas cadastradas (para avisar se o portal estiver logado nelas). */
  otherCnpjs: string[];
  fields: PortalField[];
  /** O que o usuário confere/preenche no portal (o CRM não sabe). */
  reminders: string[];
}

export const PORTAL_BASE: Record<NfseEnvironment, string> = {
  producao: "https://www.nfse.gov.br/EmissorNacional",
  producao_restrita: "https://www.producaorestrita.nfse.gov.br/EmissorNacional",
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Campos da nota para o assistente do portal. */
export function buildPortalPayload(d: NfseDraft, environment: NfseEnvironment, allIssuerCnpjs: string[]): PortalPayload {
  if (!d.issuer) throw new Error("Escolha a empresa emissora.");
  const t = d.taker;
  const f: PortalField[] = [];
  const add = (x: Omit<PortalField, "id">) => {
    if (x.value) f.push({ id: `${x.step}-${f.length}`, ...x });
  };
  const [y, m, dd] = d.competence.split("-");

  // Pessoas
  add({ step: "pessoas", labels: ["Data de Competência"], value: `${dd}/${m}/${y}`, title: "Data de competência", kind: "text" });
  if (t.kind) {
    add({ step: "pessoas", section: "Tomador", labels: ["Brasil"], value: "Brasil", title: "Tomador no Brasil", kind: "choice" });
    add({ step: "pessoas", section: "Tomador", labels: ["CPF/CNPJ", "CNPJ/CPF"], value: digits(t.document), title: t.kind === "organization" ? "CNPJ do tomador" : "CPF do tomador", kind: "text" });
    add({ step: "pessoas", section: "Tomador", labels: ["Nome/Razão Social", "Nome / Razão Social", "Nome"], value: t.name ?? "", title: "Nome / razão social", kind: "text" });
    if (t.address) {
      add({ step: "pessoas", section: "Tomador", labels: ["CEP"], value: digits(t.address.cep), title: "CEP", kind: "text" });
      add({ step: "pessoas", section: "Tomador", labels: ["Logradouro"], value: t.address.street ?? "", title: "Logradouro", kind: "text" });
      add({ step: "pessoas", section: "Tomador", labels: ["Número"], value: t.address.number ?? "", title: "Número", kind: "text" });
      add({ step: "pessoas", section: "Tomador", labels: ["Complemento"], value: t.address.complement ?? "", title: "Complemento", kind: "text" });
      add({ step: "pessoas", section: "Tomador", labels: ["Bairro"], value: t.address.district ?? "", title: "Bairro", kind: "text" });
      const mun = municipioPorIbge(t.address.cityIbge);
      add({ step: "pessoas", section: "Tomador", labels: ["Município"], value: mun ? `${mun.nome}/${mun.uf}` : "", title: "Município do tomador", kind: "copy" });
    }
    add({ step: "pessoas", section: "Tomador", labels: ["E-mail", "Email"], value: t.email ?? "", title: "E-mail do tomador", kind: "text" });
  }

  // Serviço (uma nota por código: usa o primeiro serviço; os demais viram aviso no CRM)
  const s = d.services[0];
  const place = municipioPorIbge(d.placeIbge);
  add({ step: "servico", section: "Local", labels: ["Município"], value: place ? place.nome : "", title: `Local da prestação${place ? ` (${place.nome}/${place.uf})` : ""}`, kind: "combo" });
  if (s?.tribNac) {
    const sv = servicoNacional(s.tribNac);
    add({ step: "servico", labels: ["Código de Tributação Nacional", "Códido de Tributação Nacional", "Código de Tributação"], value: formatTribNac(s.tribNac), title: `Código de tributação: ${formatTribNac(s.tribNac)}${sv ? ` — ${sv.descricao}` : ""}`, kind: "combo" });
  }
  if (s?.nbs) add({ step: "servico", labels: ["Item da NBS", "NBS"], value: formatNbs(s.nbs), title: `NBS ${formatNbs(s.nbs)}${nbs(s.nbs) ? ` — ${nbs(s.nbs)!.descricao}` : ""}`, kind: "combo" });
  add({ step: "servico", labels: ["Descrição do Serviço"], value: d.texts.description, title: "Descrição do serviço (discriminação)", kind: "text" });
  add({ step: "servico", labels: ["Informações Complementares"], value: d.texts.notes, title: "Informações complementares (observação)", kind: "text" });
  add({ step: "servico", labels: ["Número do Pedido", "Número do Pedido, Ordem de Compra"], value: d.texts.orderNumber, title: "Nº do pedido / ordem de compra", kind: "text" });

  // Valores
  const total = d.services.reduce((n, x) => n + x.valueCents, 0);
  add({ step: "valores", labels: ["Valor da operação/serviço prestado", "Valor do serviço prestado", "Valor do Serviço", "Valor da operação"], value: brl(total), title: `Valor do serviço: R$ ${brl(total)}`, kind: "text" });

  const reminders = [
    "Confira o município do tomador (o portal busca pelo CEP).",
    "Retenção do ISSQN: o padrão do CRM é “não retido”; marque no portal se o cliente retém.",
    "Valor aproximado dos tributos / alíquota do Simples Nacional: confira no passo Valores.",
  ];
  if (d.services.length > 1) reminders.unshift(`Esta nota leva só o 1º código de serviço (${formatTribNac(d.services[0]!.tribNac ?? "")}); os demais precisam de outra nota.`);
  return {
    cardId: d.cardId,
    environment,
    issuer: { cnpj: d.issuer.cnpj, name: d.issuer.legal_name },
    otherCnpjs: allIssuerCnpjs.filter((c) => c !== d.issuer!.cnpj),
    fields: f,
    reminders,
  };
}
