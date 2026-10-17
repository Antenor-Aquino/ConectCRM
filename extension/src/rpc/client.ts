// Cliente usado pelas telas: garante que o offscreen existe e chama uma
// operação do banco. Uso: `await call("pipelines.list", {})`.
import type { MethodName, MethodParams, MethodResult } from "./methods";
import type { EnsureOffscreenMessage, RpcRequest, RpcResponse } from "./protocol";

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

/** Operações do próprio offscreen: ambiente, exportar, restaurar. */
export async function systemCall<T>(method: "system.env" | "system.export" | "system.switchEnv" | "system.resetDemo" | "system.restore", params: Record<string, unknown> = {}): Promise<T> {
  return (call as unknown as (m: string, p: unknown) => Promise<T>)(method, params);
}
