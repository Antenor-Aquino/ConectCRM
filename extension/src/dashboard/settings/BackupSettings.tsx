// Configurações → Backup (mesma lógica da gestao-financeira-extensao):
// backup automático diário/semanal do banco numa pasta escolhida (com
// retenção), backup dos documentos do GED (rotina própria, DocBackupPanel),
// download de uma cópia (.zip com os documentos), restauração e ambiente de
// teste.
import { useEffect, useRef, useState } from "react";
import { DatabaseBackup, Download, FileDown, FileUp, FolderOpen, RefreshCw, Truck, Upload } from "lucide-react";
import { TaButton, TaPanel, TaSelect } from "@tailadmin";
import { exportDatabase, restoreDatabase, systemCall } from "../../rpc/client";
import {
  loadAutoBackupSettings,
  manualBackupFilename,
  saveAutoBackupSettings,
  writeBackup,
  type AutoBackupSettings,
  type BackupFrequency,
} from "../../lib/autoBackup";
import { loadBackupFolderHandle, pickBackupFolder } from "../../lib/backupFolder";
import { buildBackupZip, readBackupZip, restoreDocumentFiles, saveBlobAs } from "../../lib/documentFiles";
import { recoverFromBackups } from "../../lib/locateDocuments";
import { call } from "../../rpc/client";
import { formatBytes } from "../../lib/files";
import { DocBackupPanel } from "./DocBackupSettings";
import { exportSettings, importSettings, parseSettingsFile, SETTINGS_BACKUP_FILE, settingsJson, settingsLabels } from "../../lib/settingsTransfer";
import { MOVE_ASSISTANT_EVENT } from "../components/MoveAssistant";
import type { DbEnv } from "../../lib/environment";
import { formatDateTime } from "../../lib/format";
import { addNotification } from "../../lib/notifications";
import { useSession } from "../session";
import { Switch } from "../ui/Switch";
import { errorText } from "../../lib/errors";

type Msg = { text: string; kind: "ok" | "err" } | null;

export function BackupSettings({ env }: { env: DbEnv }) {
  const { user } = useSession();
  const isAdmin = user.role === "admin";
  const [settings, setSettings] = useState<AutoBackupSettings | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const settingsInput = useRef<HTMLInputElement>(null);
  /** Senhas e chaves (IA, Z-API, Pipedrive, CallMeBot, licença) no arquivo de configurações / na cópia. */
  const [withSecrets, setWithSecrets] = useState(false);

  useEffect(() => {
    void loadAutoBackupSettings().then(setSettings);
  }, []);

  const update = async (patch: Partial<AutoBackupSettings>) => {
    const next = { ...settings!, ...patch };
    await saveAutoBackupSettings(next);
    setSettings(next);
  };

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ text, kind: "ok" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // escolha de pasta cancelada
      setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return null;

  return (
    <>
      <TaPanel title="Backup automático" subtitle="Na primeira abertura do CRM no dia (ou na semana), uma cópia do banco é gravada na pasta escolhida.">
        {env === "demo" && <p className="mb-3 rounded-lg bg-warning-50 px-3 py-2 text-theme-sm text-warning-800">Você está no ambiente de Teste: o backup automático só roda em Produção.</p>}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800">
          <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">Backup automático ativado</span>
          <Switch checked={settings.enabled} disabled={!isAdmin} onChange={(v) => void update({ enabled: v })} />
        </div>
        <div className="grid gap-3 text-theme-sm md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-gray-300">Frequência</span>
            <TaSelect value={settings.frequency} disabled={!isAdmin} onChange={(e) => void update({ frequency: e.target.value as BackupFrequency })}>
              <option value="daily">Diário</option>
              <option value="weekly">Semanal</option>
            </TaSelect>
          </label>
          <div>
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-gray-300">Pasta</span>
            <div className="flex items-center gap-2">
              <span className="flex h-10 flex-1 items-center truncate rounded-lg bg-gray-50 px-3 text-gray-700 dark:bg-white/5 dark:text-gray-300">
                {settings.folderName ?? "Nenhuma pasta escolhida"}
              </span>
              <TaButton
                disabled={!isAdmin || busy}
                startIcon={<FolderOpen size={15} />}
                onClick={() =>
                  void run(async () => {
                    const h = await pickBackupFolder();
                    await update({ folderName: h.name });
                    return `Pasta "${h.name}" escolhida.`;
                  })
                }
              >
                Escolher
              </TaButton>
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-3 text-theme-sm md:grid-cols-2">
          {(
            [
              ["keepDaily", "Backups diários a manter", [7, 15, 30, 60, 90]],
              ["keepWeekly", "Backups semanais a manter", [4, 8, 12, 26, 52]],
            ] as const
          ).map(([key, label, options]) => (
            <label key={key} className="block">
              <span className="mb-1.5 block font-medium text-gray-700 dark:text-gray-300">{label}</span>
              <TaSelect data-retention={key} value={settings[key]} disabled={!isAdmin} onChange={(e) => void update({ [key]: Number(e.target.value) })}>
                <option value={0}>Todos (não apagar)</option>
                {options.map((n) => (
                  <option key={n} value={n}>
                    Os {n} mais recentes
                  </option>
                ))}
              </TaSelect>
            </label>
          ))}
        </div>
        <p className="mt-3 text-theme-xs text-gray-500">
          Os backups automáticos além do limite são apagados da pasta a cada novo backup; os feitos em "Fazer backup agora" nunca são apagados. Os documentos têm
          backup próprio, abaixo.
        </p>
        <p className="mt-3 text-theme-xs text-gray-500">
          Último backup: {settings.lastRunAt ? formatDateTime(settings.lastRunAt) : "nunca"}. O Chrome pede a autorização da pasta de novo sempre que é reiniciado; o CRM
          avisa e faz o backup no mesmo clique.
        </p>
        <TaButton
          className="mt-4"
          variant="primary"
          disabled={busy || !settings.folderName}
          startIcon={<DatabaseBackup size={15} />}
          onClick={() =>
            void run(async () => {
              const handle = await loadBackupFolderHandle();
              if (!handle) throw new Error("Escolha a pasta primeiro.");
              if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("Permissão da pasta não concedida.");
              const name = await writeBackup(exportDatabase, handle, settings, manualBackupFilename());
              setSettings(await loadAutoBackupSettings());
              return `Backup salvo: ${name}`;
            })
          }
        >
          Fazer backup agora
        </TaButton>
      </TaPanel>

      <DocBackupPanel env={env} dbFolder={settings.folderName} />

      <TaPanel title="Cópia e restauração" subtitle="Baixe uma cópia (.zip com o banco e os documentos) ou restaure um backup (.zip ou .sqlite).">
        <div className="flex flex-wrap gap-2">
          <TaButton
            disabled={busy}
            startIcon={<Download size={15} />}
            onClick={() =>
              void run(async () => {
                // Tudo vai para a memória: com muitos documentos o navegador pode não aguentar.
                const total = (await call("files.locateList")).reduce((n, b) => n + b.size_bytes, 0);
                if (total > 1024 ** 3 && !confirm(`Os documentos somam ${formatBytes(total)}: a cópia em .zip pode travar o navegador. Para documentos, prefira o backup dos documentos (abaixo). Baixar mesmo assim?`)) return;
                const bytes = await buildBackupZip(await exportDatabase(), settingsJson(await exportSettings(withSecrets)));
                saveBlobAs(new Blob([bytes as BlobPart], { type: "application/zip" }), manualBackupFilename().replace(/\.sqlite$/, ".zip"));
                return `Cópia baixada (banco, documentos e configurações${withSecrets ? ", com senhas e chaves" : ""}).`;
              })
            }
          >
            Baixar cópia (banco e documentos)
          </TaButton>
          <TaButton variant="danger" disabled={busy || !isAdmin} startIcon={<Upload size={15} />} onClick={() => fileInput.current?.click()}>
            Restaurar backup…
          </TaButton>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".zip,.sqlite,.db,application/zip,application/x-sqlite3"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!confirm(`Restaurar "${file.name}"? TODOS os dados atuais ${env === "demo" ? "do ambiente de Teste " : ""}serão substituídos por este arquivo.`)) return;
              void run(async () => {
                const raw = new Uint8Array(await file.arrayBuffer());
                const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
                const backup = isZip ? await readBackupZip(raw) : null;
                await restoreDatabase(backup ? backup.db : raw);
                // Documentos: os do .zip; num .sqlite, os que faltarem são buscados nas pastas de backup.
                const docs = backup ? await restoreDocumentFiles(backup.files) : await recoverFromBackups().catch(() => 0);
                // Configurações: as da cópia .zip; num .sqlite, a cópia gravada na pasta de backup.
                const settingsText =
                  backup?.settings ??
                  (await loadBackupFolderHandle()
                    .then((h) => h?.getFileHandle(SETTINGS_BACKUP_FILE))
                    .then((fh) => fh?.getFile())
                    .then((f) => f?.text() ?? null)
                    .catch(() => null));
                if (settingsText) {
                  const sf = parseSettingsFile(settingsText);
                  if (confirm(`Restaurar também as configurações deste backup?\n\n${settingsLabels(sf).join(", ")}`)) await importSettings(sf);
                }
                await addNotification({
                  kind: "success",
                  title: "Backup restaurado",
                  message: `Dados restaurados de "${file.name}"${docs ? `, com ${docs} documento(s)` : ""}.`,
                });
                location.reload();
              });
            }}
          />
        </div>
        {!isAdmin && <p className="mt-2 text-theme-xs text-gray-500">Só administradores restauram backups e alteram o backup automático.</p>}
        <p className="mt-2 text-theme-xs text-gray-500">Antes de restaurar, o banco atual é guardado internamente como cópia de segurança.</p>
      </TaPanel>

      <TaPanel
        title="Configurações e mudança de instalação"
        subtitle="Notificações, sons, números de WhatsApp, IA, Pipedrive e backups ficam fora do banco. Vão em todo backup do banco (sem senhas) e na cópia .zip."
      >
        <div data-settings-transfer className="space-y-3">
          <label className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
            <Switch checked={withSecrets} disabled={!isAdmin} onChange={setWithSecrets} />
            Incluir senhas e chaves (IA, Z-API, Pipedrive, CallMeBot, licença) na exportação e na cópia .zip
          </label>
          {withSecrets && (
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-800">
              O arquivo fica em texto puro: guarde-o em lugar seguro e apague depois de usar.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <TaButton
              disabled={busy || !isAdmin}
              startIcon={<FileDown size={15} />}
              data-settings-export
              onClick={() =>
                void run(async () => {
                  const f = await exportSettings(withSecrets);
                  saveBlobAs(new Blob([settingsJson(f)], { type: "application/json" }), manualBackupFilename().replace("conectcrm-backup", "conectcrm-configuracoes").replace(/\.sqlite$/, ".json"));
                  return `Configurações exportadas${withSecrets ? " (com senhas e chaves)" : " (sem senhas e chaves)"}.`;
                })
              }
            >
              Exportar configurações
            </TaButton>
            <TaButton disabled={busy || !isAdmin} startIcon={<FileUp size={15} />} onClick={() => settingsInput.current?.click()}>
              Importar configurações…
            </TaButton>
            <TaButton disabled={!isAdmin} startIcon={<Truck size={15} />} data-open-move onClick={() => window.dispatchEvent(new Event(MOVE_ASSISTANT_EVENT))}>
              Assistente de mudança de instalação
            </TaButton>
          </div>
          <input
            ref={settingsInput}
            type="file"
            hidden
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void run(async () => {
                const sf = parseSettingsFile(await file.text());
                if (!confirm(`Importar estas configurações? As atuais serão substituídas.\n\n${settingsLabels(sf).join(", ")}`)) return;
                await importSettings(sf);
                await addNotification({ kind: "success", title: "Configurações importadas", message: settingsLabels(sf).join(", ") });
                location.reload();
              });
            }}
          />
          <p className="text-theme-xs text-gray-500">
            Mudou a extensão de pasta ou de computador? Restaure o backup e use o assistente: ele confere pasta de documentos, backups, configurações e a Gestão
            Financeira. Ele também abre sozinho quando o banco veio de outra instalação.
          </p>
        </div>
      </TaPanel>

      <TaPanel title="Ambiente de teste" subtitle="Use a chave Produção / Teste no topo. O Teste tem dados de exemplo e não mistura com os dados reais.">
        {env === "demo" ? (
          <TaButton
            disabled={busy}
            startIcon={<RefreshCw size={15} />}
            onClick={() => {
              if (!confirm("Apagar o ambiente de Teste e recriar os dados de exemplo?")) return;
              void run(async () => {
                await systemCall("system.resetDemo");
                location.reload();
              });
            }}
          >
            Recriar dados de exemplo
          </TaButton>
        ) : (
          <p className="text-theme-sm text-gray-500">Você está em Produção.</p>
        )}
      </TaPanel>

      {msg && <p className={`rounded-lg px-3 py-2 text-theme-sm ${msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700"}`}>{msg.text}</p>}
    </>
  );
}
