// Configurações → Notificações → Som (spec 10): som dos avisos do Chrome,
// volume, som por tipo de aviso, repetição e horário sem som. É deste
// computador (não do usuário) e salva na hora.
import { useEffect, useRef, useState } from "react";
import { BellRing, Play, Volume1, Volume2, VolumeX } from "lucide-react";
import { TaButton, TaInput, TaPanel, TaSelect } from "@tailadmin";
import {
  DEFAULT_SOUND,
  SOUNDS,
  SOUND_CATEGORY_LABEL,
  loadSoundSettings,
  playSound,
  saveSoundSettings,
  type SoundCategory,
  type SoundId,
  type SoundSettings,
} from "../../lib/notify/sounds";
import { Switch } from "../ui/Switch";

export function SoundSettingsPanel() {
  const [s, setS] = useState<SoundSettings>(DEFAULT_SOUND);
  const [saved, setSaved] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const [permission, setPermission] = useState<string | null>(null);

  useEffect(() => {
    void loadSoundSettings().then(setS);
    chrome.notifications?.getPermissionLevel?.((level) => setPermission(level));
  }, []);

  const update = (patch: Partial<SoundSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    void saveSoundSettings(next).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  };
  const test = (id: SoundId) => {
    audio.current ??= new AudioContext();
    void playSound(audio.current, id, s.volume);
  };
  const VolIcon = s.volume === 0 ? VolumeX : s.volume < 50 ? Volume1 : Volume2;

  return (
    <TaPanel
      title="Som e janela de aviso"
      subtitle="Como os avisos aparecem e tocam neste computador. É salvo na hora."
      action={saved ? <span className="text-theme-xs text-success-600">Salvo</span> : undefined}
    >
      <div className="space-y-4" data-sound-settings>
        <div className="rounded-xl border border-brand-200 bg-brand-25 p-3 dark:border-brand-500/30 dark:bg-brand-500/10">
          <label className="flex items-start gap-3 text-theme-sm text-gray-700 dark:text-gray-300">
            <Switch checked={s.window} onChange={(window) => update({ window })} />
            <span>
              Mostrar os avisos numa janela do CRM <span className="text-theme-xs text-brand-600">(recomendado)</span>
              <span className="block text-theme-xs text-gray-500">
                A janelinha aparece no canto da tela com Concluir, Adiar, Abrir e OK — mesmo quando o Windows esconde as notificações do Chrome (notificações
                desligadas ou &quot;Não perturbe&quot;/Assistente de foco).
              </span>
            </span>
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2 pl-12">
            <TaButton size="sm" startIcon={<BellRing size={14} />} onClick={() => void chrome.runtime.sendMessage({ target: "background", kind: "alert-action", id: "", action: "test" })} data-alert-test>
              Testar aviso
            </TaButton>
            {permission === "denied" && <span className="text-theme-xs text-error-600">As notificações do Chrome estão bloqueadas para o CRM.</span>}
          </div>
          <p className="mt-2 pl-12 text-theme-xs text-gray-500">
            Não vê o balão do Chrome? No Windows: Configurações → Sistema → Notificações → ative <b>Google Chrome</b> e desligue o <b>Não perturbe</b>. No Mac: Ajustes do
            Sistema → Notificações → Google Chrome.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-theme-sm text-gray-700 dark:text-gray-300">
            <span className="block">Som</span>
            <TaSelect className="mt-1 w-48" value={s.sound} aria-label="Som dos avisos" onChange={(e) => update({ sound: e.target.value as SoundId })}>
              {SOUNDS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </TaSelect>
          </label>
          <TaButton size="sm" startIcon={<Play size={14} />} disabled={s.sound === "none" || s.volume === 0} onClick={() => test(s.sound)} data-sound-test>
            Testar
          </TaButton>
          <label className="flex min-w-[260px] flex-1 items-center gap-3 text-theme-sm text-gray-700 dark:text-gray-300">
            <VolIcon size={18} className="shrink-0 text-gray-500" />
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={s.volume}
              aria-label="Volume"
              className="w-full accent-brand-500"
              onChange={(e) => setS({ ...s, volume: Number(e.target.value) })}
              // Salva e toca ao soltar, para ouvir o volume escolhido.
              onPointerUp={() => {
                update({ volume: s.volume });
                if (s.sound !== "none") test(s.sound);
              }}
              onKeyUp={() => update({ volume: s.volume })}
              data-sound-volume
            />
            <span className="w-10 text-right tabular-nums">{s.volume}%</span>
          </label>
        </div>

        <div>
          <p className="mb-2 text-theme-sm font-medium text-gray-700 dark:text-gray-300">Som por tipo de aviso</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(SOUND_CATEGORY_LABEL) as SoundCategory[]).map((c) => (
              <label key={c} className="text-theme-xs text-gray-500">
                {SOUND_CATEGORY_LABEL[c]}
                <span className="mt-1 flex items-center gap-1.5">
                  <TaSelect
                    className="flex-1"
                    value={s.perCategory[c] ?? ""}
                    aria-label={`Som: ${SOUND_CATEGORY_LABEL[c]}`}
                    onChange={(e) => update({ perCategory: { ...s.perCategory, [c]: (e.target.value || undefined) as SoundId | undefined } })}
                  >
                    <option value="">Igual ao geral</option>
                    {SOUNDS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </TaSelect>
                  <button
                    type="button"
                    title="Testar"
                    className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:text-brand-600 dark:border-gray-700"
                    onClick={() => test(s.perCategory[c] ?? s.sound)}
                  >
                    <Play size={13} />
                  </button>
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-3 text-theme-sm text-gray-700 dark:text-gray-300">
          <Switch checked={s.repeat} onChange={(repeat) => update({ repeat })} />
          <span>
            Repetir o som enquanto o aviso não for visto
            <span className="block text-theme-xs text-gray-500">Toca de novo a cada 1 minuto, até 3 vezes, se o aviso ainda estiver na tela.</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3 text-theme-sm text-gray-700 dark:text-gray-300">
          <Switch checked={s.quiet.enabled} onChange={(enabled) => update({ quiet: { ...s.quiet, enabled } })} />
          Sem som das
          <TaInput type="time" className="w-32" value={s.quiet.from} aria-label="Sem som a partir de" onChange={(e) => update({ quiet: { ...s.quiet, from: e.target.value } })} />
          às
          <TaInput type="time" className="w-32" value={s.quiet.to} aria-label="Sem som até" onChange={(e) => update({ quiet: { ...s.quiet, to: e.target.value } })} />
          <span className="w-full text-theme-xs text-gray-500">Nesse horário os avisos aparecem normalmente, só que sem tocar.</span>
        </div>
      </div>
    </TaPanel>
  );
}
