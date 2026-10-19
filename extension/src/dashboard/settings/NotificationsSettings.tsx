// Configurações → Notificações (spec 10): canais do usuário atual (Chrome,
// e-mail pela conta Gmail/Outlook conectada, WhatsApp pelo WhatsApp Web ou CallMeBot), com
// botão de teste; lembretes padrão das atividades novas, resumo diário,
// aviso de atrasadas e horário de silêncio. Ficam neste computador.
import { useEffect, useState } from "react";
import { Bell, CheckCircle2, ExternalLink, Mail, MessageCircle, Send, Unplug } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaPanel, TaSelect, cn } from "@tailadmin";
import { connectMailSender, googleClientConfigured, sendMail, type CalendarProvider } from "../../lib/calendar";
import { CALLMEBOT_HELP, CALLMEBOT_ORIGIN, sendCallMeBot } from "../../lib/notify/callmebot";
import { sendViaWhatsAppWeb } from "../../lib/notify/waweb";
import {
  CHANNEL_LABEL,
  ACTIVE_CHANNELS,
  EMAIL_CHANNEL_ENABLED,
  channelReady,
  loadAllNotifySettings,
  loadMailSender,
  loadNotifySettings,
  saveMailSender,
  saveNotifySettings,
  type Channel,
  type MailSender,
  type NotifySettings,
  type WhatsAppVia,
} from "../../lib/notify/settings";
import { errorText } from "../../lib/errors";
import { useSession } from "../session";
import { Field } from "../ui/form";
import { RemindersEditor } from "../ui/RemindersEditor";

const MAIL_LABEL: Record<CalendarProvider, string> = { google: "Gmail", microsoft: "Outlook" };

type Msg = { text: string; kind: "ok" | "err" } | null;

async function askCallMeBotPermission(): Promise<boolean> {
  if (await chrome.permissions.contains({ origins: [CALLMEBOT_ORIGIN] })) return true;
  return chrome.permissions.request({ origins: [CALLMEBOT_ORIGIN] });
}

function ChannelChips({ value, onChange, label }: { value: Channel[]; onChange: (v: Channel[]) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {ACTIVE_CHANNELS.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={cn(
              "h-7 rounded-full border px-2.5 text-theme-xs",
              on ? "border-brand-300 bg-brand-50 text-brand-700 dark:bg-brand-500/15" : "border-gray-200 text-gray-400 dark:border-gray-700",
            )}
          >
            {CHANNEL_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p
      className={`mt-2 rounded-lg px-3 py-2 text-theme-sm ${msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700"}`}
      data-notify-msg
    >
      {msg.text}
    </p>
  );
}

const Toggle = ({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) => (
  <label className="flex items-center gap-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {children}
  </label>
);

export function NotificationsSettings() {
  const { user, users, label } = useSession();
  const [s, setS] = useState<NotifySettings | null>(null);
  const [sender, setSender] = useState<MailSender | null>(null);
  const [all, setAll] = useState<Record<string, NotifySettings>>({});
  const [dirty, setDirty] = useState(false);
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [provider, setProvider] = useState<CalendarProvider>("google");
  const [waTab, setWaTab] = useState<boolean | null>(null);

  useEffect(() => {
    void loadNotifySettings(user.id).then((x) => setS({ ...x, email: { ...x.email, to: x.email.to || user.email || "" } }));
    void loadMailSender().then(setSender);
    void loadAllNotifySettings().then(setAll);
    void chrome.tabs.query({ url: "https://web.whatsapp.com/*" }).then((t) => setWaTab(t.length > 0));
  }, [user.id, user.email]);
  if (!s) return null;

  const patch = (p: Partial<NotifySettings>) => {
    setS({ ...s, ...p });
    setDirty(true);
  };
  const note = (k: string, m: Msg) => setMsgs((x) => ({ ...x, [k]: m }));

  const save = async () => {
    setBusy("save");
    try {
      // A permissão do CallMeBot precisa do clique do usuário: pedida aqui.
      if (s.whatsapp.enabled && s.whatsapp.via === "callmebot" && !(await askCallMeBotPermission()))
        throw new Error("Sem a permissão de acesso ao CallMeBot o WhatsApp não funciona.");
      await saveNotifySettings(user.id, s);
      setAll(await loadAllNotifySettings());
      setDirty(false);
      note("save", { text: "Preferências salvas.", kind: "ok" });
    } catch (e) {
      note("save", { text: errorText(e), kind: "err" });
    } finally {
      setBusy(null);
    }
  };

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    note(key, null);
    try {
      note(key, { text: await fn(), kind: "ok" });
    } catch (e) {
      note(key, { text: errorText(e), kind: "err" });
    } finally {
      setBusy(null);
    }
  };

  const testChrome = () =>
    run("chrome", async () => {
      await chrome.notifications.create(`notify:teste:${Date.now()}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "ConectCRM: teste de notificação",
        message: "Se você está vendo isto, os lembretes do Chrome estão funcionando.",
        priority: 2,
      });
      return "Notificação enviada. Se não apareceu, confira se o Chrome tem permissão de notificações no sistema (Windows: Configurações → Notificações; macOS: Ajustes → Notificações → Google Chrome).";
    });

  const connectSender = () =>
    run("sender", async () => {
      const address = await connectMailSender(provider);
      const next = { provider, address };
      await saveMailSender(next);
      setSender(next);
      return `E-mails sairão de ${address} (${MAIL_LABEL[provider]}).`;
    });

  const testEmail = () =>
    run("email", async () => {
      if (!sender) throw new Error("Conecte primeiro a conta que envia os e-mails.");
      if (!s.email.to.trim()) throw new Error("Informe o e-mail que recebe os avisos.");
      await sendMail(
        sender.provider,
        {
          to: s.email.to.trim(),
          subject: "ConectCRM: teste de notificação",
          html: "<p>Se você recebeu este e-mail, os lembretes por e-mail do ConectCRM estão funcionando.</p>",
        },
        true,
      );
      return `E-mail de teste enviado para ${s.email.to.trim()}.`;
    });

  const testWhatsapp = () =>
    run("whatsapp", async () => {
      if (!s.whatsapp.phone.trim()) throw new Error("Informe o número que recebe os avisos.");
      if (s.whatsapp.via === "web") {
        await sendViaWhatsAppWeb(s.whatsapp.phone, "ConectCRM: teste de notificação. Os lembretes pelo WhatsApp estão funcionando.", 15_000);
        setWaTab(true);
        return `Mensagem enviada pelo WhatsApp Web para ${s.whatsapp.phone}.`;
      }
      if (!s.whatsapp.apikey.trim()) throw new Error("Informe a chave (apikey) do CallMeBot.");
      if (!(await askCallMeBotPermission())) throw new Error("Sem a permissão de acesso ao CallMeBot o WhatsApp não funciona.");
      await sendCallMeBot(s.whatsapp.phone, s.whatsapp.apikey, "ConectCRM: teste de notificação. Os lembretes pelo WhatsApp estão funcionando.");
      return "Mensagem enviada. Pode levar alguns segundos para chegar.";
    });

  const ready = Object.fromEntries(ACTIVE_CHANNELS.map((c) => [c, channelReady(s, c)])) as Record<Channel, boolean>;

  return (
    <div className="space-y-5" data-notify-settings>
      <TaPanel
        title="Notificações"
        subtitle="Como você quer ser avisado das suas atividades. As preferências são do seu usuário e ficam neste computador (a chave do WhatsApp não vai para o backup)."
      >
        <p className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-theme-xs text-gray-600 dark:bg-white/5 dark:text-gray-400">
          Os avisos são enviados pelo ConectCRM enquanto o Chrome está aberto neste computador. Se o Chrome ficar fechado, ao reabrir chega um resumo único do
          que passou.
        </p>

        {/* Chrome */}
        <section className="border-t border-gray-100 py-4 dark:border-gray-800" data-channel="chrome">
          <div className="flex items-center justify-between gap-3">
            <Toggle checked={s.chrome} onChange={(v) => patch({ chrome: v })}>
              <Bell size={16} className="text-brand-500" /> Notificação no Chrome
            </Toggle>
            <TaButton size="sm" startIcon={<Send size={14} />} disabled={busy === "chrome"} onClick={() => void testChrome()}>
              Testar
            </TaButton>
          </div>
          <p className="ml-6 mt-1 text-theme-xs text-gray-500">Aviso na tela com os botões Concluir e Adiar 10 min.</p>
          <Note msg={msgs.chrome ?? null} />
        </section>

        {EMAIL_CHANNEL_ENABLED && (
          <>
            {/* E-mail */}
            <section className="border-t border-gray-100 py-4 dark:border-gray-800" data-channel="email">
              <div className="flex items-center justify-between gap-3">
                <Toggle checked={s.email.enabled} onChange={(v) => patch({ email: { ...s.email, enabled: v } })}>
                  <Mail size={16} className="text-brand-500" /> E-mail
                </Toggle>
                <TaButton size="sm" startIcon={<Send size={14} />} disabled={busy === "email" || !sender} onClick={() => void testEmail()}>
                  Testar
                </TaButton>
              </div>
              <div className="ml-6 mt-3 grid gap-x-4 md:grid-cols-2">
                <Field label="Receber no e-mail">
                  <TaInput
                    type="email"
                    value={s.email.to}
                    placeholder="voce@empresa.com.br"
                    aria-label="E-mail que recebe os avisos"
                    onChange={(e) => patch({ email: { ...s.email, to: e.target.value } })}
                  />
                </Field>
                <Field label="Enviado pela conta" hint="A conta Gmail ou Outlook deste computador que envia os avisos.">
                  {sender ? (
                    <div className="flex h-10 items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300" data-mail-sender>
                      <CheckCircle2 size={15} className="text-success-500" />
                      <span className="min-w-0 flex-1 truncate">
                        {sender.address} · {MAIL_LABEL[sender.provider]}
                      </span>
                      <TaButton
                        size="sm"
                        variant="ghost"
                        title="Desconectar"
                        onClick={async () => {
                          await saveMailSender(null);
                          setSender(null);
                        }}
                      >
                        <Unplug size={14} />
                      </TaButton>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <TaSelect value={provider} onChange={(e) => setProvider(e.target.value as CalendarProvider)} aria-label="Provedor de e-mail">
                        <option value="google">Gmail</option>
                        <option value="microsoft">Outlook / Microsoft 365</option>
                      </TaSelect>
                      <TaButton disabled={busy === "sender"} onClick={() => void connectSender()}>
                        Conectar
                      </TaButton>
                    </div>
                  )}
                </Field>
              </div>
              {!sender && provider === "google" && !googleClientConfigured() && (
                <p className="ml-6 text-theme-xs text-warning-700">
                  O login Google desta instalação ainda não foi configurado pelo administrador (client_id do Google no manifesto). Use Outlook ou peça a
                  configuração.
                </p>
              )}
              {!sender && provider === "microsoft" && (
                <p className="ml-6 text-theme-xs text-gray-500">
                  Quem já tinha conectado o Outlook para a agenda vai autorizar de novo, agora com a permissão de enviar e-mail.
                </p>
              )}
              <div className="ml-6">
                <Note msg={msgs.sender ?? null} />
                <Note msg={msgs.email ?? null} />
              </div>
            </section>
          </>
        )}

        {/* WhatsApp */}
        <section className="border-t border-gray-100 py-4 dark:border-gray-800" data-channel="whatsapp">
          <div className="flex items-center justify-between gap-3">
            <Toggle checked={s.whatsapp.enabled} onChange={(v) => patch({ whatsapp: { ...s.whatsapp, enabled: v } })}>
              <MessageCircle size={16} className="text-success-600" /> WhatsApp
            </Toggle>
            <TaButton size="sm" startIcon={<Send size={14} />} disabled={busy === "whatsapp"} onClick={() => void testWhatsapp()}>
              Testar
            </TaButton>
          </div>
          <div className="ml-6 mt-3 grid gap-x-4 md:grid-cols-2">
            <Field label="Enviar pelo">
              <TaSelect
                value={s.whatsapp.via}
                aria-label="Forma de envio do WhatsApp"
                onChange={(e) => patch({ whatsapp: { ...s.whatsapp, via: e.target.value as WhatsAppVia } })}
              >
                <option value="web">WhatsApp Web aberto neste Chrome</option>
                <option value="callmebot">CallMeBot (serviço gratuito)</option>
              </TaSelect>
            </Field>
            <Field label="Número que recebe os avisos" hint="Com DDD. Sem o +55, assume Brasil.">
              <TaInput
                value={s.whatsapp.phone}
                placeholder="(41) 99999-8888"
                aria-label="Número do WhatsApp"
                onChange={(e) => {
                  patch({ whatsapp: { ...s.whatsapp, phone: e.target.value } });
                  note("whatsapp", null);
                }}
              />
            </Field>
          </div>
          {s.whatsapp.via === "web" ? (
            <div className="ml-6 space-y-1.5 text-theme-xs text-gray-600 dark:text-gray-400" data-waweb>
              <p className="flex flex-wrap items-center gap-2">
                {waTab === null ? null : waTab ? (
                  <span className="inline-flex items-center gap-1 text-success-700">
                    <CheckCircle2 size={13} /> WhatsApp Web aberto neste Chrome
                  </span>
                ) : (
                  <>
                    <span className="text-warning-700">WhatsApp Web não está aberto neste Chrome.</span>
                    <button
                      type="button"
                      className="font-medium text-brand-600 hover:underline"
                      onClick={async () => {
                        await chrome.tabs.create({ url: "https://web.whatsapp.com/", pinned: true, active: false });
                        setWaTab(true);
                      }}
                    >
                      Abrir em aba fixa
                    </button>
                  </>
                )}
              </p>
              <p>
                A mensagem sai do número conectado no WhatsApp Web e chega no número acima como uma conversa normal, com notificação no celular. Deixe o
                WhatsApp Web aberto (de preferência numa aba fixa). Use um número diferente do conectado: mensagem para você mesmo não toca no celular.
              </p>
              <p>
                Para evitar bloqueios do WhatsApp, salve os dois números nos contatos um do outro e troque uma mensagem antes. Use só para lembretes, nunca para
                enviar mensagens a clientes. As mensagens ficam no histórico do WhatsApp conectado.
              </p>
            </div>
          ) : (
            <>
              <ol className="ml-10 list-decimal space-y-0.5 text-theme-xs text-gray-600 dark:text-gray-400">
                <li>Abra as instruções do CallMeBot (link abaixo) e salve o número do serviço nos contatos do celular que vai receber os avisos.</li>
                <li>
                  Envie para ele pelo WhatsApp a mensagem:{" "}
                  <code className="rounded bg-gray-100 px-1 dark:bg-white/10">I allow callmebot to send me messages</code>
                </li>
                <li>Você recebe uma chave (apikey). Cole abaixo e clique em Testar.</li>
              </ol>
              <a
                href={CALLMEBOT_HELP}
                target="_blank"
                rel="noopener"
                className="ml-6 mt-1 inline-flex items-center gap-1 text-theme-xs text-brand-600 hover:underline"
              >
                Instruções do CallMeBot <ExternalLink size={12} />
              </a>
              <div className="ml-6 mt-3 grid gap-x-4 md:grid-cols-2">
                <Field label="Chave (apikey)">
                  <TaInput
                    type="password"
                    autoComplete="off"
                    value={s.whatsapp.apikey}
                    placeholder="123456"
                    aria-label="Chave do CallMeBot"
                    onChange={(e) => patch({ whatsapp: { ...s.whatsapp, apikey: e.target.value } })}
                  />
                </Field>
              </div>
              <p className="ml-6 text-theme-xs text-gray-500">
                O CallMeBot é um serviço gratuito de terceiros, só envia para o número que fez a ativação e às vezes fica sem vagas para novos números.
              </p>
            </>
          )}
          <div className="ml-6">
            <Note msg={msgs.whatsapp ?? null} />
          </div>
        </section>
      </TaPanel>

      <TaPanel
        title="Lembretes das atividades"
        subtitle="Vêm preenchidos em toda atividade nova; em cada atividade você pode mudar, incluir ou tirar lembretes."
      >
        <RemindersEditor value={s.defaults} ready={ready} onChange={(defaults) => patch({ defaults })} />
        {EMAIL_CHANNEL_ENABLED && (
          <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
            <Toggle checked={s.calendarEmailBackup} onChange={(v) => patch({ calendarEmailBackup: v })}>
              Reserva no Google Agenda
            </Toggle>
            <p className="ml-6 mt-1 text-theme-xs text-gray-500">
              Reuniões criadas no Google Agenda levam também os lembretes por e-mail do próprio Google, que chegam mesmo com o Chrome fechado.
            </p>
          </div>
        )}
      </TaPanel>

      <TaPanel title="Resumo e atrasos">
        <div className="space-y-4">
          <div data-digest>
            <Toggle checked={s.digest.enabled} onChange={(v) => patch({ digest: { ...s.digest, enabled: v } })}>
              Resumo diário da agenda
            </Toggle>
            <p className="ml-6 mt-1 text-theme-xs text-gray-500">Uma vez por dia: as atividades de hoje e as que estão atrasadas.</p>
            <div className="ml-6 mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                às
                <TaInput
                  type="time"
                  className="w-28"
                  value={s.digest.time}
                  aria-label="Horário do resumo"
                  onChange={(e) => patch({ digest: { ...s.digest, time: e.target.value } })}
                />
              </label>
              <ChannelChips label="Canais do resumo" value={s.digest.channels} onChange={(channels) => patch({ digest: { ...s.digest, channels } })} />
            </div>
          </div>
          <div data-overdue>
            <Toggle checked={s.overdue.enabled} onChange={(v) => patch({ overdue: { ...s.overdue, enabled: v } })}>
              Avisar quando uma atividade ficar atrasada
            </Toggle>
            <div className="ml-6 mt-2">
              <ChannelChips
                label="Canais do aviso de atraso"
                value={s.overdue.channels}
                onChange={(channels) => patch({ overdue: { ...s.overdue, channels } })}
              />
            </div>
          </div>
          <div data-quiet>
            <Toggle checked={s.quiet.enabled} onChange={(v) => patch({ quiet: { ...s.quiet, enabled: v } })}>
              Horário de silêncio
            </Toggle>
            <div className="ml-6 mt-2 flex flex-wrap items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
              das
              <TaInput
                type="time"
                className="w-28"
                value={s.quiet.from}
                aria-label="Silêncio a partir de"
                onChange={(e) => patch({ quiet: { ...s.quiet, from: e.target.value } })}
              />
              às
              <TaInput
                type="time"
                className="w-28"
                value={s.quiet.to}
                aria-label="Silêncio até"
                onChange={(e) => patch({ quiet: { ...s.quiet, to: e.target.value } })}
              />
            </div>
            <p className="ml-6 mt-1 text-theme-xs text-gray-500">Chrome e WhatsApp ficam em silêncio nesse período{EMAIL_CHANNEL_ENABLED ? "; o e-mail é enviado normalmente" : ""}.</p>
          </div>
        </div>
      </TaPanel>

      <div className="sticky bottom-0 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <TaButton variant="primary" disabled={busy === "save" || !dirty} onClick={() => void save()}>
          Salvar preferências
        </TaButton>
        {dirty && <span className="text-theme-xs text-warning-700">Alterações não salvas</span>}
        <div className="flex-1">
          <Note msg={msgs.save ?? null} />
        </div>
      </div>

      {user.role === "admin" && (
        <TaPanel title="Usuários deste computador" subtitle="Quem já configurou os canais de aviso aqui.">
          <table className="w-full text-theme-sm" data-notify-users>
            <thead>
              <tr className="text-left text-theme-xs text-gray-500">
                <th className="py-1.5 font-medium">Usuário</th>
                {ACTIVE_CHANNELS.map((c) => (
                  <th key={c} className="py-1.5 font-medium">
                    {CHANNEL_LABEL[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users
                .filter((u) => u.active)
                .map((u) => {
                  const us = all[u.id];
                  return (
                    <tr key={u.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-1.5 text-gray-800 dark:text-white/90">{label(u)}</td>
                      {ACTIVE_CHANNELS.map((c) => (
                        <td key={c} className="py-1.5">
                          {us ? (
                            <TaBadge color={channelReady(us, c) ? "green" : "slate"} label={channelReady(us, c) ? "Ativo" : "Desligado"} />
                          ) : (
                            <span className="text-theme-xs text-gray-400">{c === "chrome" ? "Padrão" : "Não configurado"}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </TaPanel>
      )}
    </div>
  );
}
