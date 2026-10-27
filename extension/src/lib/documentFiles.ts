// Conteúdo dos documentos do lado das telas: preparar (SHA-256 e texto do
// PDF), guardar (navegador ou pasta), abrir/baixar, manutenção (lixeira
// vencida, texto de PDFs antigos, mudança para a pasta) e backup.
import { unzip, zip, type Unzipped } from "fflate";
import type { FileRef, OrphanBlob } from "../db/documents";
import { call, systemCall } from "../rpc/client";
import type { DbEnv } from "./environment";
import { deleteContent, documentsFolderStatus, moveToFolder, putInBrowser, readContent, sha256Hex, storeContent, type ContentRef } from "./fileStore";
import { MAX_UPLOAD_BYTES } from "./files";
import { SETTINGS_FILE } from "./settingsTransfer";
import { addNotification } from "./notifications";
import { extractPdfText } from "./pdf";

let envPromise: Promise<DbEnv> | null = null;
export function currentEnv(): Promise<DbEnv> {
  envPromise ??= systemCall<DbEnv>("system.env");
  return envPromise;
}

export interface PreparedFile {
  file: File;
  sha256: string;
  /** Texto do PDF (null = sem texto; undefined = não lido, fica pendente). */
  text: string | null | undefined;
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.size === 0) throw new Error(`"${file.name}" está vazio.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`"${file.name}" passa de 25 MB.`);
  const sha256 = await sha256Hex(file);
  let text: string | null | undefined = null;
  if (isPdf(file)) text = await extractPdfText(file).catch(() => undefined);
  return { file, sha256, text };
}

export const isPdf = (f: { type?: string; mime?: string; name?: string; filename?: string }) =>
  (f.type || f.mime) === "application/pdf" || /\.pdf$/i.test(f.name || f.filename || "");
export const isImage = (f: { type?: string; mime?: string }) => /^image\//.test(f.type || f.mime || "");

/** Grava o conteúdo (se ainda não existe) e devolve a referência para o banco. */
export async function saveContent(p: PreparedFile, documentName: string): Promise<FileRef> {
  const mime = p.file.type || (isPdf(p.file) ? "application/pdf" : "application/octet-stream");
  const base = { sha256: p.sha256, mime, size: p.file.size, filename: p.file.name, text: p.text };
  const existing = await call("documents.blob", { sha256: p.sha256 });
  if (existing) return { ...base, location: existing.location === "folder" ? "folder" : "browser", path: existing.path };
  const stored = await storeContent(await currentEnv(), p.file, { sha256: p.sha256, name: documentName, filename: p.file.name });
  return { ...base, ...stored };
}

export interface OpenedFile {
  blob: Blob;
  filename: string;
  mime: string;
}

/** Lê o arquivo de uma versão (registra visualização ou download na auditoria). */
export async function fetchVersion(versionId: string, action: "view" | "download" | "index" | "inline"): Promise<OpenedFile> {
  const info = await call("documents.file", { versionId, action });
  const blob = info.legacyDataUrl ? await (await fetch(info.legacyDataUrl)).blob() : await readContent(await currentEnv(), info);
  return { blob, filename: info.filename, mime: info.mime };
}

export function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadVersion(versionId: string): Promise<void> {
  const f = await fetchVersion(versionId, "download");
  saveBlobAs(f.blob, f.filename);
}

/** Vários documentos num .zip (ações em lote). */
export async function downloadZip(items: { versionId: string; name: string }[], zipName: string): Promise<void> {
  const files: Record<string, Uint8Array> = {};
  for (const it of items) {
    const f = await fetchVersion(it.versionId, "download");
    const ext = f.filename.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? "";
    let name = `${it.name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}${ext}`;
    for (let i = 2; files[name]; i++) name = `${it.name.slice(0, 80)} (${i})${ext}`;
    files[name] = new Uint8Array(await f.blob.arrayBuffer());
  }
  const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out))));
  saveBlobAs(new Blob([bytes as BlobPart], { type: "application/zip" }), zipName);
}

/** Apaga o conteúdo de arquivos que ficaram sem documento. */
export async function deleteOrphans(orphans: OrphanBlob[]): Promise<void> {
  const env = await currentEnv();
  for (const o of orphans) await deleteContent(env, { sha256: o.sha256, location: o.location, path: o.path, mime: "" }).catch(() => {});
}

/** Rotina ao abrir o GED: lixeira vencida, texto de PDFs antigos e mudança para a pasta. */
export async function runDocumentMaintenance(): Promise<{ moved: number; indexed: number }> {
  await deleteOrphans(await call("documents.purgeExpired"));
  let indexed = 0;
  for (const v of await call("files.pendingText")) {
    let text: string | null = null;
    try {
      text = await extractPdfText((await fetchVersion(v.id, "index")).blob);
    } catch {
      text = null;
    }
    await call("files.setText", { versionId: v.id, text });
    indexed++;
  }
  const moved = await moveBrowserFilesToFolder();
  return { moved, indexed };
}

/** Com pasta configurada e acesso concedido, muda para lá o que está no navegador. */
export async function moveBrowserFilesToFolder(): Promise<number> {
  const env = await currentEnv();
  if (env !== "production") return 0;
  const st = await documentsFolderStatus();
  if (!st.configured || st.permission !== "granted") return 0;
  let n = 0;
  for (const b of await call("files.inBrowser")) {
    const path = await moveToFolder(env, b).catch(() => null);
    if (!path) continue;
    await call("files.setLocation", { blobId: b.id, location: "folder", path });
    n++;
  }
  return n;
}

/** Pasta → navegador (ao voltar a guardar no navegador). */
export async function moveFolderFilesToBrowser(): Promise<number> {
  const env = await currentEnv();
  const moved: string[] = [];
  for (const b of await call("files.all")) {
    if (b.location !== "folder") continue;
    await putInBrowser(env, b.sha256, await readContent(env, b));
    moved.push(b.sha256);
  }
  // Os arquivos continuam também na pasta (cópia); o CRM passa a usar os do navegador.
  if (moved.length) await call("files.markInBrowser", { sha256s: moved });
  return moved.length;
}

// ---------- Backup ----------

const DOCS_DIR = "documentos";

/** Cópia manual: .zip com o banco, os documentos e (opcional) as configurações. */
export async function buildBackupZip(dbBytes: Uint8Array, settings?: string): Promise<Uint8Array> {
  const env = await currentEnv();
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { "conectcrm.sqlite": dbBytes };
  if (settings) files[SETTINGS_FILE] = new TextEncoder().encode(settings);
  for (const b of await call("files.all")) {
    try {
      files[`${DOCS_DIR}/${b.sha256}`] = [new Uint8Array(await (await readContent(env, b)).arrayBuffer()), { level: 0 }];
    } catch {
      // Sem acesso: o banco vai mesmo assim (o arquivo continua onde está).
    }
  }
  return new Promise((resolve, reject) => zip(files, (err, out) => (err ? reject(err) : resolve(out))));
}

/** Lê um backup .zip: o banco, os documentos e as configurações (se vieram). */
export async function readBackupZip(bytes: Uint8Array): Promise<{ db: Uint8Array; files: Map<string, Uint8Array>; settings: string | null }> {
  const out = await new Promise<Unzipped>((resolve, reject) => unzip(bytes, (err, r) => (err ? reject(err) : resolve(r))));
  const db = out["conectcrm.sqlite"];
  if (!db) throw new Error("Este .zip não é um backup do ConectCRM (falta conectcrm.sqlite).");
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(out)) {
    const m = name.match(new RegExp(`^${DOCS_DIR}/([0-9a-f]{64})$`));
    if (m) files.set(m[1]!, data);
  }
  const settings = out[SETTINGS_FILE] ? new TextDecoder().decode(out[SETTINGS_FILE]) : null;
  return { db, files, settings };
}

/** Depois de restaurar o banco: devolve os documentos ao navegador. */
export async function restoreDocumentFiles(files: Map<string, Uint8Array>): Promise<number> {
  const env = await currentEnv();
  for (const [sha, data] of files) await putInBrowser(env, sha, new Blob([data as BlobPart]));
  if (files.size) await call("files.markInBrowser", { sha256s: [...files.keys()] });
  return files.size;
}

export type { ContentRef };

/** Cadastro rápido (popup): mesma classificação para todos, vínculos da tela.
 * Arquivo que já existe no GED é só vinculado (não duplica). */
export async function createDocumentsFrom(
  items: { file: File; name: string }[],
  typeId: string,
  context: { type: "deal" | "activity" | "person" | "organization"; id: string },
): Promise<{ created: number; linked: number; ids: string[] }> {
  const links = (await call("documents.contextLinks", context)).map(({ type, id, auto }) => ({ type, id, auto }));
  let created = 0;
  let linked = 0;
  const ids: string[] = [];
  for (const it of items) {
    const prepared = await prepareFile(it.file);
    const dup = (await call("documents.bySha", { sha256: prepared.sha256 }))[0];
    if (dup) {
      await call("documents.addLinks", { ids: [dup.id], links });
      ids.push(dup.id);
      linked++;
      continue;
    }
    ids.push(await call("documents.create", { name: it.name, typeId, links, file: await saveContent(prepared, it.name) }));
    created++;
  }
  return { created, linked, ids };
}

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [head, b64] = dataUrl.split(",");
  const mime = head!.match(/^data:([^;,]*)/)?.[1] || "application/octet-stream";
  const bin = atob(b64!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

/** Ao abrir o CRM (uma vez por dia e ambiente): avisa no sino os documentos que vencem em até 7 dias. */
export async function checkDocumentExpiry(): Promise<number> {
  const env = await currentEnv();
  const key = `conectcrm-ged-alerta-${env}`;
  const today = new Date().toDateString();
  try {
    if (localStorage.getItem(key) === today) return 0;
    localStorage.setItem(key, today);
  } catch {
    // Sem armazenamento local: avisa mesmo assim.
  }
  const list = await call("documents.expiring", { days: 7 });
  if (!list.length) return 0;
  const fmt = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
  const names = list.slice(0, 5).map((d) => `${d.name} (${fmt(d.valid_until)})`);
  await addNotification({
    kind: "info",
    title: list.length === 1 ? "Documento perto de vencer" : `${list.length} documentos perto de vencer`,
    message: `${names.join("; ")}${list.length > 5 ? "…" : ""}. Veja em GED → Vencem em 30 dias.`,
  });
  return list.length;
}
