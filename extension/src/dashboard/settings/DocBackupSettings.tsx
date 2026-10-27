// Configurações → Backup → Backup dos documentos (GED): rotina própria,
// separada do backup do banco (lib/docBackup).
import { useEffect, useState } from "react";
import { FileCheck2, FolderOpen, FolderSync } from "lucide-react";
import { TaButton, TaPanel, TaSelect, cn } from "@tailadmin";
import {
  docBackupFolder,
  docBackupSummary,
  loadDocBackupSettings,
  MIRROR_DIR,
  runAndRecordDocBackup,
  saveDocBackupSettings,
  type DocBackupFrequency,
  type DocBackupProgress,
  type DocBackupSettings,
} from "../../lib/docBackup";
import { pickBackupFolder } from "../../lib/backupFolder";
import type { DbEnv } from "../../lib/environment";
import { errorText } from "../../lib/errors";
import { formatBytes } from "../../lib/files";
import { formatDateTime } from "../../lib/format";
import { useSession } from "../session";
import { Switch } from "../ui/Switch";

type Msg = { text: string; kind: "ok" | "err" } | null;

const FREQUENCY: [DocBackupFrequency, string][] = [
  ["open", "A cada abertura do CRM (no máx. 1 vez por hora)"],
  ["daily", "Diário"],
  ["weekly", "Semanal"],
  ["manual", "Só quando eu mandar"],
];

/** `dbFolder`: nome da pasta do backup do banco (vem do painel de cima, sempre atual). */
export function DocBackupPanel({ env, dbFolder }: { env: DbEnv; dbFolder: string | null }) {
  const { user } = useSession();
  const isAdmin = user.role === "admin";
  const [s, setS] = useState<DocBackupSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DocBackupProgress | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    void loadDocBackupSettings().then(setS);
  }, []);
  if (!s) return null;

  const update = async (patch: Partial<DocBackupSettings>) => {
    const next = { ...s, ...patch };
    await saveDocBackupSettings(next);
    setS(next);
  };
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ text, kind: "ok" });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(false);
      setProgress(null);
      setS(await loadDocBackupSettings());
    }
  };
  const backupNow = (full: boolean) =>
    run(async () => {
      const handle = await docBackupFolder(s);
      if (!handle) throw new Error(s.ownFolder ? "Escolha a pasta do backup dos documentos." : "Escolha a pasta do backup (no painel acima).");
      if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("Permissão da pasta não concedida.");
      return docBackupSummary(await runAndRecordDocBackup(handle, s, { full, onProgress: setProgress }));
    });

  const folderLabel = s.ownFolder ? (s.folderName ?? "Nenhuma pasta escolhida") : dbFolder ? `${dbFolder} (a do backup do banco)` : "Escolha a pasta do backup do banco, acima";
  const last = s.last;
  return (
    <TaPanel
      title="Backup dos documentos (GED)"
      subtitle={`Rotina própria, separada do banco. Grava um espelho legível em "${MIRROR_DIR}": as mesmas pastas do GED, o nome de cada documento e um índice que abre no Excel.`}
    >
      <div data-doc-backup-panel className="space-y-4">
        {env === "demo" && (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-theme-sm text-warning-800">Você está no ambiente de Teste: o backup dos documentos só roda em Produção.</p>
        )}
        <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800">
          <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">Backup dos documentos ativado</span>
          <Switch checked={s.enabled} disabled={!isAdmin} onChange={(v) => void update({ enabled: v })} />
        </div>

        <div className="grid gap-3 text-theme-sm md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-gray-300">Frequência</span>
            <TaSelect data-doc-backup-frequency value={s.frequency} disabled={!isAdmin} onChange={(e) => void update({ frequency: e.target.value as DocBackupFrequency })}>
              {FREQUENCY.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </TaSelect>
          </label>
          <div>
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-gray-300">Pasta</span>
            <div className="flex gap-1 rounded-lg border border-gray-200 p-0.5 dark:border-gray-700" role="group">
              {(
                [
                  [false, "Mesma do banco"],
                  [true, "Outra pasta"],
                ] as const
              ).map(([own, label]) => (
                <button
                  key={label}
                  type="button"
                  disabled={!isAdmin}
                  data-doc-backup-own={own}
                  onClick={() => void update({ ownFolder: own })}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-theme-xs font-medium",
                    s.ownFolder === own ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400" : "text-gray-500 hover:text-gray-700",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="flex h-10 flex-1 items-center truncate rounded-lg bg-gray-50 px-3 text-gray-700 dark:bg-white/5 dark:text-gray-300" data-doc-backup-folder>
                {folderLabel}
              </span>
              {s.ownFolder && (
                <TaButton
                  disabled={!isAdmin || busy}
                  startIcon={<FolderOpen size={15} />}
                  onClick={() =>
                    void run(async () => {
                      const h = await pickBackupFolder("docs");
                      await update({ folderName: h.name });
                      return `Pasta "${h.name}" escolhida para o backup dos documentos.`;
                    })
                  }
                >
                  Escolher
                </TaButton>
              )}
            </div>
            <p className="mt-1 text-theme-xs text-gray-500">Dica: um HD externo ou uma pasta do OneDrive/Google Drive. Nunca dentro da pasta da extensão.</p>
          </div>
          <label className="block">
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-gray-300">Arquivos removidos do GED</span>
            <TaSelect value={s.keepRemovedDays} disabled={!isAdmin} onChange={(e) => void update({ keepRemovedDays: Number(e.target.value) })}>
              {[7, 30, 90, 365].map((d) => (
                <option key={d} value={d}>
                  Manter em "_removidos" por {d} dias
                </option>
              ))}
            </TaSelect>
          </label>
          <label className="block">
            <span className="mb-1.5 block font-medium text-gray-700 dark:text-gray-300">Avisar no sino se ficar sem backup por</span>
            <TaSelect value={s.alertDays} disabled={!isAdmin} onChange={(e) => void update({ alertDays: Number(e.target.value) })}>
              {[3, 7, 15, 30].map((d) => (
                <option key={d} value={d}>
                  {d} dias
                </option>
              ))}
              <option value={0}>Não avisar</option>
            </TaSelect>
          </label>
        </div>

        <div className="space-y-2 text-theme-sm text-gray-700 dark:text-gray-300">
          <label className="flex items-center gap-2">
            <Switch checked={s.includeOldVersions} disabled={!isAdmin} onChange={(v) => void update({ includeOldVersions: v })} />
            Incluir as versões anteriores (em "_versões anteriores")
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={s.fullVerifyWeekly} disabled={!isAdmin} onChange={(v) => void update({ fullVerifyWeekly: v })} />
            Conferência completa uma vez por semana (lê todos os arquivos e compara o conteúdo; mais lenta)
          </label>
        </div>

        <div className="rounded-xl bg-gray-50 px-4 py-3 text-theme-sm text-gray-700 dark:bg-white/5 dark:text-gray-300" data-doc-backup-last>
          {last ? (
            <>
              Último backup: <strong>{formatDateTime(last.at)}</strong> — {last.total} arquivo(s), {formatBytes(last.bytes)}.
              <span className="block text-theme-xs text-gray-500">{docBackupSummary(last)}</span>
              {last.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-theme-xs text-error-700">
                  {last.errors.slice(0, 5).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            "Nenhum backup dos documentos feito ainda."
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <TaButton variant="primary" disabled={busy || !isAdmin} startIcon={<FolderSync size={15} />} data-doc-backup-now onClick={() => void backupNow(false)}>
            Fazer backup dos documentos agora
          </TaButton>
          <TaButton disabled={busy || !isAdmin} startIcon={<FileCheck2 size={15} />} data-doc-backup-full onClick={() => void backupNow(true)}>
            Conferência completa agora
          </TaButton>
        </div>
        {progress && (
          <p className="text-theme-xs text-gray-500" data-doc-backup-progress>
            Copiando… {progress.done} de {progress.total} arquivo(s).
          </p>
        )}
        {msg && (
          <p data-doc-backup-msg className={`rounded-lg px-3 py-2 text-theme-sm ${msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </TaPanel>
  );
}
