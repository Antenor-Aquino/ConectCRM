// Abertura do CRM: pergunta se apaga os backups do banco com mais de 7 dias.
// "Não" avisa que a limpeza pode ser feita a qualquer momento em
// Configurações → Backup (e a pergunta volta na semana seguinte).
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { TaButton, TaModal } from "@tailadmin";
import { BACKUP_MAX_AGE_DAYS, deleteBackups, saveCleanupState, type BackupFileInfo } from "../../lib/backupCleanup";
import type { PermissionedDirectoryHandle } from "../../lib/backupFolder";
import { formatBytes } from "../../lib/files";
import { addNotification } from "../../lib/notifications";
import { errorText } from "../../lib/errors";

export function BackupCleanupModal({ handle, files, onClose }: { handle: PermissionedDirectoryHandle; files: BackupFileInfo[]; onClose: () => void }) {
  const [step, setStep] = useState<"ask" | "declined" | "done">("ask");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const total = files.reduce((n, f) => n + f.size, 0);
  const oldest = new Date(Math.min(...files.map((f) => f.lastModified))).toLocaleDateString("pt-BR");
  return (
    <TaModal isOpen onClose={step === "ask" ? () => undefined : onClose} title="Limpeza de backups antigos" width="max-w-lg" showCloseButton={step !== "ask"}>
      <div data-backup-cleanup={step} className="space-y-4 text-theme-sm text-gray-700 dark:text-gray-300">
        {step === "ask" && (
          <>
            <p>
              Na pasta de backup <strong>“{handle.name}”</strong> há <strong>{files.length}</strong> backup(s) do banco com mais de {BACKUP_MAX_AGE_DAYS} dias (desde{" "}
              {oldest}), somando {formatBytes(total)}.
            </p>
            <p>Deseja excluí-los agora? O backup mais recente é sempre mantido.</p>
            <div className="flex justify-end gap-2">
              <TaButton
                variant="ghost"
                disabled={busy}
                data-cleanup-no
                onClick={() =>
                  void saveCleanupState({ lastAskedAt: new Date(Date.now()).toISOString() }).then(() => {
                    setStep("declined");
                  })
                }
              >
                Não
              </TaButton>
              <TaButton
                variant="primary"
                startIcon={<Trash2 size={15} />}
                disabled={busy}
                data-cleanup-yes
                onClick={async () => {
                  setBusy(true);
                  try {
                    const n = await deleteBackups(handle, files);
                    setResult(`${n} backup(s) antigo(s) excluído(s) da pasta “${handle.name}”.`);
                    await addNotification({ kind: "success", title: "Backups antigos excluídos", message: `${n} arquivo(s) com mais de ${BACKUP_MAX_AGE_DAYS} dias.` });
                  } catch (e) {
                    setResult(`Não foi possível excluir: ${errorText(e)}`);
                  } finally {
                    setBusy(false);
                    setStep("done");
                  }
                }}
              >
                Sim, excluir
              </TaButton>
            </div>
          </>
        )}
        {step === "declined" && (
          <>
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-warning-800" data-cleanup-warning>
              Os backups antigos foram mantidos. Você pode fazer essa limpeza a qualquer momento em <strong>Configurações → Backup → Limpar backups antigos</strong>.
            </p>
            <div className="flex justify-end">
              <TaButton variant="primary" onClick={onClose}>
                Entendi
              </TaButton>
            </div>
          </>
        )}
        {step === "done" && (
          <>
            <p>{result}</p>
            <div className="flex justify-end">
              <TaButton variant="primary" onClick={onClose}>
                OK
              </TaButton>
            </div>
          </>
        )}
      </div>
    </TaModal>
  );
}
