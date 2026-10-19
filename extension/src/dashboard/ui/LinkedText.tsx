// Texto com links clicáveis (descrição de atividade, notas): http(s)://...,
// www.... e e-mails viram links que abrem em outra aba. `renderToken` permite
// trocar marcadores (ex.: imagens das notas) por componentes.
import { Fragment, type ReactNode } from "react";

const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[^\s<>"']+|[\w.+-]+@[\w-]+\.[\w.-]+)/gi;
/** Pontuação no fim não faz parte do link ("veja https://x.com/a.") */
const TRAIL_RE = /[.,;:!?)\]}'"]+$/;

export function linkHref(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.includes("@") && !raw.includes("/")) return `mailto:${raw}`;
  return `https://${raw}`;
}

/** Quebra o texto em partes: texto comum e links. */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0];
    // Tira a pontuação do fim; ")" só sai se estiver sobrando (mantém wikipedia/CRM_(software)).
    for (;;) {
      const ch = raw.at(-1) ?? "";
      if (ch === ")" && raw.split("(").length >= raw.split(")").length) break;
      if (!TRAIL_RE.test(ch)) break;
      raw = raw.slice(0, -1);
    }
    const start = m.index!;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: raw, href: linkHref(raw) });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function LinkedText({ text, className, renderToken }: { text: string; className?: string; renderToken?: (piece: string) => ReactNode[] | null }) {
  const parts = splitLinks(text);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="break-all text-brand-600 underline decoration-brand-300 underline-offset-2 hover:text-brand-700"
          >
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{renderToken?.(p.text) ?? p.text}</Fragment>
        ),
      )}
    </span>
  );
}
