// Conversa aberta no WhatsApp Web: identifica o contato pelo telefone e
// mostra os cartões dele para escolher o destino com um clique.
import { useCallback, useEffect, useState } from "react";
import { MessageCircle, RefreshCw, UserPlus } from "lucide-react";
import { TaBadge, TaButton } from "@tailadmin";
import { call } from "../rpc/client";
import type { PersonListItem } from "../db/contacts";
import { formatCents } from "../lib/format";
import { readActiveWhatsAppChat, type OpenChat } from "../lib/whatsapp";
import { errText, Section, StatusText, type Status } from "./ui";

type PersonCards = { person: PersonListItem; cards: Awaited<ReturnType<typeof listCards>> };
const listCards = (personId: string) => call("cards.forEntity", { personId });

const KIND = { deal: "Negócio", ticket: "Ticket", project: "Projeto" } as const;

export function ChatSection({
  targetId,
  onPick,
  onNewCard,
  onContact,
}: {
  targetId: string | null;
  onPick: (cardId: string) => void;
  /** Abre o formulário de novo cartão já com o contato. */
  onNewCard: (person: { id: string; label: string }) => void;
  /** Contato da conversa (para os formulários). */
  onContact: (chat: OpenChat | null, person: PersonListItem | null) => void;
}) {
  const [chat, setChat] = useState<OpenChat | null | undefined>(undefined);
  const [matches, setMatches] = useState<PersonCards[]>([]);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    setStatus(null);
    try {
      const c = await readActiveWhatsAppChat();
      setChat(c);
      if (!c?.open || !c.phone) {
        setMatches([]);
        onContact(c, null);
        return;
      }
      const persons = await call("persons.findByPhone", { phone: c.phone });
      setMatches(await Promise.all(persons.map(async (person) => ({ person, cards: await listCards(person.id) }))));
      onContact(c, persons[0] ?? null);
    } catch (e) {
      setChat(null);
      setStatus({ text: errText(e), kind: "err" });
    }
  }, [onContact]);

  useEffect(() => {
    void load();
  }, [load]);

  if (chat === undefined) return null;
  if (chat === null) {
    return (
      <Section title="WhatsApp" icon={<MessageCircle size={16} />}>
        <p className="text-theme-xs text-gray-500">Abra o WhatsApp Web nesta aba para identificar o contato da conversa automaticamente.</p>
        <StatusText status={status} />
      </Section>
    );
  }

  const createContact = async () => {
    try {
      const name = chat.name || chat.phone || "Contato do WhatsApp";
      await call("persons.create", { name, phone: chat.phone });
      await load();
      setStatus({ text: `Contato "${name}" cadastrado.`, kind: "ok" });
    } catch (e) {
      setStatus({ text: errText(e), kind: "err" });
    }
  };

  return (
    <Section
      title="Conversa no WhatsApp"
      icon={<MessageCircle size={16} />}
      aside={
        <button type="button" title="Ler a conversa de novo" className="text-gray-400 hover:text-brand-600" onClick={() => void load()}>
          <RefreshCw size={14} />
        </button>
      }
    >
      {!chat.open ? (
        <p className="text-theme-xs text-gray-500">Nenhuma conversa aberta. Clique em uma conversa no WhatsApp Web.</p>
      ) : (
        <>
          <p className="text-theme-sm text-gray-800 dark:text-white/90">
            <b>{chat.name ?? "Contato sem nome"}</b>
            {chat.phone && <span className="text-gray-500"> · {chat.phone}</span>}
          </p>
          {!chat.phone && (
            <p className="mt-1 text-theme-xs text-gray-500">Telefone não visível: abra "Dados do contato" no WhatsApp e clique em ↻.</p>
          )}
          {chat.phone && matches.length === 0 && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/5">
              <span className="text-theme-xs text-gray-600">Contato não cadastrado no CRM.</span>
              <TaButton size="sm" startIcon={<UserPlus size={14} />} onClick={() => void createContact()}>
                Cadastrar contato
              </TaButton>
            </div>
          )}
          {matches.map(({ person, cards }) => (
            <div key={person.id} className="mt-2">
              <p className="mb-1 flex items-center justify-between text-theme-xs text-gray-500">
                <span>
                  Contato: <b className="text-gray-700 dark:text-gray-300">{person.name}</b>
                  {person.primary_organization_name && ` · ${person.primary_organization_name}`}
                </span>
                <button type="button" className="text-brand-600 hover:underline" onClick={() => onNewCard({ id: person.id, label: person.name })}>
                  + Novo
                </button>
              </p>
              {cards.length === 0 && <p className="text-theme-xs text-gray-400">Nenhum negócio, ticket ou projeto.</p>}
              <ul className="space-y-1">
                {cards.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onPick(c.id)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-theme-xs ${
                        c.id === targetId ? "border-brand-300 bg-brand-50" : "border-gray-200 hover:bg-gray-50 dark:border-gray-800"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-gray-800 dark:text-white/90">{c.title}</span>
                        <span className="block truncate text-gray-500">
                          {KIND[c.kind]} · {c.pipeline_name} › {c.stage_name}
                        </span>
                      </span>
                      {c.status !== "open" && <TaBadge color={c.status === "won" ? "green" : "red"} label={c.status === "won" ? "Ganho" : "Perdido"} />}
                      {c.kind === "deal" && c.value_cents > 0 && <span className="text-gray-600">{formatCents(c.value_cents)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
      <StatusText status={status} />
    </Section>
  );
}
