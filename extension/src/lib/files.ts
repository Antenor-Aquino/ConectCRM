// Arquivos no navegador: leitura como data URL, download e tamanho legível.
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    r.readAsDataURL(file);
  });
}

/** Base64 puro (sem o prefixo "data:...;base64,"). */
export function dataUrlBase64(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function isAudioFile(f: { name?: string; type?: string; mime?: string }): boolean {
  return /^audio\//i.test(f.type || f.mime || "") || /\.(ogg|opus|mp3|m4a|aac|wav|amr|oga)$/i.test(f.name || "");
}
