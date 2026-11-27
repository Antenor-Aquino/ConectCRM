// Radar Caixa Escolar MG (spec 25): robô local (Python) que acha no portal
// Caixa Escolar os orçamentos com as palavras-chave e acompanha as propostas.
// O ConectCRM lê a rota /api/crm/oportunidades dele (só leitura, no mesmo
// computador) e o service worker transforma em cartões a cada 10 min. O Radar
// só aceita a origem desta extensão (ID fixo pelo "key" do manifest).
import type { RadarDecisao, RadarInicio, RadarOportunidade, RadarParecido, RadarSyncConfig, RadarSyncResult } from "../db/radar";

export const RADAR_DEFAULT_URL = "http://127.0.0.1:8765";
const KEY = "conectcrm-radar";

export interface RadarSettings {
  url: string;
  active: boolean;
  pipelineId: string | null;
  stageEntrada: string | null;
  stageEnviada: string | null;
  stageGanha: string | null;
  /** Palavras-chave que viram cartão (vazio = todas as do Radar). */
  termos: string[];
  inicio: RadarInicio;
  /** Quando a integração foi ligada pela primeira vez. */
  ativadoEm: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  lastResult: Pick<RadarSyncResult, "created" | "updated" | "skipped"> & { errors: number } | null;
  /** Do último contato com o Radar. */
  radarVersao: string | null;
  termosRadar: string[];
  /** Orçamentos parecidos com cartões existentes, aguardando a decisão (da última leitura). */
  parecidos: RadarParecido[];
  /** Decisões já tomadas, por idBudget. */
  decisoes: Record<string, RadarDecisao>;
}

const DEFAULTS: RadarSettings = {
  url: RADAR_DEFAULT_URL,
  active: false,
  pipelineId: null,
  stageEntrada: null,
  stageEnviada: null,
  stageGanha: null,
  termos: [],
  inicio: "abertas",
  ativadoEm: null,
  lastSyncAt: null,
  lastError: null,
  lastResult: null,
  radarVersao: null,
  termosRadar: [],
  parecidos: [],
  decisoes: {},
};

export async function loadRadar(): Promise<RadarSettings> {
  return { ...DEFAULTS, ...((await chrome.storage.local.get(KEY))[KEY] as Partial<RadarSettings> | undefined) };
}

export async function saveRadar(s: RadarSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

/** Endereço do Radar normalizado. Só o próprio computador (127.0.0.1 ou localhost). */
export function radarBaseUrl(url: string): string {
  let u: URL;
  try {
    u = new URL((url || RADAR_DEFAULT_URL).trim().replace(/\/+$/, ""));
  } catch {
    throw new Error("Endereço do Radar inválido. Use, por exemplo, http://127.0.0.1:8765.");
  }
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(u.hostname))
    throw new Error("O Radar roda neste computador: o endereço precisa ser http://127.0.0.1:PORTA ou http://localhost:PORTA.");
  return `${u.protocol}//${u.host}`;
}

/** Permissão de acesso ao Radar (vale para qualquer porta do host). Pedir direto no clique. */
export function requestRadarPermission(url: string): Promise<boolean> {
  if (!chrome.permissions?.request) return Promise.resolve(true);
  const host = new URL(radarBaseUrl(url)).hostname;
  return chrome.permissions.request({ origins: [`http://${host}/*`] });
}

async function get<T>(url: string, path: string): Promise<T> {
  const base = radarBaseUrl(url);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { cache: "no-store" });
  } catch {
    throw new Error(`O Radar não respondeu em ${base}. Confira se o robô está ligado (atalho “Radar Caixa Escolar MG”).`);
  }
  if (res.status === 403) throw new Error("O Radar recusou o acesso. Atualize o Radar para a versão 1.16 ou mais nova (ou confira o CONECTCRM_ID no .env dele).");
  if (res.status === 404) throw new Error("Este Radar não tem a integração com o ConectCRM. Atualize-o para a versão 1.16 ou mais nova.");
  if (!res.ok) throw new Error(`O Radar respondeu com erro (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

export interface RadarDados {
  radar: { versao: string; termos: string[]; outraEmpresa?: string };
  geradoEm: string;
  oportunidades: RadarOportunidade[];
}

export function fetchRadar(url: string): Promise<RadarDados> {
  return get<RadarDados>(url, "/api/crm/oportunidades");
}

/** Configuração do sincronismo, ou null se a integração não está pronta. */
export function radarSyncConfig(s: RadarSettings): RadarSyncConfig | null {
  if (!s.active || !s.pipelineId || !s.ativadoEm) return null;
  return {
    pipelineId: s.pipelineId,
    stageEntrada: s.stageEntrada,
    stageEnviada: s.stageEnviada,
    stageGanha: s.stageGanha,
    termos: s.termos,
    inicio: s.inicio,
    ativadoEm: s.ativadoEm,
    decisoes: s.decisoes,
  };
}
