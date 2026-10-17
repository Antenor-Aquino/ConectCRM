// Formatação pt-BR usada nas telas.
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCents(cents: number): string {
  return BRL.format(cents / 100);
}

/** "1.234,56" / "R$ 1.234,56" → 123456 centavos (null se vazio/inválido). */
export function parseMoneyToCents(text: string): number | null {
  const clean = text.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function initials(name: string | null | undefined): string {
  // Só palavras com letra ou número: "Gustavo (gestor)" vira "GG", não "G(".
  const parts = (name ?? "").trim().split(/\s+/).map((p) => p.replace(/^[^\p{L}\p{N}]+/u, "")).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]![0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "")).toUpperCase();
}

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** dd/mm/aaaa hh:mm no fuso local. */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? DATE_TIME.format(new Date(iso)).replace(",", "") : "";
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? DATE.format(new Date(iso)) : "";
}

/** ISO → "aaaa-mm-dd" local (para <input type="date">). */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "aaaa-mm-dd" local → ISO ao meio-dia local (evita virar o dia em outro fuso). */
export function fromDateInput(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12, 0, 0).toISOString();
}

export const STAGE_DOT_FALLBACK = "#98A2B3";

/** "+5511999998888" → "(11) 99999-8888" quando for Brasil; senão devolve como está. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
