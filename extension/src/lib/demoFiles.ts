// Arquivos de exemplo do ambiente de Teste (GED): PDF simples com texto
// (para prévia e busca no conteúdo) e imagem SVG.

/** PDF de uma página com título e linhas de texto (Helvetica, WinAnsi). */
export function makePdf(title: string, lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = ["BT /F1 20 Tf 60 770 Td", `(${esc(title)}) Tj`, "/F1 12 Tf 0 -36 Td 16 TL", ...lines.map((l) => `(${esc(l)}) '`), "ET"].join("\n");
  // Bytes em Latin-1 (acentos do português cabem no WinAnsiEncoding).
  const latin1 = (s: string) => Uint8Array.from(s, (c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63));
  const content = latin1(text);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    size += b.length;
  };
  push(latin1("%PDF-1.4\n"));
  objects.forEach((o, i) => {
    offsets.push(size);
    push(latin1(`${i + 1} 0 obj\n${o}\nendobj\n`));
  });
  offsets.push(size);
  push(latin1(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`));
  push(content);
  push(latin1("\nendstream\nendobj\n"));
  const xref = size;
  push(latin1(`xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`));
  push(latin1(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Ilustração simples de fachada (SVG). */
export function makeFacadeSvg(label: string): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
<rect width="640" height="420" fill="#dbeafe"/>
<rect x="0" y="330" width="640" height="90" fill="#94a3b8"/>
<rect x="120" y="110" width="400" height="220" fill="#f8fafc" stroke="#334155" stroke-width="4"/>
<polygon points="100,115 320,40 540,115" fill="#1e3a8a"/>
${[0, 1, 2, 3].map((i) => `<rect x="${150 + i * 90}" y="150" width="50" height="60" fill="#93c5fd" stroke="#334155" stroke-width="2"/>`).join("")}
<rect x="290" y="240" width="60" height="90" fill="#78350f"/>
<text x="320" y="390" font-family="Arial, sans-serif" font-size="28" text-anchor="middle" fill="#0f172a">${label}</text>
</svg>`;
  return new TextEncoder().encode(svg);
}
