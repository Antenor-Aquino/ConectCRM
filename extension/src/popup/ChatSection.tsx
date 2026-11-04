// Conversa aberta no WhatsApp Web: identifica o contato pelo telefone e
// mostra os cartões dele para escolher o destino com um clique.
import { OUTCOME_TEXT, PIPELINE_TYPE_BY_KIND } from "../lib/cardTypes";
import { useCallback, useEffect, useState } from "react";
import { MessageCircle, RefreshCw, UserPlus } from "lucide-react";
import { TaBadge, TaButton } from "@tailadmin";
import { call } from "../rpc/client";
import type { PersonListItem } from "../db/contacts";
import type { SimilarItem } from "../db/similar";
import { formatCents } from "../lib/format";
import { PHONE_SOURCE_LABEL, readActiveWhatsAppChat, type OpenChat } from "../lib/whatsapp";
import { errText, Section, StatusText, type Status } from "./ui";

type PersonCards = { person: PersonListItem; cards: Awaited<ReturnType<typeof listCards>> };
const listCards = (personId: string) => call("cards.forEntity", { personId });

const KIND = { deal: "Negócio", ticket: "Ticket", project: "Projeto" } as const;
const inputCls =
  "mt-0.5 h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-theme-sm text-gray-800 focus:border-brand-300 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

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
  // Telefone não cadastrado: contatos com nome parecido (pode ser a mesma pessoa).
  const [similar, setSimilar] = useState<SimilarItem[]>([]);
  const [status, setStatus] = useState<Status>(null);
  /** Número escolhido (quando a conversa mostra mais de um, o usuário escolhe). */
  const [phone, setPhone] = useState<string | null>(null);
  /** Cadastro do contato aberto: nome e número editáveis antes de salvar. */
  const [draft, setDraft] = useState<{ name: string; phone: string } | null>(null);

  const match = useCallback(
    async (c: OpenChat, p: string | null) => {
      setPhone(p);
      setDraft(null);
      if (!c.open || !p) {
        setMatches([]);
        onContact(c, null);
        return;
      }
      const persons = await call("persons.findByPhone", { phone: p });
      setMatches(await Promise.all(persons.map(async (person) => ({ person, cards: await listCards(person.id) }))));
      setSimilar(!persons.length && c.name ? await call("similar.persons", { name: c.name }) : []);
      onContact({ ...c, phone: p }, persons[0] ?? null);
    },
    [onContact],
  );

  const load = useCallback(async () => {
    setStatus(null);
    try {
      const c = await readActiveWhatsAppChat();
      setChat(c);
      if (!c) return onContact(c, null);
      await match(c, c.phone);
    } catch (e) {
      setChat(null);
      setStatus({ text: errText(e), kind: "err" });
    }
  }, [match, onContact]);

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

  const createContact = async (d: { name: string; phone: string }) => {
    try {
      const name = d.name.trim() || d.phone || "Contato do WhatsApp";
      await call("persons.create", { name, phone: d.phone.trim() });
      await match(chat, d.phone.trim());
      setStatus({ text: `Contato "${name}" cadastrado com o número ${d.phone.trim()}.`, kind: "ok" });
    } catch (e) {
      setStatus({ text: errText(e), kind: "err" });
    }
  };
  const candidates = chat.candidates ?? [];

  // "É este": grava o telefone da conversa no contato parecido (anti-duplicidade).
  const pickSimilarContact = async (p: SimilarItem) => {
    try {
      const current = await call("persons.get", { id: p.id });
      if (current?.phone && !window.confirm(`${p.name} já tem o telefone ${current.phone}. Trocar por ${phone}?`)) return;
      await call("persons.update", { id: p.id, patch: { phone } });
      await match(chat, phone);
      setStatus({ text: `Telefone gravado em "${p.name}".`, kind: "ok" });
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
            {phone && <span className="text-gray-500"> · {phone}</span>}
          </p>
          {!phone && (
            <p className="mt-1 text-theme-xs text-gray-500">Telefone não visível: abra "Dados do contato" no WhatsApp e clique em ↻.</p>
          )}
          {candidates.length > 1 && (
            <div className="mt-2 rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-800" data-phone-choice>
              <p className="mb-1 font-medium">Esta conversa mostra números diferentes. Qual é o do contato?</p>
              {candidates.map((c) => (
                <label key={c.phone} className="flex items-center gap-2 py-0.5">
                  <input type="radio" name="wa-phone" checked={phone === c.phone} onChange={() => void match(chat, c.phone)} />
                  <span>
                    <b>{c.phone}</b> <span className="text-warning-700">· {PHONE_SOURCE_LABEL[c.source]}</span>
                  </span>
                </label>
              ))}
              {!candidates.some((c) => c.source === "painel") && (
                <p className="mt-1">Dica: abra "Dados do contato" no WhatsApp e clique em ↻ — o número de lá é o atual.</p>
              )}
            </div>
          )}
          {candidates.length === 1 && candidates[0]!.source === "conversa" && (
            <p className="mt-1 text-theme-xs text-gray-500" data-phone-unconfirmed>
              Número lido do código das mensagens (pode ser um número antigo). Para confirmar, abra "Dados do contato" no WhatsApp e clique em ↻.
            </p>
          )}
          {phone && matches.length === 0 && !draft && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/5">
              <span className="text-theme-xs text-gray-600">Contato não cadastrado no CRM.</span>
              <TaButton size="sm" startIcon={<UserPlus size={14} />} onClick={() => setDraft({ name: chat.name ?? "", phone })}>
                Cadastrar contato
              </TaButton>
            </div>
          )}
          {draft && (
            <div className="mt-2 space-y-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800" data-new-contact>
              <label className="block text-theme-xs text-gray-600">
                Nome
                <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="block text-theme-xs text-gray-600">
                Celular (WhatsApp) — confira antes de salvar
                <input className={inputCls} value={draft.phone} data-new-contact-phone onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              </label>
              <div className="flex justify-end gap-2">
                <TaButton size="sm" onClick={() => setDraft(null)}>
                  Cancelar
                </TaButton>
                <TaButton size="sm" variant="primary" disabled={!draft.phone.replace(/\D/g, "")} onClick={() => void createContact(draft)}>
                  Salvar contato
                </TaButton>
              </div>
            </div>
          )}
          {phone && matches.length === 0 && similar.length > 0 && (
            <div className="mt-2 rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-800">
              <p className="mb-1 font-medium">Possível duplicidade: contato com nome parecido.</p>
              <ul className="space-y-1">
                {similar.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      <b>{p.name}</b> · {[`${p.score}% parecido`, ...p.details].join(" · ")}
                    </span>
                    <button type="button" className="shrink-0 font-medium text-brand-600 hover:underline" onClick={() => void pickSimilarContact(p)}>
                      É este
                    </button>
                  </li>
                ))}
              </ul>
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
                      {c.status !== "open" && <TaBadge color={c.status === "won" ? "green" : "red"} label={OUTCOME_TEXT[PIPELINE_TYPE_BY_KIND[c.kind]][c.status]} />}
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
