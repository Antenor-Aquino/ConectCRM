// Localizar documentos: quando a pasta de documentos muda de lugar (outro
// disco, outro computador, extensão reinstalada) ou os arquivos são
// reorganizados, o banco continua apontando para o caminho antigo. Esta rotina
// confere quais arquivos não estão onde o banco diz, procura cada um numa
// pasta escolhida (pelo código no nome, "(fe2d460b)", pelo nome de backup
// antigo, o SHA-256 inteiro, ou pelo tamanho) e só aceita se o conteúdo for o
// mesmo (SHA-256). Achou na pasta de documentos: só atualiza o caminho. Achou
// em outra pasta (ex.: o backup): copia para onde os documentos ficam hoje.
import type { LocateBlob } from "../db/documents";
import { call } from "../rpc/client";
import type { DbEnv } from "./environment";
import { dirFor, folderPath, grantedFolder, hasInBrowser, loadDocumentsFolder, putInBrowser, sha256Hex, writeToFolder } from "./fileStore";
import { currentEnv } from "./documentFiles";
import { loadBackupFolderHandle, type PermissionedDirectoryHandle } from "./backupFolder";

export interface DocumentsCheck {
  total: number;
  ok: number;
  missing: LocateBlob[];
  /** Arquivos na pasta, mas sem acesso a ela agora (o Chrome pede autorização). */
  noAccess: number;
}

/** Confere se cada arquivo está onde o banco diz (só a existência e o tamanho). */
export async function checkDocuments(env?: DbEnv): Promise<DocumentsCheck> {
  const e = env ?? (await currentEnv());
  const blobs = await call("files.locateList");
  const root = await loadDocumentsFolder().catch(() => null);
  const granted = root && (await root.queryPermission({ mode: "readwrite" }).catch(() => "denied")) === "granted";
  const out: DocumentsCheck = { total: blobs.length, ok: 0, missing: [], noAccess: 0 };
  for (const b of blobs) {
    if (b.location === "folder") {
      if (root && !granted) {
        out.noAccess++;
        continue;
      }
      if (root && b.path && (await sizeAt(root, b.path)) === b.size_bytes) out.ok++;
      else out.missing.push(b);
    } else if (await hasInBrowser(e, b.sha256).catch(() => false)) out.ok++;
    else out.missing.push(b);
  }
  return out;
}

async function sizeAt(root: FileSystemDirectoryHandle, path: string): Promise<number | null> {
  try {
    const { dir, file } = await dirFor(root, path, false);
    return (await (await dir.getFileHandle(file)).getFile()).size;
  } catch {
    return null;
  }
}

interface Entry {
  path: string;
  handle: FileSystemFileHandle;
  size?: number;
}

const MAX_DEPTH = 8;
const MAX_FILES = 200_000;

/** Lista os arquivos da pasta e das subpastas (ignora as ocultas). */
async function scan(root: FileSystemDirectoryHandle, onFile?: (n: number) => void): Promise<Entry[]> {
  const out: Entry[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string, depth: number) => {
    // `values()` ainda não está nos tipos do TS desta versão.
    for await (const h of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
      if (out.length >= MAX_FILES) return;
      if (h.name.startsWith(".")) continue;
      const path = prefix ? `${prefix}/${h.name}` : h.name;
      if (h.kind === "directory") {
        if (depth < MAX_DEPTH) await walk(h as FileSystemDirectoryHandle, path, depth + 1);
      } else {
        out.push({ path, handle: h as FileSystemFileHandle });
        if (out.length % 200 === 0) onFile?.(out.length);
      }
    }
  };
  await walk(root, "", 0);
  onFile?.(out.length);
  return out;
}

const SHORT = /\(([0-9a-f]{8})\)(?:\.[A-Za-z0-9]{1,8})?$/i;
const FULL = /^([0-9a-f]{64})$/i;

/** A pasta escolhida parece ser a de um mês ("2026-10"), e não a pasta de documentos. */
export const looksLikeMonthFolder = (name: string) => /^\d{4}-\d{2}$/.test(name);

export interface LocateProgress {
  phase: "scan" | "match" | "save";
  done: number;
  total: number;
}

export interface LocateResult {
  /** Arquivos que faltavam antes da busca. */
  missingBefore: number;
  /** Achados na própria pasta de documentos (só o caminho mudou). */
  relinked: number;
  /** Achados em outra pasta e copiados para onde os documentos ficam. */
  copied: number;
  /** Continuam sem arquivo. */
  stillMissing: LocateBlob[];
  scanned: number;
}

/**
 * Procura os arquivos que faltam em `source`. Se `source` for a pasta de
 * documentos, só atualiza os caminhos; senão copia o conteúdo para a pasta de
 * documentos (com acesso) ou para o navegador.
 */
export async function locateDocuments(source: PermissionedDirectoryHandle, onProgress?: (p: LocateProgress) => void): Promise<LocateResult> {
  const env = await currentEnv();
  const { missing } = await checkDocuments(env);
  const result: LocateResult = { missingBefore: missing.length, relinked: 0, copied: 0, stillMissing: [], scanned: 0 };
  if (!missing.length) return result;

  const docsRoot = env === "production" ? await grantedFolder() : null;
  const isDocsRoot = !!docsRoot && (await docsRoot.isSameEntry(source).catch(() => false));

  const entries = await scan(source, (n) => onProgress?.({ phase: "scan", done: n, total: 0 }));
  result.scanned = entries.length;
  const byShort = new Map<string, Entry[]>();
  const byFull = new Map<string, Entry[]>();
  const add = <K,>(m: Map<K, Entry[]>, k: K, e: Entry) => m.set(k, [...(m.get(k) ?? []), e]);
  for (const e of entries) {
    const name = e.path.split("/").pop()!;
    const full = name.match(FULL)?.[1];
    if (full) add(byFull, full.toLowerCase(), e);
    const short = name.match(SHORT)?.[1];
    if (short) add(byShort, short.toLowerCase(), e);
  }
  let bySize: Map<number, Entry[]> | null = null;
  const sizeOf = async (e: Entry) => (e.size ??= (await e.handle.getFile()).size);
  const tried = new Set<Entry>();
  const sameContent = async (e: Entry, b: LocateBlob): Promise<File | null> => {
    if (tried.has(e)) return null;
    if ((await sizeOf(e).catch(() => -1)) !== b.size_bytes) return null;
    const file = await e.handle.getFile();
    if ((await sha256Hex(file)) !== b.sha256) {
      tried.add(e);
      return null;
    }
    return file;
  };

  const found: { blob: LocateBlob; entry: Entry; file: File }[] = [];
  let done = 0;
  for (const b of missing) {
    onProgress?.({ phase: "match", done: done++, total: missing.length });
    let hit: { entry: Entry; file: File } | null = null;
    for (const e of [...(byFull.get(b.sha256) ?? []), ...(byShort.get(b.sha256.slice(0, 8)) ?? [])]) {
      const file = await sameContent(e, b).catch(() => null);
      if (file) {
        hit = { entry: e, file };
        break;
      }
    }
    if (!hit) {
      // Renomeado: procura pelo tamanho (só lê o tamanho quando precisa).
      if (!bySize) {
        bySize = new Map();
        for (const e of entries) add(bySize, await sizeOf(e).catch(() => -1), e);
      }
      for (const e of bySize.get(b.size_bytes) ?? []) {
        const file = await sameContent(e, b).catch(() => null);
        if (file) {
          hit = { entry: e, file };
          break;
        }
      }
    }
    if (hit) found.push({ blob: b, ...hit });
    else result.stillMissing.push(b);
  }

  const items: { blobId: string; location: "browser" | "folder"; path: string | null }[] = [];
  done = 0;
  for (const f of found) {
    onProgress?.({ phase: "save", done: done++, total: found.length });
    if (isDocsRoot) {
      items.push({ blobId: f.blob.id, location: "folder", path: f.entry.path });
      result.relinked++;
    } else if (docsRoot) {
      const path = folderPath(f.blob.name ?? "documento", f.blob.filename ?? f.entry.path, f.blob.sha256, new Date(f.blob.created_at));
      await writeToFolder(docsRoot, path, new Blob([f.file], { type: f.blob.mime }));
      items.push({ blobId: f.blob.id, location: "folder", path });
      result.copied++;
    } else {
      await putInBrowser(env, f.blob.sha256, new Blob([f.file], { type: f.blob.mime }));
      items.push({ blobId: f.blob.id, location: "browser", path: null });
      result.copied++;
    }
  }
  // Em lotes, para não segurar o banco numa transação enorme.
  for (let i = 0; i < items.length; i += 500) await call("files.relocate", { items: items.slice(i, i + 500) });
  return result;
}

/** Texto curto do resultado (aviso e tela). */
export function locateSummary(r: LocateResult): string {
  if (!r.missingBefore) return "Todos os documentos estão no lugar. Nada a localizar.";
  const parts: string[] = [];
  if (r.relinked) parts.push(`${r.relinked} reencontrado(s) na pasta de documentos`);
  if (r.copied) parts.push(`${r.copied} recuperado(s) e copiado(s) para o lugar dos documentos`);
  if (r.stillMissing.length) parts.push(`${r.stillMissing.length} continua(m) sem arquivo`);
  return `${parts.join("; ") || "Nenhum arquivo encontrado"} (${r.scanned} arquivo(s) examinado(s)).`;
}

/** Pastas de backup configuradas (a do banco e a própria dos documentos), sem repetir. */
export async function backupFolders(): Promise<PermissionedDirectoryHandle[]> {
  const out: PermissionedDirectoryHandle[] = [];
  for (const key of ["dir", "docs"] as const) {
    const h = await loadBackupFolderHandle(key).catch(() => null);
    if (!h) continue;
    let dup = false;
    for (const o of out) if (await o.isSameEntry(h).catch(() => false)) dup = true;
    if (!dup) out.push(h);
  }
  return out;
}

/** Depois de restaurar um banco: traz das pastas de backup os documentos que faltam. */
export async function recoverFromBackups(onProgress?: (p: LocateProgress) => void): Promise<number> {
  let n = 0;
  for (const h of await backupFolders()) {
    const ok =
      (await h.queryPermission({ mode: "read" }).catch(() => "denied")) === "granted" ||
      (await h.requestPermission({ mode: "read" }).catch(() => "denied")) === "granted";
    if (!ok) continue;
    const r = await locateDocuments(h, onProgress);
    n += r.copied + r.relinked;
    if (!r.stillMissing.length) break;
  }
  return n;
}
