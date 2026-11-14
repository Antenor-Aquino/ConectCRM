// Excluir atividade (spec 18): reunião marcada pelo Calendly é cancelada lá
// também, pela API (o convidado recebe o aviso). Se o Calendly recusar, avisa
// que o evento precisa ser cancelado no Calendly.
import { call } from "../../rpc/client";
import { cancelCalendlyEvent } from "../../lib/calendly";
import { errorText } from "../../lib/errors";

const TEXT = "Excluir esta atividade? Vai para a lixeira, de onde pode ser restaurado.";

/** Pergunta e, se for do Calendly, cancela lá. true = pode excluir. */
export async function confirmActivityDelete(activityId: string): Promise<boolean> {
  const refs = await call("integrations.refsOf", { id: activityId }).catch(() => []);
  const ref = refs.find((r) => String(r.provider) === "calendly");
  if (!ref) return confirm(TEXT);
  if (
    !confirm(
      "Esta reunião foi marcada pelo Calendly.\n\nExcluir aqui e cancelar o evento no Calendly também? O convidado recebe o aviso de cancelamento.",
    )
  )
    return false;
  try {
    await cancelCalendlyEvent(ref.externalId);
  } catch (e) {
    alert(`A atividade vai ser excluída, mas o Calendly não cancelou o evento (${errorText(e)}).\n\nCancele o evento também no Calendly.`);
  }
  return true;
}
