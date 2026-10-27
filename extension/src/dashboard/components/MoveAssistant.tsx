// Assistente de mudança de instalação: abre sozinho quando o banco veio de
// outra instalação (outra pasta, outro computador, backup restaurado) e pode
// ser aberto em Configurações → Backup. Cada passo mostra a situação real e
// tem a ação no próprio lugar; "Concluir" registra esta instalação.
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, CircleAlert, FileUp, FolderOpen, Link2, MinusCircle } from "lucide-react";
import { TaButton, TaModal, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { loadAutoBackupSettings, saveAutoBackupSettings } from "../../lib/autoBackup";
import { loadBackupFolderHandle, pickBackupFolder } from "../../lib/backupFolder";
import { docBackupFolder, loadDocBackupSettings } from "../../lib/docBackup";
import { documentsFolderStatus } from "../../lib/fileStore";
import { checkDocuments, chooseDocumentsFolder } from "../../lib/locateDocuments";
import { gfIntegrationActive, loadGfSettings, ping } from "../../lib/finance/gfBridge";
import { importSettings, parseSettingsFile, SETTINGS_BACKUP_FILE } from "../../lib/settingsTransfer";
import { errorText } from "../../lib/errors";
import type { Section as SettingsSection } from "../settings/SettingsView";

/** Abre o assistente de qualquer tela (ex.: Configurações → Backup). */
export const MOVE_ASSISTANT_EVENT = "conectcrm:move-assistant";
/** Configurações já importadas nesta mudança (vale até concluir o assistente). */
const IMPORTED_KEY = "conectcrm-move-settings-imported";

type State = "ok" | "todo" | "warn" | "skip";
interface Step {
  id: string;
  title: string;
  state: State;
  detail: string;
}

const ICON: Record<State, React.ReactNode> = {
  ok: <CheckCircle2 size={18} className="text-success-600" />,
  todo: <Circle size={18} className="text-gray-400" />,
  warn: <CircleAlert size={18} className="text-warning-600" />,
  skip: <MinusCircle size={18} className="text-gray-400" />,
};

async function readStatus(settingsImported: boolean): Promise<Step[]> {
  const [folder, check, dbHandle, auto, docs, gf] = await Promise.all([
    documentsFolderStatus(),
    checkDocuments().catch(() => null),
    loadBackupFolderHandle().catch(() => null),
    loadAutoBackupSettings(),
    loadDocBackupSettings(),
    loadGfSettings(),
  ]);
  const docsHandle = await docBackupFolder(docs);
  const files = await call("files.locateList");
  const inFolder = files.filter((f) => f.location === "folder").length;
  let gfOk: boolean | null = null;
  if (gf.gfId && gf.direct) gfOk = await ping(gf.gfId).then(() => true, () => false);

  return [
    {
      id: "settings",
      title: "Configurações",
      state: settingsImported ? "ok" : "todo",
      detail: settingsImported
        ? "Importadas."
        : `Notificações, sons, números de WhatsApp, IA e backups ficam fora do banco. Importe o "${SETTINGS_BACKUP_FILE}" da pasta de backup (ou o configuracoes.json de uma cópia .zip).`,
    },
    {
      id: "docs",
      title: "Pasta de documentos",
      state: !files.length ? "skip" : check && !check.missing.length && check.noAccess === 0 ? "ok" : "warn",
      detail: !files.length
        ? "Nenhum documento no GED."
        : !folder.configured && inFolder
          ? `${inFolder} arquivo(s) estavam numa pasta do computador. Escolha onde essa pasta está agora: o CRM reencontra cada arquivo pelo conteúdo.`
          : check?.missing.length
            ? `${check.missing.length} de ${check.total} arquivo(s) não encontrados. Escolha a pasta de documentos (ou use Configurações → Documentos → Buscar no backup).`
            : folder.configured && folder.permission !== "granted"
              ? `Pasta "${folder.name}": falta conceder acesso.`
              : `Todos os ${check?.total ?? files.length} arquivo(s) no lugar${folder.configured ? ` (pasta "${folder.name}")` : " (no navegador)"}.`,
    },
    {
      id: "dbBackup",
      title: "Pasta do backup do banco",
      state: dbHandle ? "ok" : auto.enabled ? "warn" : "todo",
      detail: dbHandle ? `Pasta "${dbHandle.name}".` : "Escolha a pasta onde ficam os backups (de preferência a mesma de antes, para manter o histórico).",
    },
    {
      id: "docBackup",
      title: "Backup dos documentos",
      state: !docs.enabled ? "todo" : docsHandle ? "ok" : "warn",
      detail: !docs.enabled
        ? "Desativado. Ative em Configurações → Backup e ambiente."
        : docsHandle
          ? `Em "${docsHandle.name}".`
          : docs.ownFolder
            ? "Usa uma pasta própria: escolha-a em Configurações → Backup e ambiente."
            : "Usa a pasta do backup do banco: escolha-a no passo acima.",
    },
    {
      id: "gf",
      title: "Gestão Financeira",
      state: !gfIntegrationActive(gf) ? "skip" : gf.package || gfOk ? "ok" : "warn",
      detail: !gfIntegrationActive(gf)
        ? "Integração não usada."
        : gf.package && !gf.gfId
          ? "Modo pacote de arquivo: nada a fazer."
          : gfOk
            ? "Conectada."
            : "Não respondeu: a Gestão Financeira também mudou de instalação ou está desativada. Conecte de novo em Configurações → Integrações.",
    },
    {
      id: "accounts",
      title: "Contas e serviços",
      state: "todo",
      detail:
        "Confira o que depende desta instalação: Google Agenda e Gmail, Outlook (reconectar), WhatsApp Web (abrir uma vez neste Chrome) e, se as configurações vieram sem senhas, as chaves de IA e da Z-API.",
    },
  ];
}

export function MoveAssistant({
  previousId,
  onClose,
  onDone,
  onGo,
}: {
  /** ID da instalação de onde o banco veio (null = aberto à mão). */
  previousId: string | null;
  /** Fechar sem concluir (volta na próxima abertura). */
  onClose: () => void;
  onDone: () => void;
  onGo: (section: SettingsSection) => void;
}) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [imported, setImported] = useState(false);
  useEffect(() => {
    void chrome.storage.local.get(IMPORTED_KEY).then((r) => setImported(!!r[IMPORTED_KEY]));
  }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => readStatus(imported).then(setSteps), [imported]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (id: string, fn: () => Promise<string | null | void>) => {
    setBusy(id);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ text, kind: "ok" });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(null);
      await refresh();
    }
  };
  const applySettings = async (text: string) => {
    const labels = await importSettings(parseSettingsFile(text));
    await chrome.storage.local.set({ [IMPORTED_KEY]: true });
    setImported(true);
    return `Configurações importadas: ${labels.join(", ")}.`;
  };

  const action = (s: Step): React.ReactNode => {
    const b = (label: string, icon: React.ReactNode, fn: () => Promise<string | null | void>) => (
      <TaButton size="sm" startIcon={icon} disabled={!!busy} data-move-action={s.id} onClick={() => void run(s.id, fn)}>
        {label}
      </TaButton>
    );
    switch (s.id) {
      case "settings":
        return (
          <div className="flex flex-wrap gap-2">
            {b("Da pasta de backup", <FolderOpen size={14} />, async () => {
              const h = await loadBackupFolderHandle().catch(() => null);
              if (!h) throw new Error("Escolha primeiro a pasta do backup do banco (passo abaixo) ou importe o arquivo.");
              if ((await h.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("Acesso à pasta não concedido.");
              const f = await (await h.getFileHandle(SETTINGS_BACKUP_FILE).catch(() => {
                throw new Error(`"${SETTINGS_BACKUP_FILE}" não está na pasta "${h.name}". Ele é gravado a cada backup do banco a partir da 0.2.74.`);
              })).getFile();
              return applySettings(await f.text());
            })}
            {b("Importar arquivo…", <FileUp size={14} />, async () => fileInput.current?.click())}
          </div>
        );
      case "docs":
        return s.state === "ok" || s.state === "skip" ? null : b("Escolher a pasta de documentos", <FolderOpen size={14} />, chooseDocumentsFolder);
      case "dbBackup":
        return s.state === "ok"
          ? null
          : b("Escolher pasta", <FolderOpen size={14} />, async () => {
              const h = await pickBackupFolder();
              await saveAutoBackupSettings({ ...(await loadAutoBackupSettings()), folderName: h.name });
              return `Pasta "${h.name}" escolhida para o backup.`;
            });
      case "docBackup":
        return s.state === "ok" ? null : b("Abrir Backup", <Link2 size={14} />, async () => onGo("backup"));
      case "gf":
        return s.state === "warn" ? b("Abrir Integrações", <Link2 size={14} />, async () => onGo("integracoes")) : null;
      case "accounts":
        return b("Abrir Notificações", <Link2 size={14} />, async () => onGo("notificacoes"));
    }
    return null;
  };

  const pending = steps?.filter((s) => s.state === "warn" || (s.state === "todo" && s.id !== "accounts")).length ?? 0;
  return (
    <TaModal isOpen onClose={onClose} title="Assistente de mudança de instalação" width="max-w-2xl">
      <div data-move-assistant className="space-y-4">
        <p className="text-theme-sm text-gray-600 dark:text-gray-400">
          {previousId
            ? "Este banco veio de outra instalação do ConectCRM (outra pasta, outro computador ou um backup restaurado). Os dados estão aqui; o que fica preso à instalação precisa ser refeito:"
            : "Use depois de mudar a extensão de pasta, trocar de computador ou restaurar um backup:"}
        </p>
        <ol className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {(steps ?? []).map((s) => (
            <li key={s.id} className="flex gap-3 px-4 py-3" data-move-step={s.id} data-state={s.state}>
              <span className="mt-0.5 shrink-0">{ICON[s.state]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{s.title}</p>
                <p className="mt-0.5 text-theme-xs text-gray-500">{s.detail}</p>
                <div className="mt-2">{action(s)}</div>
              </div>
            </li>
          ))}
          {!steps && <li className="px-4 py-3 text-theme-sm text-gray-500">Conferindo…</li>}
        </ol>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void run("settings", async () => applySettings(await file.text()));
          }}
        />
        {msg && (
          <p data-move-msg className={cn("rounded-lg px-3 py-2 text-theme-sm", msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700")}>
            {msg.text}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <span className="text-theme-xs text-gray-500">{pending ? `${pending} passo(s) pendente(s).` : "Tudo pronto."}</span>
          <div className="flex gap-2">
            <TaButton onClick={onClose}>Continuar depois</TaButton>
            <TaButton
              variant="primary"
              data-move-done
              disabled={!!busy}
              onClick={() =>
                void run("done", async () => {
                  if (pending && !confirm(`Ainda há ${pending} passo(s) pendente(s). Concluir mesmo assim? O assistente não abrirá mais sozinho.`)) return;
                  await call("installation.mark", { extensionId: chrome.runtime.id });
                  await chrome.storage.local.remove(IMPORTED_KEY);
                  onDone();
                })
              }
            >
              Concluir
            </TaButton>
          </div>
        </div>
      </div>
    </TaModal>
  );
}
