// Arquivos guardados no banco (fotos de contato, logos; depois anexos de
// cartões e mídias do WhatsApp). Trafegam entre telas e banco como data URL.
import { ValidationError } from "../lib/validate";
import { insertRow, softDelete, type DbContext } from "./repo";
import { many, type DatabaseSync } from "./sql";

const MAX_IMAGE_BYTES = 512 * 1024;

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  // Aceita parâmetros no tipo (ex.: "audio/ogg; codecs=opus") e tipo vazio.
  const m = dataUrl.match(/^data:([^;,]*)(?:;[^,]*?)?;base64,(.*)$/s);
  if (!m) throw new ValidationError("Arquivo inválido.");
  m[1] = m[1]!.trim().toLowerCase() || "application/octet-stream";
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1]!, bytes };
}

function encodeDataUrl(mime: string, bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Foto/logo já reduzida pela tela (ver ui/ImageUpload). */
export function saveImage(db: DatabaseSync, ctx: DbContext, input: { entityType: string; entityId?: string | null; filename: string; dataUrl: string }): string {
  const { mime, bytes } = decodeDataUrl(input.dataUrl);
  if (!mime.startsWith("image/")) throw new ValidationError("Envie uma imagem.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ValidationError("Imagem muito grande (máximo 512 KB).");
  return insertRow(db, ctx, "attachment", {
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    filename: input.filename,
    mime,
    size_bytes: bytes.byteLength,
    data: bytes,
  });
}

export function getDataUrls(db: DatabaseSync, ids: string[]): Record<string, string> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const rows = many<{ id: string; mime: string; data: Uint8Array }>(
    db,
    `SELECT id, mime, data FROM attachment WHERE deleted_at IS NULL AND id IN (${unique.map(() => "?").join(", ")})`,
    ...unique,
  );
  return Object.fromEntries(rows.map((r) => [r.id, encodeDataUrl(r.mime, r.data)]));
}

// Anexos de cartão (negócio, ticket, etapa): arquivos do computador, mídias e
// recortes enviados pelo popup do WhatsApp. Mesmo limite do wa-pipedrive.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface AttachmentInfo {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
}

export function addFile(db: DatabaseSync, ctx: DbContext, input: { entityType: "deal"; entityId: string; filename: string; dataUrl: string }): string {
  const { mime, bytes } = decodeDataUrl(input.dataUrl);
  if (bytes.byteLength === 0) throw new ValidationError("Arquivo vazio.");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ValidationError(`"${input.filename}" passa de 25 MB.`);
  const filename = input.filename.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 160) || "arquivo";
  return insertRow(db, ctx, "attachment", {
    entity_type: input.entityType,
    entity_id: input.entityId,
    filename,
    mime,
    size_bytes: bytes.byteLength,
    data: bytes,
  });
}

export function listAttachments(db: DatabaseSync, entityType: string, entityId: string): AttachmentInfo[] {
  return many<AttachmentInfo>(
    db,
    `SELECT a.id, a.filename, a.mime, a.size_bytes, a.created_at, a.created_by, u.name AS created_by_name
     FROM attachment a LEFT JOIN app_user u ON u.id = a.created_by
     WHERE a.deleted_at IS NULL AND a.entity_type = ? AND a.entity_id = ?
     ORDER BY a.created_at DESC`,
    entityType,
    entityId,
  );
}

export function attachmentOwner(db: DatabaseSync, id: string): { entity_type: string | null; entity_id: string | null } | undefined {
  return many<{ entity_type: string | null; entity_id: string | null }>(db, "SELECT entity_type, entity_id FROM attachment WHERE id = ? AND deleted_at IS NULL", id)[0];
}

export function deleteAttachment(db: DatabaseSync, ctx: DbContext, id: string): void {
  softDelete(db, ctx, "attachment", id);
}
