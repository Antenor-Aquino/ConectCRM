// Em qual instalação da extensão este banco está. Até a 0.2.73 o ID mudava
// quando a extensão era instalada de outra pasta; desde a 0.2.74 o ID é fixo
// (chave no manifest), mas um banco restaurado de uma instalação antiga traz
// o ID antigo. Quando o ID não confere,
// o CRM abre o assistente de mudança (pastas, configurações, Gestão
// Financeira), que marca a instalação atual ao terminar.
import { nowIso } from "../lib/ids";
import type { DbContext } from "./repo";
import { one, run, type DatabaseSync } from "./sql";

const KEY = "installation";

export interface Installation {
  extensionId: string;
  since: string;
}

export function getInstallation(db: DatabaseSync): Installation | null {
  const r = one<{ value: string }>(db, "SELECT value FROM setting WHERE key = ?", KEY);
  try {
    return r ? (JSON.parse(r.value) as Installation) : null;
  } catch {
    return null;
  }
}

export function markInstallation(db: DatabaseSync, ctx: DbContext, extensionId: string): void {
  run(
    db,
    `INSERT INTO setting (workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ctx.workspaceId,
    KEY,
    JSON.stringify({ extensionId, since: nowIso() } satisfies Installation),
    nowIso(),
  );
}

/**
 * Confere a instalação ao abrir. Banco sem registro (instalação nova ou
 * versão anterior a 0.2.74): só registra. ID diferente: mudou de instalação.
 */
export function checkInstallation(db: DatabaseSync, ctx: DbContext, extensionId: string): { moved: boolean; previousId: string | null } {
  const cur = getInstallation(db);
  if (!cur) {
    markInstallation(db, ctx, extensionId);
    return { moved: false, previousId: null };
  }
  return { moved: cur.extensionId !== extensionId, previousId: cur.extensionId };
}
