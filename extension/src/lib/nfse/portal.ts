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

/** Permissão para o assistente entrar nas páginas do Emissor Nacional do ambiente (pedida no 1º uso). */
export async function requestPortalPermission(env: NfseEnvironment): Promise<boolean> {
  if (!chrome.permissions?.request) return true;
  const origins = [`${new URL(PORTAL_BASE[env]).origin}/*`];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

/** Abre (ou traz para frente) o Emissor Nacional com o painel do ConectCRM. */
export async function openPortalAssistant(payload: PortalPayload): Promise<void> {
  if (!(await requestPortalPermission(payload.environment))) throw new Error("Sem a permissão de acesso ao Emissor Nacional não dá para abrir o assistente.");
  const r = (await chrome.runtime.sendMessage({ target: "background", kind: "nfse-open", payload })) as { ok: boolean; error?: string } | undefined;
  if (!r?.ok) throw new Error(r?.error ?? "Não foi possível abrir o Emissor Nacional.");
}
