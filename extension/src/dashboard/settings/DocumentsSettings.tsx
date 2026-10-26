// Configurações → Documentos (GED): onde guardar os arquivos (navegador ou
// uma pasta do computador) e os tipos de documento (classificação).
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, FileSearch, FolderOpen, HardDrive, History, KeyRound, Plus, SearchCheck, Trash2 } from "lucide-react";
import { TaButton, TaInput, TaPanel, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { DocumentType } from "../../db/documents";
import type { DbEnv } from "../../lib/environment";
import { moveBrowserFilesToFolder, moveFolderFilesToBrowser } from "../../lib/documentFiles";
import { documentsFolderStatus, forgetDocumentsFolder, pickDocumentsFolder, requestDocumentsFolderAccess, type FolderStatus } from "../../lib/fileStore";
import { formatBytes } from "../../lib/files";
import { loadBackupFolderHandle, type DirectoryPickerWindow, type PermissionedDirectoryHandle } from "../../lib/backupFolder";
import { checkDocuments, locateDocuments, locateSummary, looksLikeMonthFolder, type DocumentsCheck, type LocateProgress } from "../../lib/locateDocuments";
import { useSession } from "../session";
import { Switch } from "../ui/Switch";
import { ColorPicker } from "./TagsSettings";
import { errorText } from "../../lib/errors";

type Msg = { text: string; kind: "ok" | "err" } | null;

function StoragePanel({ env, onChanged }: { env: DbEnv; onChanged: () => void }) {
  const { user } = useSession();
  const isAdmin = user.role === "admin";
  const [status, setStatus] = useState<FolderStatus | null>(null);
  const [usage, setUsage] = useState<{ browser: number; folder: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    setStatus(await documentsFolderStatus());
    const files = await call("files.all");
    const sizes = await call("files.inBrowser");
    setUsage({
      browser: files.filter((f) => f.location !== "folder").length,
      folder: files.filter((f) => f.location === "folder").length,
      bytes: sizes.reduce((n, f) => n + f.size_bytes, 0),
    });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
      onChanged();
    }
  };

  if (env === "demo") {
    return (
      <TaPanel title="Onde guardar os arquivos" subtitle="Ambiente de Teste">
        <p className="text-theme-sm text-gray-500">
          No ambiente de Teste os documentos ficam sempre no navegador. A pasta do computador vale só para Produção.
        </p>
      </TaPanel>
    );
  }
  const folderMode = !!status?.configured;
  const granted = status?.permission === "granted";

  return (
    <TaPanel title="Onde guardar os arquivos" subtitle="O banco guarda só as informações; o conteúdo dos documentos fica num destes lugares.">
      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          disabled={!isAdmin || busy || !folderMode}
          onClick={() =>
            void run(async () => {
              if (!confirm("Voltar a guardar no navegador? Os arquivos da pasta são copiados para o navegador (a pasta não é apagada).")) return;
              const n = await moveFolderFilesToBrowser();
              await forgetDocumentsFolder();
              return `${n} arquivo(s) trazido(s) para o navegador.`;
            })
          }
          className={cn(
            "rounded-xl border p-4 text-left",
            !folderMode
              ? "border-brand-500 bg-brand-25 ring-1 ring-brand-500 dark:bg-brand-500/10"
              : "border-gray-200 hover:border-gray-300 dark:border-gray-800",
          )}
        >
          <span className="flex items-center gap-2 font-medium text-gray-800 dark:text-white/90">
            <HardDrive size={16} /> No navegador (padrão)
          </span>
          <span className="mt-1 block text-theme-xs text-gray-500">Sem configuração. Os arquivos ficam no perfil do Chrome; entram no backup.</span>
        </button>
        <button
          type="button"
          disabled={!isAdmin || busy}
          onClick={() =>
            void run(async () => {
              const h = await pickDocumentsFolder(confirmMonthFolder);
              if (!h) return;
              const moved = await moveBrowserFilesToFolder();
              // Trocou de pasta com arquivos já guardados: procura cada um na pasta nova.
              const found = (await checkDocuments()).missing.length ? await locateDocuments(h) : null;
              return `Pasta "${h.name}" escolhida.${moved ? ` ${moved} arquivo(s) movido(s) para ela.` : ""}${found ? ` ${locateSummary(found)}` : ""}`;
            })
          }
          className={cn(
            "rounded-xl border p-4 text-left",
            folderMode
              ? "border-brand-500 bg-brand-25 ring-1 ring-brand-500 dark:bg-brand-500/10"
              : "border-gray-200 hover:border-gray-300 dark:border-gray-800",
          )}
        >
          <span className="flex items-center gap-2 font-medium text-gray-800 dark:text-white/90">
            <FolderOpen size={16} /> Numa pasta do computador
          </span>
          <span className="mt-1 block text-theme-xs text-gray-500">
            {folderMode ? `Pasta: ${status!.name}. Clique para trocar.` : "Escolha a pasta (ex.: uma pasta sincronizada do OneDrive/Google Drive)."} Organizada
            por mês: AAAA-MM/Nome do documento.pdf
          </span>
        </button>
      </div>

      {folderMode && (
        <div
          className={cn(
            "mt-4 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 text-theme-sm",
            granted ? "bg-success-50 text-success-700" : "bg-warning-50 text-warning-700",
          )}
        >
          {granted
            ? "Acesso à pasta concedido."
            : "O Chrome precisa da sua autorização para usar a pasta (pede de novo sempre que é reiniciado). Até lá, os novos documentos ficam no navegador."}
          {!granted && (
            <TaButton
              size="sm"
              variant="primary"
              startIcon={<KeyRound size={14} />}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!(await requestDocumentsFolderAccess())) throw new Error("Acesso não concedido.");
                  const moved = await moveBrowserFilesToFolder();
                  return `Acesso concedido.${moved ? ` ${moved} arquivo(s) movido(s) para a pasta.` : ""}`;
                })
              }
            >
              Conceder acesso
            </TaButton>
          )}
          {granted && usage && usage.browser > 0 && (
            <TaButton size="sm" disabled={busy} onClick={() => void run(async () => `${await moveBrowserFilesToFolder()} arquivo(s) movido(s) para a pasta.`)}>
              Mover {usage.browser} arquivo(s) do navegador para a pasta
            </TaButton>
          )}
        </div>
      )}

      {usage && (
        <p className="mt-3 text-theme-xs text-gray-500">
          {usage.browser} arquivo(s) no navegador ({formatBytes(usage.bytes)}) · {usage.folder} na pasta. Arquivos iguais são guardados uma vez só.
        </p>
      )}
      {!isAdmin && <p className="mt-2 text-theme-xs text-gray-500">Só administradores mudam onde os arquivos ficam.</p>}
      {msg && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-theme-sm ${msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700"}`}>
          {msg.text}
        </p>
      )}
    </TaPanel>
  );
}

/** Aviso ao escolher a pasta de um mês ("2026-10") no lugar da pasta de documentos. */
const confirmMonthFolder = (h: PermissionedDirectoryHandle) =>
  !looksLikeMonthFolder(h.name) ||
  confirm(
    `"${h.name}" parece ser a pasta de um mês, criada pelo CRM dentro da pasta de documentos. O certo é escolher a pasta ACIMA dela (a que contém as pastas dos meses).\n\nUsar "${h.name}" mesmo assim?`,
  );

const PHASE_TEXT: Record<LocateProgress["phase"], string> = { scan: "Lendo a pasta", match: "Conferindo o conteúdo", save: "Atualizando" };

/** Confere se os arquivos estão onde o banco diz e reencontra os que mudaram de lugar. */
function LocatePanel({ env, rev }: { env: DbEnv; rev: number }) {
  const { user } = useSession();
  const isAdmin = user.role === "admin";
  const [check, setCheck] = useState<DocumentsCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LocateProgress | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const recheck = useCallback(async () => setCheck(await checkDocuments(env)), [env]);
  useEffect(() => {
    void recheck().catch(() => {});
  }, [recheck, rev]);

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
      await recheck().catch(() => {});
    }
  };
  const locateIn = async (h: PermissionedDirectoryHandle) => locateSummary(await locateDocuments(h, setProgress));

  const missing = check?.missing ?? [];
  return (
    <TaPanel
      title="Conferir e localizar documentos"
      subtitle="Mudou a pasta de lugar, trocou de computador ou reinstalou a extensão? Aponte onde os arquivos estão agora: o CRM reconhece cada um pelo conteúdo e atualiza os links."
    >
      <div data-locate-panel className="space-y-3">
        {check && (
          <p
            data-locate-status={missing.length ? "missing" : "ok"}
            className={cn("rounded-lg px-3 py-2 text-theme-sm", missing.length ? "bg-warning-50 text-warning-800" : "bg-success-50 text-success-700")}
          >
            {missing.length
              ? `${missing.length} de ${check.total} arquivo(s) não encontrado(s) onde o banco diz.`
              : `Todos os ${check.total} arquivo(s) estão no lugar.`}
            {check.noAccess > 0 && ` ${check.noAccess} na pasta de documentos não puderam ser conferidos (falta conceder acesso à pasta).`}
          </p>
        )}
        {missing.length > 0 && (
          <ul className="max-h-40 space-y-0.5 overflow-auto text-theme-xs text-gray-600 dark:text-gray-400" data-locate-missing>
            {missing.slice(0, 50).map((b) => (
              <li key={b.id} className="truncate">
                • {b.name ?? b.filename ?? "(sem nome)"} <span className="text-gray-400">— {b.path ?? "no navegador"}</span>
              </li>
            ))}
            {missing.length > 50 && <li>… e mais {missing.length - 50}.</li>}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <TaButton size="sm" startIcon={<SearchCheck size={14} />} disabled={busy} onClick={() => void run(async () => undefined)}>
            Conferir agora
          </TaButton>
          {isAdmin && (
            <TaButton
              size="sm"
              variant={missing.length ? "primary" : "outline"}
              startIcon={<FileSearch size={14} />}
              disabled={busy}
              data-locate-pick
              onClick={() =>
                void run(async () => {
                  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
                  if (!picker) throw new Error("Este navegador não permite escolher pasta. Use o Chrome atualizado.");
                  return locateIn(await picker({ mode: "read", id: "conectcrm-localizar" }));
                })
              }
            >
              Localizar documentos…
            </TaButton>
          )}
          {isAdmin && missing.length > 0 && (
            <TaButton
              size="sm"
              startIcon={<History size={14} />}
              disabled={busy}
              data-locate-backup
              onClick={() =>
                void run(async () => {
                  const h = await loadBackupFolderHandle().catch(() => null);
                  if (!h) throw new Error("Nenhuma pasta de backup configurada (Configurações → Backup e ambiente).");
                  if ((await h.queryPermission({ mode: "readwrite" })) !== "granted" && (await h.requestPermission({ mode: "readwrite" })) !== "granted")
                    throw new Error("Acesso à pasta de backup não concedido.");
                  return locateIn(h);
                })
              }
            >
              Buscar no backup
            </TaButton>
          )}
        </div>
        {progress && (
          <p className="text-theme-xs text-gray-500" data-locate-progress>
            {PHASE_TEXT[progress.phase]}… {progress.total ? `${progress.done} de ${progress.total}` : `${progress.done} arquivo(s)`}
          </p>
        )}
        <p className="text-theme-xs text-gray-500">
          Escolha a pasta onde os arquivos estão agora (pode ser a pasta de documentos nova, a de backup ou outra qualquer; as subpastas também são lidas). Se for
          a própria pasta de documentos, só os links mudam; se for outra, os arquivos achados são copiados para o lugar dos documentos.
        </p>
        {!isAdmin && <p className="text-theme-xs text-gray-500">Só administradores localizam documentos.</p>}
        {msg && (
          <p data-locate-result className={`rounded-lg px-3 py-2 text-theme-sm ${msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </TaPanel>
  );
}

function TypesPanel() {
  const { user } = useSession();
  const canEdit = user.role === "admin" || user.role === "gestor";
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => call("documentTypes.list", { includeInactive: true }).then(setTypes), []);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= types.length) return;
    void run(async () => {
      await call("documentTypes.update", { id: types[i]!.id, patch: { position: j } });
      await call("documentTypes.update", { id: types[j]!.id, patch: { position: i } });
    });
  };

  return (
    <TaPanel
      title="Tipos de documento"
      subtitle="A classificação é obrigatória ao anexar. A validade padrão preenche a data de validade (ex.: comprovante de endereço = 90 dias)."
    >
      {canEdit && (
        <div className="mb-4 flex max-w-lg items-center gap-2">
          <TaInput placeholder="Novo tipo (ex.: Laudo)" value={name} onChange={(e) => setName(e.target.value)} />
          <TaButton
            variant="primary"
            startIcon={<Plus size={15} />}
            disabled={!name.trim()}
            onClick={() =>
              void run(async () => {
                await call("documentTypes.create", { name });
                setName("");
              })
            }
          >
            Adicionar
          </TaButton>
        </div>
      )}
      {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {types.map((t, i) => (
          <li key={t.id} className={cn("flex flex-wrap items-center gap-3 py-2", !t.active && "opacity-50")}>
            {canEdit && (
              <span className="flex gap-1 text-gray-400">
                <button type="button" title="Subir" onClick={() => move(i, -1)}>
                  <ArrowUp size={14} />
                </button>
                <button type="button" title="Descer" onClick={() => move(i, 1)}>
                  <ArrowDown size={14} />
                </button>
              </span>
            )}
            <TaInput
              className="max-w-xs"
              defaultValue={t.name}
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== t.name && void run(() => call("documentTypes.update", { id: t.id, patch: { name: e.target.value } }))}
            />
            <label className="flex items-center gap-1.5 text-theme-xs text-gray-500">
              Validade padrão
              <TaInput
                className="w-20"
                type="number"
                min={1}
                placeholder="—"
                defaultValue={t.valid_days ?? ""}
                disabled={!canEdit}
                onBlur={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  if (v !== t.valid_days) void run(() => call("documentTypes.update", { id: t.id, patch: { validDays: v } }));
                }}
              />
              dias
            </label>
            {canEdit && <ColorPicker value={t.color} onChange={(c) => void run(() => call("documentTypes.update", { id: t.id, patch: { color: c } }))} />}
            <span className="flex items-center gap-1.5 text-theme-xs text-gray-500">
              Ativo{" "}
              <Switch
                checked={!!t.active}
                disabled={!canEdit}
                onChange={(v) => void run(() => call("documentTypes.update", { id: t.id, patch: { active: v } }))}
              />
            </span>
            {canEdit && (
              <button
                type="button"
                title="Excluir tipo"
                className="text-gray-400 hover:text-error-600"
                onClick={() =>
                  confirm(`Excluir o tipo "${t.name}"? Os documentos dele ficam como "não classificados". Vai para a lixeira, de onde pode ser restaurado.`) &&
                  void run(() => call("documentTypes.delete", { id: t.id }))
                }
              >
                <Trash2 size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </TaPanel>
  );
}

export function DocumentsSettings({ env }: { env: DbEnv }) {
  // Trocar a pasta reconfere os arquivos no painel de localizar.
  const [rev, setRev] = useState(0);
  return (
    <div className="space-y-5">
      <StoragePanel env={env} onChanged={() => setRev((r) => r + 1)} />
      <LocatePanel env={env} rev={rev} />
      <TypesPanel />
    </div>
  );
}
