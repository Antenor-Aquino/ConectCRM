// Aparece ao abrir o CRM quando o backup automático está pendente e o Chrome
// perdeu a permissão da pasta (acontece a cada reinício do navegador). O
// clique já é o gesto que o Chrome exige: autoriza e faz o backup na hora.
import { useState } from "react";
import { Unlock } from "lucide-react";
import { TaButton, TaModal } from "@tailadmin";
import { writeBackup, type AutoBackupSettings } from "../../lib/autoBackup";
import type { PermissionedDirectoryHandle } from "../../lib/backupFolder";
import { exportDatabase } from "../settings/BackupSettings";

export function AutoBackupPermissionModal({ handle, settings, onClose }: { handle: PermissionedDirectoryHandle; settings: AutoBackupSettings; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <TaModal isOpen onClose={onClose} title="Backup automático pendente" accent="var(--color-success-600)">
      <p className="mb-4 text-theme-sm text-gray-700 dark:text-gray-300">
        Está na hora do backup {settings.frequency === "daily" ? "diário" : "semanal"} na pasta <strong>{handle.name}</strong>. O Chrome pede a autorização de gravação de
        novo sempre que o navegador é reiniciado. Clique abaixo para autorizar e fazer o backup agora.
      </p>
      {error && <p className="mb-3 text-theme-sm text-error-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <TaButton onClick={onClose} disabled={working}>
          Agora não
        </TaButton>
        <TaButton
          variant="primary"
          disabled={working}
          startIcon={<Unlock size={14} />}
          onClick={async () => {
            setWorking(true);
            setError(null);
            try {
              if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") {
                setError("Permissão não concedida. O backup não pôde rodar.");
                return;
              }
              await writeBackup(exportDatabase, handle, settings);
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setWorking(false);
            }
          }}
        >
          {working ? "Fazendo backup…" : "Autorizar e fazer backup"}
        </TaButton>
      </div>
    </TaModal>
  );
}
