// Protocolo entre ConectCRM e Gestão Financeira (mensagens entre extensões,
// chrome.runtime.sendMessage(idDaOutra, ...)). O MESMO arquivo existe nos
// dois repositórios: ao mudar aqui, copie para o outro e suba PROTOCOL.
//
// Segurança: nenhuma das duas aceita mensagem de quem não foi pareado. O
// pareamento começa no ConectCRM ("hello") e só vale depois que o usuário
// clica em Permitir na Gestão Financeira.
export const PROTOCOL = 1;

export type IntegrationRequest =
  /** ConectCRM pede para se conectar (ou confere se já está conectado). */
  | { type: "hello"; app: "conectcrm"; appName: string; appVersion: string; protocol: number }
  /** Teste de conexão. */
  | { type: "ping"; protocol: number };

export type GfEnv = "production" | "demo";

export type IntegrationResponse =
  | { ok: true; status: "paired"; app: "gestao-financeira"; version: string; protocol: number; env: GfEnv }
  | { ok: true; status: "pending" | "refused" }
  | { ok: false; error: "not-paired" | "invalid" | "protocol"; message?: string };

export function isIntegrationRequest(v: unknown): v is IntegrationRequest {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  if (m.type === "ping") return typeof m.protocol === "number";
  if (m.type === "hello") return m.app === "conectcrm" && typeof m.appVersion === "string" && typeof m.protocol === "number";
  return false;
}
