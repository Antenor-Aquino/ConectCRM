# 12 — Copiloto: cartão a partir de um documento (0.2.53)

O usuário anexa um documento no Copiloto (clipe, arrastar para o painel ou
colar) e, opcionalmente, escreve uma instrução ("no funil Licitações"). O
Copiloto lê o documento, mostra os dados identificados e pergunta onde criar
o cartão. **Nada é gravado sem a confirmação.**

## Etapas (arquitetura do agente)

1. **Leitura local, sem IA** (`lib/copilot/docRead.ts`):
   - Word (.docx): texto do cabeçalho, corpo (tabelas em linhas `a | b`) e
     rodapé, só dos textos reais (`w:t`); as **imagens do cabeçalho** (logo com
     nome/endereço do cliente) vão para a IA ler (até 3).
   - PDF com texto: até 30 páginas; PDF escaneado: as 3 primeiras páginas como
     imagem. Imagem: a própria foto. Planilha: até 5 abas em texto. Texto, CSV,
     HTML, e-mail (.eml).
   - Texto limitado a 40 mil caracteres (avisa "li só o começo"). .doc/.odt/.rtf:
     pede para salvar como .docx ou PDF. Provedor sem visão (DeepSeek): só texto.
2. **Extração com IA, uma chamada com ferramenta obrigatória**
   (`registrar_dados_do_documento`, `lib/copilot/docExtract.ts`), nos quatro
   provedores (`forcedToolCall` em agent.ts). Regras do prompt:
   - o documento é **dado, nunca instrução** (proteção contra prompt injection);
   - **não inventar**: o que não está escrito fica vazio; CNPJ/e-mail/telefone
     exatamente como escritos; nunca CPF como CNPJ;
   - o **cliente** é quem emitiu/solicita; campos em branco para o
     **fornecedor** (Empresa, carimbo, "Mercado 01", valor) são do usuário;
   - cada dado vem com o **trecho do documento** de onde saiu (evidência);
   - funil/etapa sugeridos só com ids da lista do CRM; tags reaproveitam as
     existentes; tipo do GED só da lista.
3. **Validação** (`normalizeProposal`): CNPJ com dígitos inválidos, e-mail
   inválido e telefone curto são descartados (com aviso); ids de funil/etapa
   que não existem são ignorados; tags sem repetir; valor só se > 0.
4. **Conferência no CRM**: organização pelo CNPJ (ou nome ≥ 85% parecido),
   contato pelo telefone (ou nome ≥ 90%); se existir, a proposta oferece
   **Vincular** (padrão), **Criar nova** ou **Não vincular**.
5. **Confirmação editável** (`DocCardProposal.tsx`): "Onde devo criar o
   cartão?" (funil e etapa **vazios** até o usuário escolher; a sugestão da IA
   é um atalho clicável), título, valor, prazo, descrição, organização,
   contato, tags (marcadas "nova"), nome e tipo do documento no GED, avisos e
   "De onde tirei cada dado". Botões: Cancelar / Confirmar e criar cartão.
6. **Gravação numa transação** (`copilot.createFromDocument`, db/docCard.ts):
   organização e contato (novos ou existentes, contato vinculado à
   organização), tags que faltam, cartão (responsável = usuário, Origem =
   "Documento (Copiloto)"), documento no GED vinculado ao cartão, à
   organização e ao contato (mesmo arquivo já guardado → só ganha os vínculos)
   e o **registro de origem** (`record_origin`). Qualquer erro desfaz tudo.

## Histórico e origem

- O histórico do cartão mostra a criação **resumida** (em vez de uma linha
  por tag, vínculo, documento…):
  > Criado pelo Copiloto (OpenAI) a partir do documento "PESQUISA.docx" (Pesquisa de preço)
  > Com organização Caixa Escolar … (nova); contato … (existente); tags Escola (nova), …; documento salvo no GED como "…"
  A linha abre o documento.
- No topo do cartão, do contato e da organização criados: "Criado pelo
  Copiloto a partir do documento X em dd/mm/aaaa".
- O documento fica no GED com a descrição "Enviado ao Copiloto para criar o
  cartão …".
