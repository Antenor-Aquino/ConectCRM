// Configurações → Backup (mesma lógica da gestao-financeira-extensao):
// backup automático diário/semanal numa pasta escolhida, backup manual,
// download de uma cópia, restauração e ambiente de teste.
import { useEffect, useRef, useState } from "react";
import { DatabaseBackup, Download, FolderOpen, RefreshCw, Upload } from "lucide-react";
import { TaButton, TaPanel, TaSelect } from "@tailadmin";
import { systemCall } from "../../rpc/client";
import {
  loadAutoBackupSettings,
  manualBackupFilename,
  saveAutoBackupSettings,
  writeBackup,
  type AutoBackupSettings,
  type BackupFrequency,
} from "../../lib/autoBackup";
import { loadBackupFolderHandle, pickBackupFolder } from "../../lib/backupFolder";
import { base64ToBytes, bytesToBase64, type DbEnv } from "../../lib/environment";
import { formatDateTime } from "../../lib/format";
import { addNotification } from "../../lib/notifications";
import { useSession } from "../session";
import { Switch } from "../ui/Switch";

export async function exportDatabase(): Promise<Uint8Array> {
  return base64ToBytes(await systemCall<string>("system.export"));
}

type Msg = { text: string; kind: "ok" | "err" } | null;

export function BackupSettings({ env }: { env: DbEnv }) {
  const { user } = useSession();
  const isAdmin = user.role === "admin";
  const [settings, setSettings] = useState<AutoBackupSettings | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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
      setMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
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

      <TaPanel title="Cópia e restauração" subtitle="Baixe uma cópia do banco ou restaure um backup (.sqlite).">
        <div className="flex flex-wrap gap-2">
          <TaButton
            disabled={busy}
            startIcon={<Download size={15} />}
            onClick={() =>
              void run(async () => {
                const bytes = await exportDatabase();
                const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/x-sqlite3" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = manualBackupFilename();
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
                return "Cópia baixada.";
              })
            }
          >
            Baixar cópia do banco
          </TaButton>
          <TaButton variant="danger" disabled={busy || !isAdmin} startIcon={<Upload size={15} />} onClick={() => fileInput.current?.click()}>
            Restaurar backup…
          </TaButton>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".sqlite,.db,application/x-sqlite3"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!confirm(`Restaurar "${file.name}"? TODOS os dados atuais ${env === "demo" ? "do ambiente de Teste " : ""}serão substituídos por este arquivo.`)) return;
              void run(async () => {
                await systemCall("system.restore", { base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) });
                await addNotification({ kind: "success", title: "Backup restaurado", message: `Dados restaurados de "${file.name}".` });
                location.reload();
              });
            }}
          />
        </div>
        {!isAdmin && <p className="mt-2 text-theme-xs text-gray-500">Só administradores restauram backups e alteram o backup automático.</p>}
        <p className="mt-2 text-theme-xs text-gray-500">Antes de restaurar, o banco atual é guardado internamente como cópia de segurança.</p>
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
