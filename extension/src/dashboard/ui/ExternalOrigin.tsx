// "Importado do Pipedrive ↗" (spec 09): mostra a origem de um registro vindo
// de uma integração, com link para o original quando o endereço da conta
// está configurado. Também "Criado pelo Copiloto a partir do documento X"
// (spec 12), para o que o Copiloto criou a partir de um documento.
import { useEffect, useState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { formatDate } from "../../lib/format";
import { loadIntegrations, pipedriveRecordUrl } from "../../lib/integrations";

export function ExternalOrigin({ localId, className }: { localId: string; className?: string }) {
  const [origin, setOrigin] = useState<{ url: string | null; importedAt: string } | null>(null);
  const [copilot, setCopilot] = useState<{ file: string; at: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void call("origins.of", { id: localId })
      .then((o) => alive && setCopilot(o?.source === "copilot-document" ? { file: o.summary.file, at: o.createdAt } : null))
      .catch(() => undefined);
    void (async () => {
      const ref = (await call("integrations.refsOf", { id: localId })).find((r) => r.provider === "pipedrive" && r.entity !== "note");
      if (!ref) return alive && setOrigin(null);
      const { pipedrive } = await loadIntegrations();
      if (alive)
        setOrigin({ url: pipedriveRecordUrl(pipedrive.domain, ref.entity as "person" | "organization" | "deal", ref.externalId), importedAt: ref.importedAt });
    })();
    return () => {
      alive = false;
    };
  }, [localId]);
  if (copilot)
    return (
      <span className={cn("inline-flex items-center gap-1 text-theme-xs text-gray-500", className)} data-record-origin title="Veja o resumo no Histórico">
        <Sparkles size={12} className="text-brand-500" /> Criado pelo Copiloto a partir do documento "{copilot.file}" em {formatDate(copilot.at)}
      </span>
    );
  if (!origin) return null;
  const text = `Importado do Pipedrive em ${formatDate(origin.importedAt)}`;
  const cls = cn("inline-flex items-center gap-1 text-theme-xs text-gray-500", className);
  return origin.url ? (
    <a
      href={origin.url}
      target="_blank"
      rel="noopener noreferrer"
      title="Abrir o registro original no Pipedrive"
      className={cn(cls, "hover:text-brand-600 hover:underline")}
      data-external-origin
    >
      {text} <ExternalLink size={12} />
    </a>
  ) : (
    <span className={cls} data-external-origin>
      {text}
    </span>
  );
}
