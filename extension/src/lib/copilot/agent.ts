// Copiloto de IA do CRM (Fase 11), na mesma lógica do Copiloto Financeiro da
// gestao-financeira-extensao: a IA nunca recebe o banco nem calcula nada; ela
// escolhe quais consultas rodar (tools.ts → db/copilot.ts, SQL de verdade com
// a permissão do usuário) e entrega a resposta pela ferramenta "responder",
// reorganizando os números que já vieram das consultas. Ações (tarefa, nota)
// só são sugeridas — quem aplica é o usuário, com um clique.
import { AI_DEFAULT_MODELS, AI_LABELS, translateAiError, type AiProvider, type AiSettings } from "../ai";
import { DATA_TOOLS, normalizeCard, RESPOND_TOOL, type CopilotCard, type Schema, type ToolDef } from "./tools";
import { errorText } from "../errors";

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
  /** Título do cartão aberto (para a IA e para confirmar ao usuário). */
  cardTitle?: string | null;
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
      "Os resultados das ferramentas NÃO ficam no histórico e o CRM muda durante a conversa (atividades e negócios novos, concluídos, movidos): " +
      "a CADA pergunta, consulte as ferramentas de novo, mesmo que já tenha respondido algo parecido. Nunca repita uma resposta anterior sem consultar.",
    `QUEM: 'eu', 'meu', 'minhas' = ${c.userName}; passe esse nome em 'responsavel' quando a pergunta for sobre o próprio usuário.`,
    "TAREFAS: atrasada = pendente com a finalização vencida ou, sem finalização, com o início num dia anterior a hoje. " +
      "Para 'atrasadas' ou 'a mais atrasada', use listar_tarefas com situacao 'atrasadas' (vem da mais antiga para a mais recente, com atrasadaHaDias). " +
      "Se vier vazio, confira também situacao 'pendentes' antes de dizer que não há nada pendente.",
    "PERÍODOS: converta 'este mês', 'mês passado', 'trimestre', 'este ano' etc. em datas AAAA-MM-DD a partir de hoje antes de chamar resumo_comercial.",
    "NOMES: funil e responsável aceitam parte do nome. Se a ferramenta devolver 'erro' com 'opcoes', mostre as opções e pergunte qual é; não adivinhe.",
    "PANORAMA: para 'como estou', 'pontos de atenção' ou 'o que fazer hoje', combine listar_tarefas (atrasadas e hoje), negocios_parados e resumo_comercial do mês atual.",
    "NEGÓCIO ESPECÍFICO: localize com buscar_cartoes e depois use detalhar_cartao; para resumir, cubra situação, histórico recente (notas e atividades), riscos e próximo passo.",
    "",
    "RESPOSTA: termine SEMPRE chamando a ferramenta 'responder'. Use 'tabela' quando houver linhas comparáveis (lista de negócios, atividades, responsáveis); senão null. " +
      "Até 3 insights, cada um com o valor-chave entre **dois asteriscos** e um tom (alerta para atraso/risco/perda, positivo para ganho/folga, neutro para o resto). " +
      "Em 'sugestoes', 2 a 4 próximos pedidos que façam sentido (regra de SUGESTÕES abaixo).",
    "AÇÕES: em 'acoes', sugira até 3 ações concretas que o usuário aplica com um clique, só com ids que vieram das ferramentas nesta pergunta: " +
      "criar_tarefa (cartaoId, titulo e quando em AAAA-MM-DDTHH:MM, em horário comercial e no futuro), adicionar_nota (cartaoId e texto), abrir_cartao (cartaoId) " +
      "ou criar_cartao (titulo, funilId e etapaId de estrutura_do_crm; cartaoId vazio). " +
      "Você NÃO grava nada no CRM: nunca diga que criou; diga que o usuário confirma pelo botão. Sem ação útil, acoes = [].",
    "CRIAR CARTÃO: quando o usuário pedir para criar um negócio/ticket/etapa (ex.: 'crie no funil Casa o cartão Conserto Gaveta Miguel'), NÃO pergunte se ele quer: " +
      "consulte estrutura_do_crm (funil e etapa pelo nome; sem etapa informada, a primeira), confira com buscar_cartoes se já existe cartão com nome igual ou parecido " +
      "e entregue a ação criar_cartao pronta, dizendo 'Confirme no botão abaixo para criar'. Se existir parecido, avise e ofereça também abrir_cartao do existente.",
    "PEDIDOS: o usuário dita por voz; nomes podem vir com erro ('Concerto' por 'Conserto'). buscar_cartoes já tolera nomes parecidos (campo nomeParecido): " +
      "se só achar parecido, mostre-o como provável ('Encontrei Conserto Gaveta Miguel'). Pedido claro é ordem: execute (consulte e entregue a ação) em vez de perguntar. " +
      "'Sim', 'pode', 'crie' ou um clique numa sugestão confirmam o que você ofereceu na resposta anterior.",
    "SUGESTÕES: escreva como o próximo pedido do usuário, no imperativo e sem ponto de interrogação, porque o clique envia o texto como se ele tivesse digitado " +
      "(ex.: 'Crie o cartão Conserto Gaveta Miguel no funil Casa', 'Liste minhas atividades atrasadas'). Nunca 'Você quer…?'.",
    "CRIAR TAREFA OU NOTA: pedido de atividade ou tarefa (mesmo ditado como 'criou/cria a tarefa X para dia 18 às 8 horas'; tarefa é um tipo de atividade) é ordem: entregue criar_tarefa pronta, com titulo " +
      "e quando em AAAA-MM-DDTHH:MM (ano atual; se a data já passou, o próximo ano; sem hora, 09:00). Nota: adicionar_nota com o texto pedido. Não liste atividades no lugar de criar.",
    c.cardId
      ? `CONTEXTO DO CARTÃO: o Copiloto foi aberto no cartão ${c.cardTitle ? `"${c.cardTitle}" ` : ""}(id ${c.cardId}). Tudo nesta conversa se refere a ESTE cartão, ` +
        "a não ser que o usuário cite outro cartão, contato, organização ou funil: 'crie uma atividade', 'adicione uma nota', 'resuma', 'próximo passo', 'deste negócio' " +
        `valem para ele. Em criar_tarefa, adicionar_nota e abrir_cartao use cartaoId ${c.cardId} (não procure nem use outro cartão). ` +
        "Para os dados dele, use detalhar_cartao com esse id. Perguntas claramente gerais ('minhas atividades atrasadas de todos os negócios', 'negócios parados') valem para o CRM todo."
      : "",
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
    return { erro: errorText(e) };
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

/** Erro do provedor com a mensagem original (para decidir um novo envio). */
class ProviderError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

async function post(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<any> {
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const raw = json?.error?.message ?? json?.error;
    throw new ProviderError(translateAiError(label, raw, resp.status), typeof raw === "string" ? raw : JSON.stringify(raw ?? ""));
  }
  return json;
}

/**
 * Modelos de raciocínio da OpenAI (ex.: GPT-5.x) só aceitam ferramentas no Chat Completions com
 * reasoning_effort "none"; os demais recusam o parâmetro. Envia sem e, se o modelo pedir, repete com ele
 * (e lembra o modelo para os próximos envios).
 */
const NEEDS_NO_REASONING = new Set<string>();
async function postChat(url: string, headers: Record<string, string>, body: Record<string, unknown>, label: string, model: string): Promise<any> {
  if (NEEDS_NO_REASONING.has(model)) return post(url, headers, { ...body, reasoning_effort: "none" }, label);
  try {
    return await post(url, headers, body, label);
  } catch (e) {
    if (!(e instanceof ProviderError) || !/reasoning_effort/i.test(e.raw)) throw e;
    NEEDS_NO_REASONING.add(model);
    return post(url, headers, { ...body, reasoning_effort: "none" }, label);
  }
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
    const json = await postChat(
      url,
      { Authorization: `Bearer ${key}` },
      { model, messages, tools, tool_choice: last ? { type: "function", function: { name: RESPOND_TOOL.name } } : "auto" },
      label,
      model,
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
    if (respond) return normalizeCard(parse(respond.function.arguments), ctx.cardId);
    if (!calls.length) {
      messages.push({ role: "assistant", content: msg.content ?? "" }, { role: "user", content: FORCE_RESPOND });
      const forced = await post(url, { Authorization: `Bearer ${key}` }, { model, messages, tools, tool_choice: { type: "function", function: { name: RESPOND_TOOL.name } } }, label);
      const call = forced.choices?.[0]?.message?.tool_calls?.[0];
      if (!call) throw new Error(`O ${label} não montou a resposta.`);
      return normalizeCard(parse(call.function.arguments), ctx.cardId);
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
    if (respond) return normalizeCard(respond.input, ctx.cardId);
    messages.push({ role: "assistant", content });
    if (!uses.length) {
      messages.push({ role: "user", content: FORCE_RESPOND });
      const forced = await call({ type: "tool", name: RESPOND_TOOL.name });
      const use = (forced.content ?? []).find((b: any) => b.type === "tool_use");
      if (!use) throw new Error("O Claude não montou a resposta.");
      return normalizeCard(use.input, ctx.cardId);
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
    if (respond) return normalizeCard(respond.args, ctx.cardId);
    contents.push({ role: "model", parts });
    if (!fcs.length) {
      contents.push({ role: "user", parts: [{ text: FORCE_RESPOND }] });
      const forced = await call(true);
      const fc = (forced.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.functionCall)?.functionCall;
      if (!fc) throw new Error("O Gemini não montou a resposta.");
      return normalizeCard(fc.args, ctx.cardId);
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

// ---------- Uma chamada com ferramenta obrigatória (extração estruturada) ----------

/**
 * Pede à IA uma única chamada de `tool` (resposta estruturada no esquema dela),
 * com texto e, se houver, imagens PNG em base64 (cabeçalho, páginas escaneadas).
 * Devolve os argumentos da chamada.
 */
export async function forcedToolCall(settings: AiSettings, system: string, text: string, images: string[], tool: ToolDef): Promise<Record<string, unknown>> {
  const { prov, key, model } = credentials(settings);
  const label = AI_LABELS[prov];
  if (prov === "claude") {
    const json = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      {
        model,
        max_tokens: 4096,
        system,
        messages: [
          {
            role: "user",
            content: [...images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } })), { type: "text", text }],
          },
        ],
        tools: [{ name: tool.name, description: tool.description, input_schema: jsonSchema(tool.parameters) }],
        tool_choice: { type: "tool", name: tool.name },
      },
      label,
    );
    const use = (json.content ?? []).find((b: any) => b.type === "tool_use");
    if (!use) throw new Error(`O ${label} não devolveu os dados.`);
    return use.input ?? {};
  }
  if (prov === "gemini") {
    const json = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": key },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [...images.map((data) => ({ inline_data: { mime_type: "image/png", data } })), { text }] }],
        tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: geminiSchema(tool.parameters) }] }],
        toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [tool.name] } },
      },
      label,
    );
    const fc = (json.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.functionCall)?.functionCall;
    if (!fc) throw new Error(`O ${label} não devolveu os dados.`);
    return fc.args ?? {};
  }
  // OpenAI e DeepSeek (DeepSeek não lê imagens: vai só o texto).
  const url = prov === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.deepseek.com/chat/completions";
  const content =
    prov === "openai" && images.length
      ? [...images.map((data) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${data}` } })), { type: "text", text }]
      : text;
  const json = await postChat(
    url,
    { Authorization: `Bearer ${key}` },
    {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: jsonSchema(tool.parameters) } }],
      tool_choice: { type: "function", function: { name: tool.name } },
    },
    label,
    model,
  );
  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error(`O ${label} não devolveu os dados.`);
  try {
    return JSON.parse(call.function.arguments || "{}");
  } catch {
    throw new Error(`O ${label} devolveu os dados num formato inválido. Tente de novo.`);
  }
}
