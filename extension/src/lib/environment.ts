// Ambiente ativo: Produção (dados reais) ou Teste (dados de exemplo), como
// na gestao-financeira-extensao. Cada um tem seu próprio banco. A escolha fica
// no IndexedDB do documento offscreen (lá não existe chrome.storage).
export type DbEnv = "production" | "demo";
/** Bytes ⇄ base64 (as mensagens entre páginas da extensão são JSON). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
