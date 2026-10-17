// Copiloto de IA do CRM (Fase 11), na mesma lógica do Copiloto Financeiro da
// gestao-financeira-extensao: a IA nunca recebe o banco nem calcula nada; ela
// escolhe quais consultas rodar (tools.ts → db/copilot.ts, SQL de verdade com
// a permissão do usuário) e entrega a resposta pela ferramenta "responder",
// reorganizando os números que já vieram das consultas. Ações (tarefa, nota)
// só são sugeridas — quem aplica é o usuário, com um clique.
import { AI_DEFAULT_MODELS, AI_LABELS, translateAiError, type AiProvider, type AiSettings } from "../ai";
import { DATA_TOOLS, normalizeCard, RESPOND_TOOL, type CopilotCard, type Schema, type ToolDef } from "./tools";

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CopilotContext {
  userName: string;
  /** "administrador", "gestor" ou "vendedor". */
  userRole: string;
  /** Cartão aberto quando a pergunta veio do detalhe do cartão. */
  cardId?: string | null;
  now?: Date;
}

/** Roda uma consulta pelo nome; erros viram { erro } para a IA explicar. */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

const MAX_ROUNDS = 8;
const TOOLS = [...DATA_TOOLS, RESPOND_TOOL];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function buildSystemPrompt(c: CopilotContext): string {
  const now = c.now ?? new Date();
  const weekday = now.toLocaleDateString("pt-BR", { weekday: "long" });
  return [
    `Você é o Copiloto do ConectCRM, um CRM de vendas, atendimento e projetos. Hoje é ${weekday}, ${ymd(now)}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} (horário local).`,
    `Você está ajudando ${c.userName} (${c.userRole}). As consultas já respeitam a permissão dele: vendedor vê só os seus cartões; gestor, os da equipe; administrador, todos.`,
    "Responda em português do Brasil, direto e objetivo, com foco comercial: o que está em risco, o que priorizar e qual o próximo passo.",
    "",
    "DADOS: para qualquer número, valor, nome ou fato do CRM, use as ferramentas. Nunca invente, estime ou recalcule valores; copie os valores já formatados que as ferramentas devolvem. " +
      "Os resultados das ferramentas NÃO ficam no histórico: numa pergunta seguinte, consulte de novo.",
    "PERÍODOS: converta 'este mês', 'mês passado', 'trimestre', 'este ano' etc. em datas AAAA-MM-DD a partir de hoje antes de chamar resumo_comercial.",
    "NOMES: funil e responsável aceitam parte do nome. Se a ferramenta devolver 'erro' com 'opcoes', mostre as opções e pergunte qual é; não adivinhe.",
    "PANORAMA: para 'como estou', 'pontos de atenção' ou 'o que fazer hoje', combine listar_tarefas (atrasadas e hoje), negocios_parados e resumo_comercial do mês atual.",
    "NEGÓCIO ESPECÍFICO: localize com buscar_cartoes e depois use detalhar_cartao; para resumir, cubra situação, histórico recente (notas e tarefas), riscos e próximo passo.",
    "",
    "RESPOSTA: termine SEMPRE chamando a ferramenta 'responder'. Use 'tabela' quando houver linhas comparáveis (lista de negócios, tarefas, responsáveis); senão null. " +
      "Até 3 insights, cada um com o valor-chave entre **dois asteriscos** e um tom (alerta para atraso/risco/perda, positivo para ganho/folga, neutro para o resto). " +
      "Em 'sugestoes', 2 a 4 perguntas de acompanhamento que façam sentido.",
    "AÇÕES: em 'acoes', sugira até 3 ações concretas que o usuário aplica com um clique, só com cartaoId que veio das ferramentas nesta pergunta: " +
      "criar_tarefa (titulo e quando em AAAA-MM-DDTHH:MM, em horário comercial e no futuro), adicionar_nota (texto) ou abrir_cartao. " +
      "Você NÃO grava nada no CRM: nunca diga que criou tarefa ou nota; diga que o usuário pode aplicar pelo botão. Sem ação útil, acoes = [].",
    c.cardId ? `CONTEXTO: o usuário está com o cartão de id ${c.cardId} aberto; quando a pergunta falar 'deste negócio', use detalhar_cartao com esse id.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const FORCE_RESPOND = "Agora entregue a resposta final chamando a ferramenta 'responder', usando só os dados já consultados acima.";

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function runTool(execute: ToolExecutor, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!DATA_TOOLS.some((t) => t.name === name)) return { erro: `Ferramenta desconhecida: ${name}` };
  try {
    return await execute(name, args ?? {});
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- Conversão dos esquemas ----------

function jsonSchema(s: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.nullable ? [s.type, "null"] : s.type };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.nullable ? [...s.enum, null] : s.enum;
  if (s.items) out.items = jsonSchema(s.items);
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, jsonSchema(v)]));
  if (s.required) out.required = s.required;
  return out;
}

function geminiSchema(s: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type.toUpperCase() };
  if (s.nullable) out.nullable = true;
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.items) out.items = geminiSchema(s.items);
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, geminiSchema(v)]));
    // Gemini recusa OBJECT sem propriedades.
    if (!Object.keys(s.properties).length) delete out.properties;
  }
  if (s.required?.length) out.required = s.required;
  return out;
}

// ---------- Chamada HTTP ----------

async function post(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<any> {
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(translateAiError(label, json?.error?.message ?? json?.error, resp.status));
  return json;
}

function credentials(s: AiSettings): { prov: AiProvider; key: string; model: string } {
  const prov = s.provider;
  const key = s.keys[prov]?.trim();
  if (!key) throw new Error(`Configure a chave de API do ${AI_LABELS[prov]} em Configurações → Inteligência artificial.`);
  return { prov, key, model: s.models[prov]?.trim() || AI_DEFAULT_MODELS[prov] };
}

// ---------- OpenAI e DeepSeek (Chat Completions) ----------

async function runOpenAiLike(s: AiSettings, history: CopilotMessage[], ctx: CopilotContext, execute: ToolExecutor): Promise<CopilotCard> {
  const { prov, key, model } = credentials(s);
  const label = AI_LABELS[prov];
  const url = prov === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.deepseek.com/chat/completions";
  const tools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: jsonSchema(t.parameters) } }));
  const messages: any[] = [{ role: "system", content: buildSystemPrompt(ctx) }, ...history];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS - 1;
    const json = await post(
      url,
      { Authorization: `Bearer ${key}` },
      { model, messages, tools, tool_choice: last ? { type: "function", function: { name: RESPOND_TOOL.name } } : "auto" },
      label,
    );
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error(`O ${label} não retornou um resultado.`);
    const calls: { id: string; function: { name: string; arguments: string } }[] = msg.tool_calls ?? [];
    const parse = (a: string) => {
      try {
        return JSON.parse(a || "{}");
      } catch {
        return {};
      }
    };
    const respond = calls.find((c) => c.function.name === RESPOND_TOOL.name);
    if (respond) return normalizeCard(parse(respond.function.arguments));
    if (!calls.length) {
      messages.push({ role: "assistant", content: msg.content ?? "" }, { role: "user", content: FORCE_RESPOND });
      const forced = await post(url, { Authorization: `Bearer ${key}` }, { model, messages, tools, tool_choice: { type: "function", function: { name: RESPOND_TOOL.name } } }, label);
      const call = forced.choices?.[0]?.message?.tool_calls?.[0];
      if (!call) throw new Error(`O ${label} não montou a resposta.`);
      return normalizeCard(parse(call.function.arguments));
    }
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
    for (const c of calls) {
      messages.push({ role: "tool", tool_call_id: c.id, content: stringify(await runTool(execute, c.function.name, parse(c.function.arguments))) });
    }
  }
  throw new Error("O Copiloto não conseguiu concluir a resposta (muitas consultas em sequência). Tente uma pergunta mais específica.");
}

// ---------- Claude (Messages API) ----------

async function runClaude(s: AiSettings, history: CopilotMessage[], ctx: CopilotContext, execute: ToolExecutor): Promise<CopilotCard> {
  const { key, model } = credentials(s);
  const headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: jsonSchema(t.parameters) }));
  const messages: any[] = history.map((h) => ({ role: h.role, content: h.content }));
  const call = (toolChoice: unknown) =>
    post("https://api.anthropic.com/v1/messages", headers, { model, max_tokens: 4096, system: buildSystemPrompt(ctx), messages, tools, tool_choice: toolChoice }, "Claude");
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS - 1;
    const json = await call(last ? { type: "tool", name: RESPOND_TOOL.name } : { type: "auto" });
    const content: any[] = json.content ?? [];
    const uses = content.filter((b) => b.type === "tool_use");
    const respond = uses.find((b) => b.name === RESPOND_TOOL.name);
    if (respond) return normalizeCard(respond.input);
    messages.push({ role: "assistant", content });
    if (!uses.length) {
      messages.push({ role: "user", content: FORCE_RESPOND });
      const forced = await call({ type: "tool", name: RESPOND_TOOL.name });
      const use = (forced.content ?? []).find((b: any) => b.type === "tool_use");
      if (!use) throw new Error("O Claude não montou a resposta.");
      return normalizeCard(use.input);
    }
    const results = [];
    for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: stringify(await runTool(execute, u.name, u.input)) });
    messages.push({ role: "user", content: results });
  }
  throw new Error("O Copiloto não conseguiu concluir a resposta (muitas consultas em sequência). Tente uma pergunta mais específica.");
}

// ---------- Gemini (generateContent) ----------

async function runGemini(s: AiSettings, history: CopilotMessage[], ctx: CopilotContext, execute: ToolExecutor): Promise<CopilotCard> {
  const { key, model } = credentials(s);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const tools = [{ functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.parameters) })) }];
  const contents: any[] = history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] }));
  const call = (force: boolean) =>
    post(
      url,
      { "x-goog-api-key": key },
      {
        systemInstruction: { parts: [{ text: buildSystemPrompt(ctx) }] },
        contents,
        tools,
        toolConfig: { functionCallingConfig: force ? { mode: "ANY", allowedFunctionNames: [RESPOND_TOOL.name] } : { mode: "AUTO" } },
      },
      "Gemini",
    );
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const json = await call(round === MAX_ROUNDS - 1);
    const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
    if (!parts.length) throw new Error("O Gemini não retornou um resultado.");
    const fcs = parts.filter((p) => p.functionCall).map((p) => p.functionCall as { name: string; args?: Record<string, unknown> });
    const respond = fcs.find((f) => f.name === RESPOND_TOOL.name);
    if (respond) return normalizeCard(respond.args);
    contents.push({ role: "model", parts });
    if (!fcs.length) {
      contents.push({ role: "user", parts: [{ text: FORCE_RESPOND }] });
      const forced = await call(true);
      const fc = (forced.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.functionCall)?.functionCall;
      if (!fc) throw new Error("O Gemini não montou a resposta.");
      return normalizeCard(fc.args);
    }
    const responses = [];
    for (const f of fcs) responses.push({ functionResponse: { name: f.name, response: { result: await runTool(execute, f.name, f.args ?? {}) } } });
    contents.push({ role: "function", parts: responses });
  }
  throw new Error("O Copiloto não conseguiu concluir a resposta (muitas consultas em sequência). Tente uma pergunta mais específica.");
}

/** Uma pergunta do usuário (com o histórico da conversa) → card de resposta. */
export async function askCopilot(settings: AiSettings, history: CopilotMessage[], ctx: CopilotContext, execute: ToolExecutor): Promise<CopilotCard> {
  if (settings.provider === "gemini") return runGemini(settings, history, ctx, execute);
  if (settings.provider === "claude") return runClaude(settings, history, ctx, execute);
  return runOpenAiLike(settings, history, ctx, execute);
}

/** Como o card volta para o histórico (a IA vê o que respondeu antes, sem os dados brutos). */
export function cardToHistory(card: CopilotCard): string {
  return stringify({ titulo: card.titulo, subtitulo: card.subtitulo, tabela: card.tabela, insights: card.insights, acoesSugeridas: card.acoes.map((a) => a.rotulo) });
}
