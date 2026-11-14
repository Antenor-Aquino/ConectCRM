// Emissor Nacional (spec 19, fase 3): ambiente escolhido (produção restrita para
// testar, produção para valer), permissão do site e abertura do assistente.
import type { NfseEnvironment } from "../../db/nfse";
import { PORTAL_BASE, type PortalPayload } from "./portalSteps";

const KEY = "conectcrm-nfse";

export async function loadNfseEnvironment(): Promise<NfseEnvironment> {
  const v = ((await chrome.storage.local.get(KEY))[KEY] as { environment?: NfseEnvironment } | undefined)?.environment;
  return v === "producao" ? "producao" : "producao_restrita";
}

export async function saveNfseEnvironment(environment: NfseEnvironment): Promise<void> {
  await chrome.storage.local.set({ [KEY]: { environment } });
}

const portalOrigins = (env: NfseEnvironment) => [`${new URL(PORTAL_BASE[env]).origin}/*`];

/**
 * Permissão para o assistente entrar no Emissor Nacional do ambiente.
 * O Chrome só aceita o pedido no próprio clique: chame antes de qualquer
 * await ou confirm (já concedida, responde true sem perguntar).
 */
export function requestPortalPermission(env: NfseEnvironment): Promise<boolean> {
  if (!chrome.permissions?.request) return Promise.resolve(true);
  return chrome.permissions.request({ origins: portalOrigins(env) });
}

/** Abre (ou traz para frente) o Emissor Nacional com o painel do ConectCRM. */
export async function openPortalAssistant(payload: PortalPayload): Promise<void> {
  if (chrome.permissions?.contains && !(await chrome.permissions.contains({ origins: portalOrigins(payload.environment) })))
    throw new Error("Sem a permissão de acesso ao Emissor Nacional não dá para abrir o assistente.");
  const r = (await chrome.runtime.sendMessage({ target: "background", kind: "nfse-open", payload })) as { ok: boolean; error?: string } | undefined;
  if (!r?.ok) throw new Error(r?.error ?? "Não foi possível abrir o Emissor Nacional.");
}
