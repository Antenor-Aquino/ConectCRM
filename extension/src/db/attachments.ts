// Arquivos guardados no banco (fotos de contato, logos; depois anexos de
// cartões e mídias do WhatsApp). Trafegam entre telas e banco como data URL.
import { ValidationError } from "../lib/validate";
import { insertRow, type DbContext } from "./repo";
import { many, type DatabaseSync } from "./sql";

const MAX_IMAGE_BYTES = 512 * 1024;

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.*)$/);
  if (!m) throw new ValidationError("Arquivo inválido.");
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
