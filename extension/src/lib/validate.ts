// Validações e normalizações compartilhadas pelos cadastros.

/** Erro de regra de negócio - a mensagem é mostrada ao usuário. */
export class ValidationError extends Error {}

export function requireText(value: string | null | undefined, message: string): string {
  const v = (value ?? "").trim();
  if (!v) throw new ValidationError(message);
  return v;
}

export function optionalText(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const v = optionalText(value)?.toLowerCase() ?? null;
  if (v && !isValidEmail(v)) throw new ValidationError(`E-mail inválido: ${v}`);
  return v;
}

const DIAL_CODES: Record<string, string> = { BR: "55", PT: "351", US: "1", AR: "54", PY: "595", UY: "598", CL: "56", ES: "34" };

/** Telefone em E.164 (`+5511999998888`), formato usado para casar com o WhatsApp.
 * Aceita número com ou sem código do país; sem "+", usa o país informado. */
export function normalizePhone(value: string | null | undefined, country = "BR"): string | null {
  const raw = optionalText(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const dial = DIAL_CODES[country] ?? "";
  let full: string;
  if (raw.startsWith("+")) full = digits;
  else if (digits.startsWith("00")) full = digits.slice(2);
  else if (dial && digits.startsWith(dial) && digits.length > 11) full = digits;
  else full = dial + digits.replace(/^0+/, "");
  // Só o código do país (campo "+55" sem número) conta como vazio.
  if (full === dial) return null;
  if (full.length < 8 || full.length > 15) throw new ValidationError(`Telefone inválido: ${raw}`);
  return `+${full}`;
}

export function cnpjDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Dígitos verificadores do CNPJ (mesma regra do wa-pipedrive). */
export function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calcDigit = (base: string) => {
    const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base.split("").reduce((acc, d, i) => acc + Number(d) * weights[i]!, 0);
    const rest = sum % 11;
    return rest < 2 ? "0" : String(11 - rest);
  };
  const d1 = calcDigit(cnpj.slice(0, 12));
  const d2 = calcDigit(cnpj.slice(0, 12) + d1);
  return cnpj.endsWith(d1 + d2);
}

export function normalizeCnpj(value: string | null | undefined): string | null {
  const digits = cnpjDigits(value);
  if (!digits) return null;
  if (!isValidCnpj(digits)) throw new ValidationError("CNPJ inválido.");
  return digits;
}

/** Dígitos verificadores do CPF. */
export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (base: string) => {
    const sum = base.split("").reduce((acc, d, i) => acc + Number(d) * (base.length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return String(rest === 10 ? 0 : rest);
  };
  const d1 = digit(cpf.slice(0, 9));
  return cpf.endsWith(d1 + digit(cpf.slice(0, 9) + d1));
}

export function normalizeCpf(value: string | null | undefined): string | null {
  const digits = cnpjDigits(value);
  if (!digits) return null;
  if (!isValidCpf(digits)) throw new ValidationError("CPF inválido.");
  return digits;
}

/** Chave reservada do campo personalizado: "Data de nascimento" → "data_de_nascimento". */
export function placeholderKeyFromName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isValidPlaceholderKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{0,59}$/.test(key);
}

export function normalizeIsoDate(value: string | null | undefined, label: string): string | null {
  const v = optionalText(value);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${label}: data inválida.`);
  return d.toISOString();
}

export function normalizeCents(value: number | null | undefined, label: string): number {
  const v = value ?? 0;
  if (!Number.isInteger(v) || v < 0) throw new ValidationError(`${label}: valor inválido.`);
  return v;
}

/** Sem repetir (sem diferenciar maiúsculas), mantendo a primeira grafia. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names.map((x) => x.trim()).filter(Boolean)) {
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}
