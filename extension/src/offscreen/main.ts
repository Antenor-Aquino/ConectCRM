// Documento offscreen: recebe as chamadas das telas (dashboard, popup,
// service worker) e repassa ao worker do banco, que é o único dono do SQLite
// (PLANEJAMENTO.md, seção 4). O worker existe porque o OPFS síncrono, onde o
// banco é gravado, só funciona dentro de workers.
import type { RpcRequest, RpcResponse } from "../rpc/protocol";
import { playSound, type PlaySoundMessage } from "../lib/notify/sounds";
import type { WorkerRequest, WorkerResponse } from "./dbWorker";

const worker = new Worker(new URL("./dbWorker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, (r: RpcResponse) => void>();
let nextId = 1;

worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  const { id, ...rest } = e.data;
  pending.get(id)?.(rest as RpcResponse);
  pending.delete(id);
};
worker.onerror = (e) => {
  // Falha ao carregar o worker: responde a todos para as telas não ficarem esperando.
  for (const reply of pending.values()) reply({ ok: false, error: `Falha no banco de dados: ${e.message || "worker"}` });
  pending.clear();
};

chrome.runtime.onMessage.addListener((msg: RpcRequest, _sender, sendResponse: (r: RpcResponse) => void) => {
  if (msg?.target !== "offscreen" || msg.kind !== "rpc") return false;
  const id = nextId++;
  pending.set(id, sendResponse);
  worker.postMessage({ id, method: msg.method, params: msg.params, userId: msg.userId } satisfies WorkerRequest);
  return true;
});

// Som das notificações (o service worker não toca áudio; ver lib/notify/sounds.ts).
let audio: AudioContext | null = null;
chrome.runtime.onMessage.addListener((msg: PlaySoundMessage, _sender, sendResponse: (r: { ok: boolean; error?: string }) => void) => {
  if (msg?.target !== "offscreen" || msg.kind !== "play-sound") return false;
  audio ??= new AudioContext();
  playSound(audio, msg.sound, msg.volume)
    .then(() => sendResponse({ ok: true }))
    .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
