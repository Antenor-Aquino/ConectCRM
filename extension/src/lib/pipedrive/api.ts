// Cliente da API do Pipedrive (spec 09), usado pela tela de importação.
// Autentica com a chave pessoal (x-api-token). Contatos e organizações pela
// API v2 (cursor); leads pela v1 (start/limit). Limite de uso (429): espera e
// tenta de novo. Os nomes e formatos seguem a documentação pública; o código
// aceita as duas formas (v1/v2) onde elas diferem.

export const PIPEDRIVE_API = "https://api.pipedrive.com";
export const PIPEDRIVE_ORIGIN = `${PIPEDRIVE_API}/*`;

export type PdEntity = "person" | "organization" | "lead";

/** Registro como vem da API (o formato muda entre v1 e v2). */
export type PdRaw = Record<string, unknown>;

export interface PdField {
  key: string;
  name: string;
  field_type: string;
  options?: { id: number | string; label: string }[] | null;
  edit_flag?: boolean;
}

export interface PdUser {
  id: number;
  name: string;
  email: string;
  active_flag?: boolean;
}

export interface PdMe {
  id: number;
  name: string;
  email: string;
  company_name: string;
  company_domain: string;
}

export class PipedriveError extends Error {}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const LIST_PATH: Record<PdEntity, string> = { person: "/api/v2/persons", organization: "/api/v2/organizations", lead: "/v1/leads" };
const SEARCH_PATH: Record<PdEntity, string> = { person: "/api/v2/persons/search", organization: "/api/v2/organizations/search", lead: "/api/v2/leads/search" };
const FIELDS_PATH: Record<PdEntity, string> = { person: "/v1/personFields", organization: "/v1/organizationFields", lead: "/v1/dealFields" };

/** "2026-01-15 12:34:56" (v1, UTC) ou ISO → ISO. */
export function pdTime(v: unknown): string {
  const s = String(v ?? "");
  return /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? `${s.replace(" ", "T")}Z` : s;
}

export class PipedriveClient {
  constructor(
    private token: string,
    private fetchFn: FetchFn = (u, i) => fetch(u, i),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async get<T = unknown>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<{ data: T; additional_data?: Record<string, unknown> }> {
    const url = new URL(path, PIPEDRIVE_API);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(url.toString(), { headers: { "x-api-token": this.token, Accept: "application/json" } });
      } catch {
        throw new PipedriveError("Não foi possível conectar ao Pipedrive. Confira a internet e se a permissão de acesso foi concedida.");
      }
      if (res.status === 429 && attempt < 5) {
        const wait = Number(res.headers.get("retry-after")) || Number(res.headers.get("x-ratelimit-reset")) || 2 ** attempt;
        await this.sleep(Math.min(60, Math.max(1, wait)) * 1000);
        continue;
      }
      const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string; additional_data?: Record<string, unknown> } | null;
      if (res.status === 401 || res.status === 403) throw new PipedriveError("Chave da API do Pipedrive inválida ou sem permissão.");
      if (res.status === 429) throw new PipedriveError("Limite de uso da API do Pipedrive atingido. Tente de novo mais tarde.");
      if (res.status === 404) throw new PipedriveError("Registro não encontrado no Pipedrive.");
      if (!res.ok || !body || body.success === false) throw new PipedriveError(`Pipedrive: ${body?.error ?? `erro ${res.status}`}`);
      return { data: body.data as T, additional_data: body.additional_data };
    }
  }

  me(): Promise<PdMe> {
    return this.get<PdMe>("/v1/users/me").then((r) => r.data);
  }

  users(): Promise<PdUser[]> {
    return this.get<PdUser[]>("/v1/users").then((r) => r.data ?? []);
  }

  /** Campos (padrão e personalizados) da entidade; leads usam os campos de negócio. */
  async fields(entity: PdEntity): Promise<PdField[]> {
    const out: PdField[] = [];
    for (let start = 0; ; ) {
      const r = await this.get<PdField[]>(FIELDS_PATH[entity], { start, limit: 500 });
      out.push(...(r.data ?? []));
      const pg = r.additional_data?.pagination as { more_items_in_collection?: boolean; next_start?: number } | undefined;
      if (!pg?.more_items_in_collection || pg.next_start === undefined) return out;
      start = pg.next_start;
    }
  }

  leadLabels(): Promise<{ id: string; name: string }[]> {
    return this.get<{ id: string; name: string }[]>("/v1/leadLabels").then((r) => r.data ?? []);
  }

  async getOne(entity: PdEntity, id: string): Promise<PdRaw> {
    return (await this.get<PdRaw>(`${LIST_PATH[entity]}/${encodeURIComponent(id)}`)).data;
  }

  /** Vários pelo id: contatos/organizações em lotes (ids=...), o que faltar um a um. */
  async getMany(entity: PdEntity, ids: string[], onProgress?: (done: number) => void): Promise<PdRaw[]> {
    const unique = [...new Set(ids)];
    const found = new Map<string, PdRaw>();
    if (entity !== "lead") {
      for (let i = 0; i < unique.length; i += 100) {
        const part = unique.slice(i, i + 100);
        try {
          const r = await this.get<PdRaw[]>(LIST_PATH[entity], { ids: part.join(","), limit: 500 });
          for (const x of r.data ?? []) if (part.includes(String(x.id))) found.set(String(x.id), x);
        } catch {
          /* sem filtro por ids: busca um a um abaixo */
        }
        onProgress?.(found.size);
      }
    }
    for (const id of unique) {
      if (found.has(id)) continue;
      try {
        found.set(id, await this.getOne(entity, id));
      } catch (e) {
        if (!(e instanceof PipedriveError && /não encontrado/.test(e.message))) throw e;
      }
      onProgress?.(found.size);
    }
    return unique.map((id) => found.get(id)).filter((x): x is PdRaw => !!x);
  }

  /** Busca pelo nome (contatos também por e-mail e telefone); devolve os registros completos. */
  async search(entity: PdEntity, term: string, limit = 50): Promise<PdRaw[]> {
    const fields = entity === "person" ? "name,email,phone" : entity === "organization" ? "name" : "title";
    const r = await this.get<{ items?: { item: PdRaw }[] }>(SEARCH_PATH[entity], { term: term.trim(), fields, limit });
    const ids = (r.data?.items ?? []).map((x) => String(x.item.id));
    return this.getMany(entity, ids);
  }

  /**
   * Criados no período (datas locais "aaaa-mm-dd", inclusive): percorre do mais
   * novo para o mais antigo e para ao passar do início. `max` limita o total.
   */
  async listCreated(
    entity: PdEntity,
    from: string,
    to: string,
    opts: { max?: number; onProgress?: (seen: number) => void } = {},
  ): Promise<{ items: PdRaw[]; truncated: boolean }> {
    const start = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
    const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
    const max = opts.max ?? 2000;
    const items: PdRaw[] = [];
    let seen = 0;
    const take = (page: PdRaw[]): boolean => {
      for (const x of page) {
        seen++;
        const t = new Date(pdTime(x.add_time)).getTime();
        if (t < start) return false;
        if (t <= end) items.push(x);
        if (items.length >= max) return false;
      }
      return true;
    };
    if (entity === "lead") {
      for (let s = 0; ; s += 500) {
        const r = await this.get<PdRaw[]>(LIST_PATH.lead, { start: s, limit: 500, sort: "add_time DESC" });
        const page = r.data ?? [];
        const more = take(page);
        opts.onProgress?.(seen);
        if (!more || page.length < 500) break;
      }
    } else {
      let cursor: string | undefined;
      do {
        const r = await this.get<PdRaw[]>(LIST_PATH[entity], { limit: 500, sort_by: "add_time", sort_direction: "desc", cursor });
        const more = take(r.data ?? []);
        opts.onProgress?.(seen);
        cursor = more ? ((r.additional_data?.next_cursor as string | null | undefined) ?? undefined) : undefined;
      } while (cursor);
    }
    return { items, truncated: items.length >= max };
  }
}
