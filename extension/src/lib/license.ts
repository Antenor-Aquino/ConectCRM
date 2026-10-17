// Licença por instalação - mesmo modelo e mesmo servidor do wa-pipedrive
// (referencia/wa-pipedrive/popup.js): validação online ao abrir, tolerância
// offline de 24 h com o último resultado, teste grátis com código pelo
// WhatsApp, planos mensal/anual (Stripe), portal de pagamento, cancelamento
// e upgrade mensal → anual.
//
// As dependências (fetch, armazenamento, relógio) são injetadas para testes.

export const LICENSE_API = "https://extpipe.claudiacrm.com.br";
/** Identifica o produto no servidor (o wa-pipedrive não envia este campo). */
export const PRODUCT = "conectcrm";
export const KEY_PREFIX = "CLAUDIACRM-";
export const DOCS_VERSION = "2026-06-14";
const OFFLINE_TOLERANCE_HOURS = 24;

const STATE_KEY = "conectcrm-license";
const DEVICE_KEY = "conectcrm-device-id";
const TERMS_KEY = "conectcrm-agreed-terms";

export interface LicenseData {
  plano?: string;
  expira_em?: string;
  em_carencia?: boolean;
  [k: string]: unknown;
}

export interface LicenseResult {
  valida: boolean;
  motivo?: string;
  carencia?: boolean;
  dados?: LicenseData | null;
}

interface StoredLicense {
  key?: string;
  valid?: boolean;
  checkedAt?: number;
  data?: LicenseData | null;
}

export interface UpgradePreview {
  ok: boolean;
  motivo?: string;
  valor_mensal?: number;
  valor_anual?: number;
  dias_plano?: number;
  dias_utilizados?: number;
  dias_credito?: number;
  valor_diario?: number;
  credito?: number;
  valor_final?: number;
}

export interface LicenseDeps {
  fetch: typeof fetch;
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  now: () => number;
}

/** Mensagens para cada motivo devolvido pelo servidor (mesmos textos do wa-pipedrive). */
export const LICENSE_REASON: Record<string, string> = {
  sem_chave: "",
  nao_encontrada: "Chave não encontrada. Verifique e tente de novo.",
  expirada: "Sua licença expirou. Renove para continuar usando.",
  cancelada: "Licença cancelada. Assine novamente para reativar.",
  outro_dispositivo: 'Esta licença está ativa em outro computador. Clique em "Ativar licença" para transferi-la para este.',
  limite_ativacoes: 'Limite de dispositivos atingido. Clique em "Ativar licença" para usar neste computador ou fale com o suporte.',
  offline_sem_cache: "Não consegui validar sem conexão. Tente mais tarde.",
};

/** Aceita "CLAUDIACRM-XXXX-XXXX-XXXX", "XXXXXXXXXXXX" ou com traços. */
export function normalizeKey(raw: string): string {
  const text = raw.trim();
  const digits = text.toUpperCase().replace(new RegExp(`^${KEY_PREFIX}`), "").replace(/[^0-9A-F]/g, "");
  if (digits.length === 12) return `${KEY_PREFIX}${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`;
  return text.toUpperCase();
}

/** Máscara do campo: "ABCD-1234-EF56". */
export function formatKeyInput(value: string): string {
  const v = value.toUpperCase().replace(new RegExp(`^${KEY_PREFIX}`), "").replace(/[^0-9A-F]/g, "").slice(0, 12);
  return (v.match(/.{1,4}/g) ?? []).join("-");
}

export function planLabel(data: LicenseData | null | undefined): string {
  if (!data) return "";
  const names: Record<string, string> = { trial: "Teste (7 dias)", mensal: "Mensal", anual: "Anual", dev: "Desenvolvimento" };
  let text = names[data.plano ?? ""] ?? data.plano ?? "";
  if (data.expira_em) {
    const d = new Date(data.expira_em);
    if (!Number.isNaN(d.getTime())) text += ` — expira em ${d.toLocaleDateString("pt-BR")}`;
  }
  return text;
}

export function inGracePeriod(r: LicenseResult): boolean {
  return !!(r.valida && (r.carencia || r.dados?.em_carencia));
}

export class LicenseClient {
  constructor(private deps: LicenseDeps) {}

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.deps.fetch(`${LICENSE_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, produto: PRODUCT }),
    });
    return (await res.json().catch(() => ({}))) as T;
  }

  private async state(): Promise<StoredLicense> {
    return ((await this.deps.storage.get(STATE_KEY)) as StoredLicense | undefined) ?? {};
  }

  private async save(patch: StoredLicense): Promise<void> {
    await this.deps.storage.set(STATE_KEY, { ...(await this.state()), ...patch });
  }

  async savedKey(): Promise<string | null> {
    return (await this.state()).key ?? null;
  }

  async deviceId(): Promise<string> {
    const existing = (await this.deps.storage.get(DEVICE_KEY)) as string | undefined;
    if (existing) return existing;
    const id = `dev-${crypto.randomUUID()}`;
    await this.deps.storage.set(DEVICE_KEY, id);
    return id;
  }

  async termsAccepted(): Promise<boolean> {
    return !!(await this.deps.storage.get(TERMS_KEY));
  }

  async acceptTerms(): Promise<void> {
    await this.deps.storage.set(TERMS_KEY, true);
  }

  /** Valida no servidor sempre; se ele não responder, usa o último resultado por até 24 h. */
  async check(): Promise<LicenseResult> {
    const st = await this.state();
    if (!st.key) return { valida: false, motivo: "sem_chave" };
    try {
      const r = await this.post<LicenseResult>("/validar", { chave: st.key, device_id: await this.deviceId(), dominio: "" });
      await this.save({ valid: !!r.valida, checkedAt: this.deps.now(), data: r.dados ?? null });
      return r;
    } catch {
      const fresh = this.deps.now() - (st.checkedAt ?? 0) < OFFLINE_TOLERANCE_HOURS * 3600_000;
      if (st.valid != null && fresh) return { valida: st.valid, motivo: "offline_cache", dados: st.data };
      return { valida: false, motivo: "offline_sem_cache" };
    }
  }

  /** Ativa a chave NESTE computador (o servidor libera o mais antigo se passar do limite). */
  async activate(rawKey: string): Promise<LicenseResult> {
    const key = normalizeKey(rawKey);
    if (!key) return { valida: false, motivo: "nao_encontrada" };
    const r = await this.post<LicenseResult>("/ativar", { chave: key, device_id: await this.deviceId(), dominio: "" });
    if (r.valida) await this.save({ key, valid: true, checkedAt: this.deps.now(), data: r.dados ?? null });
    else await this.save({ key, checkedAt: 0 });
    return r;
  }

  /** Teste de 7 dias: o servidor envia um código pelo WhatsApp. */
  async startTrial(email: string, phone: string): Promise<{ ok: boolean; erro?: string; mensagem?: string }> {
    return this.post("/trial", { device_id: await this.deviceId(), email, telefone: phone, docsVersao: DOCS_VERSION });
  }

  async resendCode(email: string): Promise<{ ok: boolean; erro?: string }> {
    return this.post("/reenviar-whatsapp", { email });
  }

  /** Confere o código do WhatsApp e, se válido, ativa a chave devolvida. */
  async validateCode(email: string, code: string): Promise<{ ok: boolean; erro?: string; result?: LicenseResult }> {
    const r = await this.post<{ ok: boolean; erro?: string; chave?: string }>("/validar-otp", { email, codigo: code.replace(/\D/g, "") });
    if (!r.ok || !r.chave) return { ok: false, erro: r.erro };
    return { ok: true, result: await this.activate(r.chave) };
  }

  async checkoutUrl(plan: "mensal" | "anual"): Promise<string> {
    const r = await this.post<{ url?: string; erro?: string }>("/checkout", { plano: plan });
    if (!r.url) throw new Error(r.erro || "Não foi possível abrir o pagamento.");
    return r.url;
  }

  async billingPortalUrl(): Promise<string> {
    const r = await this.post<{ url?: string }>("/portal", { chave: await this.savedKey() });
    if (!r.url) throw new Error("Não foi possível abrir o portal de pagamento agora.");
    return r.url;
  }

  async cancelReasons(): Promise<{ id: string; texto: string; tipo: string }[]> {
    const res = await this.deps.fetch(`${LICENSE_API}/motivos-cancelamento`);
    const r = (await res.json()) as { motivos?: { id: string; texto: string; tipo: string }[] };
    return r.motivos ?? [];
  }

  async cancel(reasonId: string, reasonText: string): Promise<{ ok: boolean; reembolso?: boolean; erro?: string }> {
    const key = await this.savedKey();
    if (!key) return { ok: false, erro: "sem_chave" };
    return this.post("/cancelar", { chave: key, motivoId: reasonId, motivoTexto: reasonText });
  }

  async upgradePreview(): Promise<UpgradePreview> {
    return this.post("/upgrade-preview", { chave: await this.savedKey() });
  }

  async upgradeCheckoutUrl(): Promise<string> {
    const r = await this.post<{ url?: string; erro?: string }>("/upgrade-checkout", { chave: await this.savedKey() });
    if (!r.url) throw new Error(r.erro || "Não foi possível iniciar o upgrade agora.");
    return r.url;
  }
}

/** Cliente com o armazenamento da extensão. */
export function extensionLicenseClient(): LicenseClient {
  return new LicenseClient({
    fetch: (...a) => fetch(...a),
    storage: {
      get: async (key) => (await chrome.storage.local.get(key))[key],
      set: (key, value) => chrome.storage.local.set({ [key]: value }),
    },
    now: () => Date.now(),
  });
}

/** Preços exibidos nos botões de plano. Valores do wa-pipedrive - confirmar
 * os do ConectCRM (o checkout cobra o que estiver configurado no servidor). */
export const PLAN_PRICES = {
  mensal: { price: "R$ 17,65/mês", note: "Renovação automática" },
  anual: { price: "R$ 180,00/ano", note: "15% de desconto" },
} as const;
