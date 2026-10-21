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
      "Lista negócios, tickets e etapas de projeto com funil, etapa, valor, contato, responsável, dias na etapa, próxima atividade e atividades atrasadas. " +
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
      "Tudo de um cartão pelo id: dados, contato (telefone/e-mail), itens, atividades pendentes e concluídas, últimas notas, etapas percorridas com dias e o financeiro (lançamentos na Gestão Financeira e resultado). " +
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
    description:
      "Atividades pendentes: atrasadas (finalização vencida ou, sem finalização, início antes de hoje; da mais atrasada para a menos), de hoje, dos próximos 7 dias " +
      "ou todas as pendentes, com cartão vinculado, responsável e atrasadaHaDias.",
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
      "Cartões abertos sem movimento (mudança de etapa, atividade concluída ou nota) há muitos dias. Sem 'dias', usa o limite 'parado após' de cada etapa (ou 14 dias). " +
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
    name: "buscar_documentos",
    description:
      "Documentos do GED: por texto (nome, classificação, vínculos, texto do PDF) e/ou por pasta (inclui as subpastas). Devolve nome, classificação, pasta, vínculos e validade. " +
      "Sem texto nem pasta, lista as pastas existentes com quantos documentos cada uma tem.",
    parameters: {
      type: "object",
      properties: {
        texto: str("O que procurar (opcional)"),
        pasta: str("Nome da pasta ou caminho, ex.: Contratos ou Comercial/Propostas (opcional)"),
      },
    },
  },
  {
    name: "resumo_financeiro",
    description:
      "Financeiro dos cartões (receitas e despesas lançadas na Gestão Financeira, mesmos números de Relatórios → Financeiro): receitas, despesas, resultado e margem, " +
      "recebido/pago, a receber/a pagar com atrasados, por mês, por cliente, por funil, por categoria, os cartões com melhor e pior resultado e os ganhos com receita a lançar. " +
      "Use para perguntas de faturamento, lucro, margem, rentabilidade de negócio/projeto/cliente e contas a receber.",
    parameters: {
      type: "object",
      properties: {
        de: str("Início do período, AAAA-MM-DD"),
        ate: str("Fim do período (inclusive), AAAA-MM-DD"),
        base: str("Data usada: competencia (padrão), vencimento ou caixa (só pago/recebido, pela data do pagamento)", { enum: ["competencia", "vencimento", "caixa"] }),
        funil: str("Nome do funil (opcional)"),
        responsavel: str("Nome do usuário ou da equipe (opcional)"),
      },
      required: ["de", "ate"],
    },
  },
  {
    name: "pendencias_financeiras",
    description:
      "Pontos de atenção financeiros hoje: receitas atrasadas (com dias de atraso, cartão e cliente), receitas vencendo nos próximos 7 dias, despesas atrasadas e " +
      "cartões ganhos com receita ainda não lançada na Gestão Financeira. Use para cobrança, follow-up financeiro e 'o que preciso faturar'.",
    parameters: { type: "object", properties: { responsavel: str("Nome do usuário ou da equipe (opcional)") } },
  },
  {
    name: "estrutura_do_crm",
    description: "Funis com etapas (probabilidade, limite de dias parado), usuários com papel, equipes com membros, motivos de perda e tipos de atividade.",
    parameters: { type: "object", properties: {} },
  },
];

// ---------- Card de resposta ----------

export type Tom = "alerta" | "positivo" | "neutro";
export type ActionType = "criar_tarefa" | "adicionar_nota" | "abrir_cartao" | "criar_cartao";

export interface CopilotAction {
  tipo: ActionType;
  /** Texto do botão, ex.: "Criar tarefa: ligar para Regina amanhã 10h". */
  rotulo: string;
  /** Cartão da ação (vazio em criar_cartao). */
  cartaoId: string;
  /** criar_tarefa: título da tarefa; criar_cartao: título do cartão. */
  titulo: string | null;
  /** criar_cartao: funil e etapa (ids vindos de estrutura_do_crm; etapa null = primeira). */
  funilId: string | null;
  etapaId: string | null;
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
        description:
          "Até 3 ações que o usuário aplica com um clique (cartaoId vindo das ferramentas; em criar_cartao, funilId/etapaId de estrutura_do_crm); [] quando não houver",
        items: {
          type: "object",
          properties: {
            tipo: str("Tipo da ação", { enum: ["criar_tarefa", "adicionar_nota", "abrir_cartao", "criar_cartao"] }),
            rotulo: str("Texto do botão, no imperativo (ex.: 'Criar cartão \"Conserto Gaveta Miguel\" em Casa › A fazer')"),
            cartaoId: str("Id do cartão; em criar_cartao, string vazia"),
            titulo: str("criar_tarefa: título da atividade; criar_cartao: título do cartão; senão null", { nullable: true }),
            funilId: str("criar_cartao: id do funil (de estrutura_do_crm); senão null", { nullable: true }),
            etapaId: str("criar_cartao: id da etapa (de estrutura_do_crm; null = primeira etapa); senão null", { nullable: true }),
            quando: str("criar_tarefa: data e hora local AAAA-MM-DDTHH:MM; senão null", { nullable: true }),
            texto: str("adicionar_nota: texto da nota; senão null", { nullable: true }),
          },
          required: ["tipo", "rotulo", "cartaoId", "titulo", "funilId", "etapaId", "quando", "texto"],
        },
      },
      sugestoes: {
        type: "array",
        description: "2 a 4 próximos pedidos que o usuário pode fazer com um clique, escritos como o usuário falaria (imperativo, sem '?'), ex.: 'Liste minhas atividades de hoje'",
        items: { type: "string" },
      },
    },
    required: ["titulo", "subtitulo", "tabela", "insights", "acoes", "sugestoes"],
  },
};

const TOMS: Tom[] = ["alerta", "positivo", "neutro"];
const ACTIONS: ActionType[] = ["criar_tarefa", "adicionar_nota", "abrir_cartao", "criar_cartao"];

/** Normaliza o que veio da IA (campos faltando, tipos trocados, excesso de itens). */
/** `cardId` = cartão em que o Copiloto foi aberto: vale para ações sem cartaoId. */
export function normalizeCard(raw: unknown, cardId?: string | null): CopilotCard {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "")) : []);
  const tabela =
    // Tabela sem linhas não aparece (só o cabeçalho confunde).
    r.tabela && Array.isArray(r.tabela.colunas) && Array.isArray(r.tabela.linhas) && r.tabela.colunas.length && r.tabela.linhas.length
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
      .map((a: any) => (a && a.tipo !== "criar_cartao" && !a.cartaoId && cardId ? { ...a, cartaoId: cardId } : a))
      .filter((a: any) => ACTIONS.includes(a?.tipo) && a?.rotulo && (a.tipo === "criar_cartao" ? a.funilId && a.titulo : a.cartaoId))
      .filter((a: any) => a.tipo !== "criar_tarefa" || a.titulo)
      .filter((a: any) => a.tipo !== "adicionar_nota" || a.texto)
      .slice(0, 3)
      .map((a: any) => ({
        tipo: a.tipo as ActionType,
        rotulo: String(a.rotulo),
        cartaoId: a.cartaoId ? String(a.cartaoId) : "",
        titulo: a.titulo ? String(a.titulo) : null,
        funilId: a.funilId ? String(a.funilId) : null,
        etapaId: a.etapaId ? String(a.etapaId) : null,
        quando: a.quando ? String(a.quando) : null,
        texto: a.texto ? String(a.texto) : null,
      })),
    sugestoes: strings(r.sugestoes).filter(Boolean).slice(0, 4),
  };
}
