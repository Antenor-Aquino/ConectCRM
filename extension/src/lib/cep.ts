// Consulta de CEP: BrasilAPI e, se falhar, ViaCEP.
export interface CepAddress {
  street: string;
  district: string;
  city: string;
  state: string;
}

export function formatCepInput(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export async function lookupCep(raw: string, fetchFn: typeof fetch = fetch): Promise<CepAddress | null> {
  const cep = raw.replace(/\D/g, "");
  if (cep.length !== 8) return null;
  try {
    const res = await fetchFn(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    if (res.ok) {
      const d = (await res.json()) as { street?: string; neighborhood?: string; city?: string; state?: string };
      if (d.city) return { street: d.street ?? "", district: d.neighborhood ?? "", city: d.city, state: d.state ?? "" };
    }
  } catch {
    /* tenta a próxima fonte */
  }
  try {
    const res = await fetchFn(`https://viacep.com.br/ws/${cep}/json/`);
    const d = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (!d.erro && d.localidade) return { street: d.logradouro ?? "", district: d.bairro ?? "", city: d.localidade, state: d.uf ?? "" };
  } catch {
    /* sem conexão */
  }
  return null;
}
