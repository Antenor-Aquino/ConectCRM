// Roteador de IA portado do wa-pipedrive: Gemini, OpenAI, Claude e DeepSeek.
// As chaves ficam só neste computador (chrome.storage.local) e as chamadas
// saem direto do navegador para o provedor escolhido.
export type AiProvider = "gemini" | "openai" | "claude" | "deepseek";

export const AI_LABELS: Record<AiProvider, string> = { gemini: "Gemini", openai: "OpenAI", claude: "Claude", deepseek: "DeepSeek" };
export const AI_DEFAULT_MODELS: Record<AiProvider, string> = { gemini: "gemini-2.5-flash", openai: "gpt-4.1-mini", claude: "claude-sonnet-5-5", deepseek: "deepseek-chat" };
/** Provedores que transcrevem áudio (Gemini direto; OpenAI pelo Whisper). */
export const AI_TRANSCRIBES: AiProvider[] = ["gemini", "openai"];
/** Provedores que leem imagens (o DeepSeek não lê). */
export const AI_READS_IMAGES: AiProvider[] = ["gemini", "openai", "claude"];

export interface AiSettings {
  provider: AiProvider;
  keys: Partial<Record<AiProvider, string>>;
  models: Partial<Record<AiProvider, string>>;
  /** Prompt 1 (análise comercial) e 2 (transcrição); vazio = padrão. */
  prompt1: string;
  prompt2: string;
}

export const AI_SETTINGS_KEY = "conectcrm-ai";
const PLACEHOLDER = "[Cole as mensagens do WhatsApp aqui]";

export const DEFAULT_AI_PROMPT = `Você é um Gerente Comercial sênior com ampla experiência em gestão de pipeline, inteligência de vendas e CRM. O seu objetivo é analisar o histórico de conversas fornecido (mensagens de WhatsApp, em texto ou em imagens/recortes de tela) e produzir um registro para o nosso CRM em DUAS partes, nesta ordem:

PARTE 1 — TRANSCRIÇÃO NA ÍNTEGRA
- Transcreva a conversa COMPLETA, na ordem cronológica, sem resumir e sem omitir mensagens.
- Para cada mensagem use o formato: "Nome/Remetente (DD/MM/AAAA HH:MM): mensagem". Se a data ou hora não estiver visível, use o que houver (ex.: só a hora) e não invente.
- Para mídias, transcreva o marcador correspondente: [Áudio], [Imagem], [anexo: nome.pdf]. Não tente adivinhar o conteúdo de áudios ou arquivos.
- Ao final da transcrição, insira uma linha com "---" antes de iniciar a PARTE 2.

PARTE 2 — RESUMO EXECUTIVO
Inicie a Parte 2 EXATAMENTE com este cabeçalho, preenchendo com os dados extraídos da própria conversa:
Conversa referente a: [nome da pessoa/contato]. Período: [DD/MM/AAAA] a [DD/MM/AAAA].
[Incluir a linha a seguir SOMENTE se houver imagens/recortes na análise:] As imagens constam anexadas no histórico.

Se o nome ou o período não puderem ser identificados com segurança no conteúdo, escreva "[pessoa não identificada]" ou "[período não identificado]" — NÃO invente.

Em seguida, deixe uma linha em branco e produza o resumo estritamente com os tópicos abaixo:

**Status do lead:**
- Em uma linha, classifique a temperatura do lead como Quente, Morno ou Frio, seguida de uma justificativa curta (ex: "Morno - demonstrou interesse, mas adiou a decisão por prioridades concorrentes.").

**Contexto:**
- Escreva uma única linha resumindo de forma direta o objetivo do contato (ex: "Follow-up sobre proposta da Perseus para a LabPub.").

**Pontos principais discutidos:**
- Liste em formato de tópicos (usando estritamente o sinal de hífen "-") as principais decisões, justificativas ou atualizações trazidas pelo cliente. Seja conciso e direto.

**Interesses, dores ou objeções do contato:**
- Identifique os sentimentos e barreiras do cliente utilizando a estrutura exata de sub-tópicos com hífen "-":
  - Interesse: [O que o contato gostou ou demonstrou valor]
  - Objeção/Pendente: [O principal motivo pelo qual a venda não avançou no momento ou prioridades concorrentes]

**Próximos passos / pendências:**
- Liste com hífen "-" a próxima ação clara e com prazo/data específica determinada na conversa. Caso nenhuma ação com prazo tenha sido acordada, registre: "- Nenhuma ação com prazo foi definida na conversa."

**Follow-up sugerido:**
- Data sugerida: indique uma data ou janela para o próximo contato. Derive-a de gatilhos reais da conversa (ex: cliente pediu para retomar "em outubro" -> sugira o início de outubro). Se não houver gatilho de prazo na conversa, sugira um intervalo padrão e sinalize que é uma estimativa (ex: "~7 dias (estimativa, sem prazo definido pelo cliente)").
- Canal sugerido: indique o canal mais adequado para a retomada (WhatsApp, ligação, e-mail ou reunião), com base no tom e no histórico da conversa.
- Abordagem sugerida: escreva 1 a 2 frases curtas com o ângulo recomendado para o próximo contato, conectando-o à principal objeção ou interesse identificado.

---
DIRETRIZES CRÍTICAS (Siga à risca):
1. Use os títulos principais do resumo exatamente em negrito (ex: **Status do lead:**, **Contexto:**, etc.).
2. Utilize exclusivamente o hífen "-" seguido de espaço para os itens de lista. Nunca use asteriscos como marcador de tópicos.
3. Não adicione textos de introdução ("Aqui está...") nem saudações. A resposta deve começar direto na PARTE 1 (transcrição) e terminar no último item de Follow-up sugerido.
4. Mantenha o tom profissional, corporativo e focado em fatos comerciais.
5. NÃO INVENTE informações. Baseie-se estritamente no que está na conversa. Quando um dado não estiver presente, registre "- Não informado na conversa." em vez de supor.
6. A conversa pode conter marcadores de mídia como [Áudio], [Imagem] ou [anexo: arquivo.pdf]. Considere-os como contexto, mas não tente adivinhar o conteúdo da mídia.
7. Se a conversa não for de natureza comercial (ex: discussão técnica, suporte ou grupo interno), não force o enquadramento de vendas: preencha o "Status do lead" como "Não se aplica - conversa não comercial" e marque os tópicos sem informação correspondente como "- Não se aplica.".

Aqui está o histórico da conversa para análise:
[Cole as mensagens do WhatsApp aqui]`;

export const DEFAULT_AI_PROMPT2 = `Transcreva na íntegra o conteúdo das imagens/recortes a seguir (conversa de WhatsApp ou documento), na ordem cronológica, sem resumir e sem omitir nada.

- Para cada mensagem use o formato: "Nome/Remetente (DD/MM/AAAA HH:MM): mensagem". Se a data ou hora não estiver visível, use o que houver e não invente.
- Para mídias, transcreva o marcador correspondente: [Áudio], [Imagem], [anexo: nome.pdf]. Não tente adivinhar o conteúdo de áudios ou arquivos.
- Não adicione comentários, resumo, títulos nem saudações. Responda apenas com a transcrição.

[Cole as mensagens do WhatsApp aqui]`;

export const EMPTY_AI_SETTINGS: AiSettings = { provider: "gemini", keys: {}, models: {}, prompt1: "", prompt2: "" };

export async function loadAiSettings(): Promise<AiSettings> {
  const saved = (await chrome.storage.local.get(AI_SETTINGS_KEY))[AI_SETTINGS_KEY] as Partial<AiSettings> | undefined;
  return { ...EMPTY_AI_SETTINGS, ...saved, keys: { ...saved?.keys }, models: { ...saved?.models } };
}

export async function saveAiSettings(s: AiSettings): Promise<void> {
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: s });
}

export function aiConfigured(s: AiSettings): boolean {
  return !!s.keys[s.provider]?.trim();
}

/** Traduz erros dos provedores para pt-BR (mesmas regras do wa-pipedrive). */
export function translateAiError(prov: string, raw: unknown, status: number): string {
  const text = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
  const m = text.toLowerCase();
  if (m.includes("high demand") || m.includes("overloaded") || m.includes("capacity") || status === 503)
    return `O ${prov} está sobrecarregado no momento. Isso costuma ser temporário — tente novamente em alguns instantes.`;
  if (m.includes("quota") || m.includes("rate limit") || m.includes("exhausted") || m.includes("insufficient") || m.includes("billing") || status === 429)
    return `Limite de uso (ou créditos) da API do ${prov} atingido. Verifique a cota/saldo da sua chave e tente novamente.`;
  if (m.includes("api key") || m.includes("api_key") || m.includes("invalid key") || m.includes("incorrect api key") || m.includes("authentication") || m.includes("unauthorized") || m.includes("permission denied") || status === 401 || status === 403)
    return `A chave de API do ${prov} é inválida ou sem permissão. Confira em Configurações → Inteligência artificial.`;
  if (m.includes("not found") || m.includes("does not exist") || (m.includes("model") && m.includes("not")) || status === 404)
    return `Modelo do ${prov} não encontrado ou indisponível para esta chave.`;
  if (m.includes("safety") || m.includes("blocked") || m.includes("content policy")) return `O conteúdo foi bloqueado pelos filtros de segurança do ${prov}.`;
  if (m.includes("deadline") || m.includes("timeout") || m.includes("timed out") || status === 504) return `O ${prov} demorou demais para responder. Tente novamente.`;
  if (status === 500 || m.includes("internal")) return `Erro interno do ${prov}. Tente novamente em instantes.`;
  if (status === 400 && (m.includes("image") || m.includes("payload") || m.includes("too large") || m.includes("size")))
    return `A requisição ao ${prov} foi rejeitada (possível imagem muito grande). Tente com menos recortes ou imagens menores.`;
  return text ? `Erro do ${prov}: ${text}` : `Erro do ${prov} (HTTP ${status}).`;
}

function resolve(s: AiSettings): { prov: AiProvider; key: string; model: string } {
  const prov = s.provider;
  const key = s.keys[prov]?.trim() ?? "";
  if (!key) throw new Error(`Configure a chave de API do ${AI_LABELS[prov]} em Configurações → Inteligência artificial.`);
  return { prov, key, model: s.models[prov]?.trim() || AI_DEFAULT_MODELS[prov] };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<Record<string, any>> {
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const json = (await resp.json().catch(() => ({}))) as Record<string, any>;
  if (!resp.ok) throw new Error(translateAiError(label, json.error?.message ?? json.error, resp.status));
  return json;
}

/** Texto (e imagens PNG em base64) → resposta do provedor configurado. */
export async function aiGenerate(settings: AiSettings, prompt: string, images: string[] = [], maxTokens = 4000): Promise<string> {
  const { prov, key, model } = resolve(settings);
  const label = AI_LABELS[prov];
  let text: unknown;
  if (prov === "gemini") {
    const parts = [{ text: prompt }, ...images.map((data) => ({ inline_data: { mime_type: "image/png", data } }))];
    const json = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { "x-goog-api-key": key }, { contents: [{ parts }] }, label);
    text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  } else if (prov === "claude") {
    const content = [{ type: "text", text: prompt }, ...images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } }))];
    const json = await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      { model, max_tokens: maxTokens, messages: [{ role: "user", content }] },
      label,
    );
    text = json.content?.[0]?.text;
  } else {
    // OpenAI e DeepSeek usam o mesmo formato (Chat Completions).
    const url = prov === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.deepseek.com/chat/completions";
    const content = [{ type: "text", text: prompt }, ...images.map((data) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${data}` } }))];
    const json = await postJson(url, { Authorization: `Bearer ${key}` }, { model, messages: [{ role: "user", content }], max_tokens: maxTokens }, label);
    text = json.choices?.[0]?.message?.content;
  }
  if (typeof text !== "string" || !text.trim()) throw new Error(`O ${label} não retornou um resultado.`);
  return text.trim();
}

/** Recortes de tela → prompt 1 (análise comercial) ou 2 (transcrição). */
export function clipPrompt(settings: AiSettings, which: 1 | 2): string {
  const base = which === 2 ? settings.prompt2.trim() || DEFAULT_AI_PROMPT2 : settings.prompt1.trim() || DEFAULT_AI_PROMPT;
  const tail =
    which === 2
      ? "\n\nTranscreva as imagens a seguir."
      : "\n\nAnalise as imagens a seguir (recortes de tela de uma conversa/documento) e produza o resumo solicitado.";
  return base.replace(PLACEHOLDER, "(veja as imagens em anexo)") + tail;
}

export async function summarizeImages(settings: AiSettings, images: string[], which: 1 | 2): Promise<string> {
  return aiGenerate(settings, clipPrompt(settings, which), images);
}

/** Transcrição de áudio: Gemini (inline) ou OpenAI (Whisper). */
export async function transcribeAudio(settings: AiSettings, base64: string, mime: string, filename: string): Promise<string> {
  const { prov, key, model } = resolve(settings);
  if (prov === "gemini") {
    const parts = [
      { text: "Transcreva este áudio na íntegra, em português do Brasil. Responda apenas com a transcrição, sem comentários nem rótulos." },
      { inline_data: { mime_type: mime || "audio/ogg", data: base64 } },
    ];
    const json = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { "x-goog-api-key": key }, { contents: [{ parts }] }, "Gemini");
    const t = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof t !== "string" || !t.trim()) throw new Error("O Gemini não retornou transcrição.");
    return t.trim();
  }
  if (prov === "openai") {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: mime || "audio/ogg" }), filename || "audio.ogg");
    fd.append("model", "whisper-1");
    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd });
    const json = (await resp.json().catch(() => ({}))) as Record<string, any>;
    if (!resp.ok) throw new Error(translateAiError("OpenAI", json.error?.message ?? json.error, resp.status));
    if (!json.text) throw new Error("A OpenAI não retornou transcrição.");
    return String(json.text).trim();
  }
  throw new Error(`O ${AI_LABELS[prov]} não transcreve áudio. Troque para Gemini ou OpenAI em Configurações → Inteligência artificial.`);
}
