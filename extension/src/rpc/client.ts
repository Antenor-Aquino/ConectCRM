// Cliente usado pelas telas: garante que o offscreen existe e chama uma
// operação do banco. Uso: `await call("pipelines.list", {})`.
import type { MethodName, MethodParams, MethodResult } from "./methods";
import type { EnsureOffscreenMessage, RpcRequest, RpcResponse } from "./protocol";
import { base64ToBytes, bytesToBase64 } from "../lib/environment";

let currentUserId: string | null = null;

/** Usuário que assina as alterações (definido após a seleção de usuário/PIN). */
export function setCurrentUser(userId: string | null): void {
  currentUserId = userId;
}

let ready: Promise<void> | null = null;
function ensureOffscreen(): Promise<void> {
  if (!ready) {
    const msg: EnsureOffscreenMessage = { target: "background", kind: "ensure-offscreen" };
    ready = chrome.runtime.sendMessage(msg).then(() => undefined);
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function call<M extends MethodName>(method: M, ...args: MethodParams<M> extends undefined ? [] : [MethodParams<M>]): Promise<MethodResult<M>> {
  await ensureOffscreen();
  const request: RpcRequest = { target: "offscreen", kind: "rpc", method, params: args[0] ?? {}, userId: currentUserId };
  // Logo após criado, o offscreen pode ainda não ter registrado o listener.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = (await chrome.runtime.sendMessage(request)) as RpcResponse | undefined;
      if (!response) throw new Error("Não foi possível conectar ao banco local do CRM. Recarregue a página.");
      if (!response.ok) throw new RpcError(response.error);
      announceTrash(response.result);
      return response.result as MethodResult<M>;
    } catch (err) {
      if (err instanceof RpcError || attempt >= 20) throw err;
      ready = null;
      await sleep(100);
      await ensureOffscreen();
    }
  }
}

export class RpcError extends Error {}

/** Evento das telas: algo foi para a lixeira (o aviso com "Restaurar" escuta). */
export const TRASH_EVENT = "conectcrm:trash";
/** Evento das telas: dados mudaram por fora (ex.: restaurado da lixeira). */
export const DATA_CHANGED_EVENT = "conectcrm:data-changed";

function announceTrash(result: unknown): void {
  if (typeof window === "undefined" || !result || typeof result !== "object") return;
  const r = result as { __trash?: boolean; trash?: { __trash?: boolean } };
  const notice = r.__trash ? r : r.trash?.__trash ? r.trash : null;
  if (notice) window.dispatchEvent(new CustomEvent(TRASH_EVENT, { detail: notice }));
}

type SystemMethod =
  | "system.env"
  | "system.exportBegin"
  | "system.exportChunk"
  | "system.restoreBegin"
  | "system.restoreChunk"
  | "system.restore"
  | "system.switchEnv"
  | "system.resetDemo";

/** Operações do worker do banco: ambiente, exportar, restaurar. */
export async function systemCall<T>(method: SystemMethod, params: Record<string, unknown> = {}): Promise<T> {
  return (call as unknown as (m: string, p: unknown) => Promise<T>)(method, params);
}

/** Cópia do banco em bytes, buscada em partes (as mensagens têm limite de 64 MB). */
export async function exportDatabase(): Promise<Uint8Array> {
  const { token, size } = await systemCall<{ token: string; size: number }>("system.exportBegin");
  const out = new Uint8Array(size);
  for (let offset = 0; offset < size; ) {
    const part = base64ToBytes(await systemCall<string>("system.exportChunk", { token, offset }));
    if (!part.length) throw new Error("Falha ao exportar o banco.");
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Substitui o banco do ambiente atual pelos bytes do backup (enviados em partes). */
export async function restoreDatabase(bytes: Uint8Array): Promise<void> {
  const token = await systemCall<string>("system.restoreBegin", { size: bytes.length });
  for (let offset = 0; offset < bytes.length; offset += RESTORE_CHUNK) {
    await systemCall("system.restoreChunk", { token, base64: bytesToBase64(bytes.subarray(offset, offset + RESTORE_CHUNK)) });
  }
  await systemCall("system.restore", { token });
}
const RESTORE_CHUNK = 16 * 1024 * 1024;
