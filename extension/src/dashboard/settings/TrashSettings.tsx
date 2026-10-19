// Configurações → Lixeira (spec 11): prazo até a exclusão definitiva (só o
// administrador muda) e a própria lixeira logo abaixo.
import { useEffect, useState } from "react";
import { TaButton, TaInput, TaPanel } from "@tailadmin";
import { call } from "../../rpc/client";
import { errorText } from "../../lib/errors";
import { useSession } from "../session";
import { Field } from "../ui/form";
import { TrashView } from "../trash/TrashView";

export function TrashSettings() {
  const { user } = useSession();
  const admin = user.role === "admin";
  const [days, setDays] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  useEffect(() => {
    void call("trash.settings").then((s) => {
      setDays(s.days);
      setDraft(String(s.days));
    });
  }, []);
  if (days === null) return null;

  const save = async () => {
    setMsg(null);
    try {
      const n = Number(draft);
      await call("trash.setRetention", { days: n });
      setDays(n);
      setMsg({ text: `Prazo salvo: os itens ficam ${n} dia${n === 1 ? "" : "s"} na lixeira.`, kind: "ok" });
    } catch (e) {
      setMsg({ text: errorText(e), kind: "err" });
    }
  };

  return (
    <div className="space-y-5" data-trash-settings>
      <TaPanel
        title="Lixeira"
        subtitle="Tudo o que é excluído no CRM (cartões, atividades, contatos, organizações, notas, documentos, produtos, tags, campos, etapas…) vai para a lixeira e pode ser restaurado dentro do prazo. Depois, é excluído definitivamente."
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Prazo até a exclusão definitiva" hint={admin ? "De 1 a 365 dias. Vale para todos os usuários." : "Só o administrador altera."}>
            <div className="flex items-center gap-2">
              <TaInput
                type="number"
                min={1}
                max={365}
                className="w-28"
                disabled={!admin}
                value={draft}
                aria-label="Prazo da lixeira em dias"
                onChange={(e) => setDraft(e.target.value)}
              />
              <span className="text-theme-sm text-gray-600 dark:text-gray-400">dias</span>
            </div>
          </Field>
          {admin && (
            <div className="mb-[22px]">
              <TaButton variant="primary" disabled={draft === String(days)} onClick={() => void save()}>
                Salvar prazo
              </TaButton>
            </div>
          )}
        </div>
        {msg && (
          <p
            className={`mt-1 rounded-lg px-3 py-2 text-theme-sm ${msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700"}`}
            data-trash-settings-msg
          >
            {msg.text}
          </p>
        )}
        <p className="mt-3 text-theme-xs text-gray-500">
          A exclusão definitiva acontece automaticamente quando o prazo vence (conferido sempre que o CRM é aberto). O administrador também pode excluir
          definitivamente antes, item a item ou esvaziando a lixeira.
        </p>
      </TaPanel>
      <TrashView key={days} />
    </div>
  );
}
