// Ferramentas do Copiloto (o que a IA pode consultar) e o formato do card de
// resposta. Os esquemas são escritos uma vez num formato neutro e convertidos
// para cada provedor em agent.ts.
export interface Schema {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  nullable?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Schema & { type: "object"; properties: Record<string, Schema> };
}

const str = (description: string, extra: Partial<Schema> = {}): Schema => ({ type: "string", description, ...extra });

export const DATA_TOOLS: ToolDef[] = [
  {
    name: "buscar_cartoes",
    description:
      "Lista negócios, tickets e etapas de projeto com funil, etapa, valor, contato, responsável, dias na etapa, próxima tarefa e tarefas atrasadas. " +
      "Use para perguntas sobre negócios específicos, maiores negócios, negócios de alguém ou de um funil. Devolve também o total e a soma dos valores.",
    parameters: {
      type: "object",
      properties: {
        texto: str("Parte do título, do contato ou da organização (opcional)"),
        status: str("Situação; padrão: open. won = ganho (comercial), resolvido (operacional) ou concluído (projeto); lost = perdido, não resolvido ou não concluído", {
          enum: ["open", "won", "lost", "all"],
        }),
        funil: str("Nome (ou parte) do funil (opcional)"),
        responsavel: str("Nome (ou parte) do usuário ou da equipe (opcional)"),
        limite: { type: "integer", description: "Máximo de cartões (1 a 30; padrão 20)" },
      },
    },
  },
  {
    name: "detalhar_cartao",
    description:
      "Tudo de um cartão pelo id: dados, contato (telefone/e-mail), itens, tarefas pendentes e concluídas, últimas notas, etapas percorridas com dias. " +
      "Use para resumir um negócio, entender o histórico ou sugerir o próximo passo. O id vem de buscar_cartoes ou do contexto.",
    parameters: { type: "object", properties: { id: str("Id do cartão") }, required: ["id"] },
  },
  {
    name: "resumo_comercial",
    description:
      "Indicadores de um período (mesmos números da tela Relatórios): ganhos, perdidos, conversão, ticket médio, ciclo, em aberto, previsão ponderada, " +
      "previsão por etapa, conversão do funil (só com funil), motivos de perda, desempenho por responsável e produtos vendidos.",
    parameters: {
      type: "object",
      properties: {
        de: str("Início do período, AAAA-MM-DD"),
        ate: str("Fim do período (inclusive), AAAA-MM-DD"),
        funil: str("Nome do funil (opcional; sem ele, todos os funis comerciais)"),
        responsavel: str("Nome do usuário ou da equipe (opcional)"),
      },
      required: ["de", "ate"],
    },
  },
  {
    name: "listar_tarefas",
    description: "Tarefas pendentes: atrasadas, de hoje, dos próximos 7 dias ou todas as pendentes, com cartão vinculado e responsável.",
    parameters: {
      type: "object",
      properties: {
        situacao: str("Qual recorte; padrão: pendentes", { enum: ["atrasadas", "hoje", "proximos_7_dias", "pendentes"] }),
        responsavel: str("Nome do usuário ou da equipe (opcional)"),
      },
    },
  },
  {
    name: "negocios_parados",
    description:
      "Cartões abertos sem movimento (mudança de etapa, tarefa concluída ou nota) há muitos dias. Sem 'dias', usa o limite 'parado após' de cada etapa (ou 14 dias). " +
      "Use para pontos de atenção, follow-ups esquecidos e risco no funil.",
    parameters: {
      type: "object",
      properties: {
        dias: { type: "integer", description: "Mínimo de dias sem movimento (opcional)" },
        funil: str("Nome do funil (opcional)"),
        responsavel: str("Nome do usuário ou da equipe (opcional)"),
      },
    },
  },
  {
    name: "buscar_contatos",
    description: "Contatos (pessoas) e organizações por nome, e-mail ou telefone, com os cartões abertos de cada um.",
    parameters: { type: "object", properties: { texto: str("Nome, e-mail ou telefone") }, required: ["texto"] },
  },
  {
    name: "estrutura_do_crm",
    description: "Funis com etapas (probabilidade, limite de dias parado), usuários com papel, equipes com membros, motivos de perda e tipos de tarefa.",
    parameters: { type: "object", properties: {} },
  },
];

// ---------- Card de resposta ----------

export type Tom = "alerta" | "positivo" | "neutro";
export type ActionType = "criar_tarefa" | "adicionar_nota" | "abrir_cartao";

export interface CopilotAction {
  tipo: ActionType;
  /** Texto do botão, ex.: "Criar tarefa: ligar para Regina amanhã 10h". */
  rotulo: string;
  cartaoId: string;
  /** criar_tarefa: título da tarefa. */
  titulo: string | null;
  /** criar_tarefa: data/hora local AAAA-MM-DDTHH:MM. */
  quando: string | null;
  /** adicionar_nota: texto da nota. */
  texto: string | null;
}

export interface CopilotCard {
  titulo: string;
  subtitulo: string | null;
  tabela: { colunas: string[]; linhas: { celulas: string[]; destaque: "total" | "alerta" | "normal" }[] } | null;
  insights: { texto: string; tom: Tom }[];
  acoes: CopilotAction[];
  sugestoes: string[];
}

export const RESPOND_TOOL: ToolDef = {
  name: "responder",
  description: "Entrega a resposta final ao usuário como um card. Chame sempre ao terminar, usando só números que já vieram das ferramentas.",
  parameters: {
    type: "object",
    properties: {
      titulo: str("Título curto, ex.: 'Negócios parados'"),
      subtitulo: str("Linha secundária (período, filtro aplicado) ou null", { nullable: true }),
      tabela: {
        type: "object",
        nullable: true,
        description: "Tabela quando houver linhas comparáveis; null quando não",
        properties: {
          colunas: { type: "array", items: { type: "string" } },
          linhas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                celulas: { type: "array", items: { type: "string" } },
                destaque: str("total, alerta ou normal", { enum: ["total", "alerta", "normal"] }),
              },
              required: ["celulas", "destaque"],
            },
          },
        },
        required: ["colunas", "linhas"],
      },
      insights: {
        type: "array",
        description: "Até 3 frases objetivas; o valor-chave entre **dois asteriscos**",
        items: {
          type: "object",
          properties: { texto: { type: "string" }, tom: str("alerta, positivo ou neutro", { enum: ["alerta", "positivo", "neutro"] }) },
          required: ["texto", "tom"],
        },
      },
      acoes: {
        type: "array",
        description: "Até 3 ações que o usuário pode aplicar com um clique (só com cartaoId vindo das ferramentas); [] quando não houver",
        items: {
          type: "object",
          properties: {
            tipo: str("Tipo da ação", { enum: ["criar_tarefa", "adicionar_nota", "abrir_cartao"] }),
            rotulo: str("Texto do botão"),
            cartaoId: str("Id do cartão"),
            titulo: str("criar_tarefa: título da tarefa; senão null", { nullable: true }),
            quando: str("criar_tarefa: data e hora local AAAA-MM-DDTHH:MM; senão null", { nullable: true }),
            texto: str("adicionar_nota: texto da nota; senão null", { nullable: true }),
          },
          required: ["tipo", "rotulo", "cartaoId", "titulo", "quando", "texto"],
        },
      },
      sugestoes: { type: "array", description: "2 a 4 perguntas de acompanhamento", items: { type: "string" } },
    },
    required: ["titulo", "subtitulo", "tabela", "insights", "acoes", "sugestoes"],
  },
};

const TOMS: Tom[] = ["alerta", "positivo", "neutro"];
const ACTIONS: ActionType[] = ["criar_tarefa", "adicionar_nota", "abrir_cartao"];

/** Normaliza o que veio da IA (campos faltando, tipos trocados, excesso de itens). */
export function normalizeCard(raw: unknown): CopilotCard {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "")) : []);
  const tabela =
    r.tabela && Array.isArray(r.tabela.colunas) && Array.isArray(r.tabela.linhas) && r.tabela.colunas.length
      ? {
          colunas: strings(r.tabela.colunas),
          linhas: r.tabela.linhas.map((l: any) => ({
            celulas: strings(l?.celulas),
            destaque: (["total", "alerta"].includes(l?.destaque) ? l.destaque : "normal") as "total" | "alerta" | "normal",
          })),
        }
      : null;
  return {
    titulo: String(r.titulo || "Copiloto"),
    subtitulo: r.subtitulo ? String(r.subtitulo) : null,
    tabela,
    insights: (Array.isArray(r.insights) ? r.insights : [])
      .filter((i: any) => i?.texto)
      .slice(0, 3)
      .map((i: any) => ({ texto: String(i.texto), tom: (TOMS.includes(i.tom) ? i.tom : "neutro") as Tom })),
    acoes: (Array.isArray(r.acoes) ? r.acoes : [])
      .filter((a: any) => ACTIONS.includes(a?.tipo) && a?.cartaoId && a?.rotulo)
      .filter((a: any) => a.tipo !== "criar_tarefa" || a.titulo)
      .filter((a: any) => a.tipo !== "adicionar_nota" || a.texto)
      .slice(0, 3)
      .map((a: any) => ({
        tipo: a.tipo as ActionType,
        rotulo: String(a.rotulo),
        cartaoId: String(a.cartaoId),
        titulo: a.titulo ? String(a.titulo) : null,
        quando: a.quando ? String(a.quando) : null,
        texto: a.texto ? String(a.texto) : null,
      })),
    sugestoes: strings(r.sugestoes).filter(Boolean).slice(0, 4),
  };
}
