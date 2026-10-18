// Configurações → E-mail: provedores usados ao clicar num e-mail (cartão,
// contato, organização). Com mais de um, o clique mostra a escolha. Ficam
// neste computador, para o usuário atual.
import { useEffect, useState } from "react";
import { Mail, Plus, Trash2 } from "lucide-react";
import { TaButton, TaInput, TaPanel, TaSelect } from "@tailadmin";
import {
  EMAIL_KINDS,
  emailKindLabel,
  loadEmailProviders,
  saveEmailProviders,
  validProviderUrl,
  type EmailProvider,
  type EmailProviderKind,
} from "../../lib/contactLinks";
import { Field } from "../ui/form";
import { useSession } from "../session";

const newId = () => crypto.randomUUID();

export function EmailSettings() {
  const { user } = useSession();
  const [list, setList] = useState<EmailProvider[] | null>(null);
  const [kind, setKind] = useState<EmailProviderKind>("gmail");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadEmailProviders(user.id).then(setList);
  }, [user.id]);
  if (!list) return null;

  const persist = async (next: EmailProvider[]) => {
    setList(next);
    await saveEmailProviders(user.id, next);
  };

  const add = async () => {
    setError(null);
    if (kind === "outro" && !validProviderUrl(url)) return setError("Informe o link completo, começando com https://");
    const label = name.trim() || (kind === "outro" ? new URL(url.trim()).hostname : emailKindLabel(kind));
    await persist([...list, { id: newId(), kind, name: label, ...(kind === "outro" ? { url: url.trim() } : {}) }]);
    setName("");
    setUrl("");
  };

  const hint = EMAIL_KINDS.find((k) => k.kind === kind)?.hint;
  return (
    <TaPanel
      title="E-mail"
      subtitle="Provedores que abrem ao clicar num e-mail do CRM. Com mais de um cadastrado, o clique mostra a lista para escolher. Ficam neste computador, para o seu usuário."
    >
      {list.length === 0 ? (
        <p className="mb-4 rounded-lg border border-dashed border-gray-300 px-4 py-3 text-theme-sm text-gray-500 dark:border-gray-700">
          Nenhum provedor cadastrado: o clique no e-mail usa o aplicativo de e-mail do computador.
        </p>
      ) : (
        <ul className="mb-5 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800" data-email-providers>
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <Mail size={16} className="shrink-0 text-brand-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">{p.name}</p>
                {p.name !== emailKindLabel(p.kind) && (
                  <p className="truncate text-theme-xs text-gray-500">{p.kind === "outro" ? p.url : emailKindLabel(p.kind)}</p>
                )}
              </div>
              <button
                type="button"
                title="Remover"
                onClick={() => void persist(list.filter((x) => x.id !== p.id))}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-error-50 hover:text-error-600"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Provedor" hint={hint}>
          <TaSelect value={kind} onChange={(e) => setKind(e.target.value as EmailProviderKind)}>
            {EMAIL_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </TaSelect>
        </Field>
        <Field label="Nome na lista (opcional)" hint="Ex.: Gmail pessoal, Zoho da empresa">
          <TaInput value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "outro" ? "Ex.: Zoho" : emailKindLabel(kind)} />
        </Field>
      </div>
      {kind === "outro" && (
        <Field
          label="Link de abertura"
          required
          hint="O link que você usa para abrir o e-mail. Se o provedor aceitar o destinatário no link, escreva {email} no lugar dele; sem {email}, o link abre e o endereço é copiado para você colar."
        >
          <TaInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mail.zoho.com/zm/#mail/folder/inbox" />
        </Field>
      )}
      {error && <p className="mb-3 text-theme-sm text-error-600">{error}</p>}
      <TaButton startIcon={<Plus size={15} />} onClick={() => void add()}>
        Adicionar provedor
      </TaButton>
    </TaPanel>
  );
}
