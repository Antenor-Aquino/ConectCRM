// "Importado do Pipedrive ↗" (spec 09): mostra a origem de um registro vindo
// de uma integração, com link para o original quando o endereço da conta
// está configurado.
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { formatDate } from "../../lib/format";
import { loadIntegrations, pipedriveRecordUrl } from "../../lib/integrations";

export function ExternalOrigin({ localId, className }: { localId: string; className?: string }) {
  const [origin, setOrigin] = useState<{ url: string | null; importedAt: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const ref = (await call("integrations.refsOf", { id: localId })).find((r) => r.provider === "pipedrive");
      if (!ref) return alive && setOrigin(null);
      const { pipedrive } = await loadIntegrations();
      if (alive) setOrigin({ url: pipedriveRecordUrl(pipedrive.domain, ref.entity, ref.externalId), importedAt: ref.importedAt });
    })();
    return () => {
      alive = false;
    };
  }, [localId]);
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
