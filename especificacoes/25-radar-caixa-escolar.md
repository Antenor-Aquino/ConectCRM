# 25 — Integração com o Radar Caixa Escolar MG (0.2.157; notas, campos e etiquetas na 0.2.158; nota do resultado na 0.2.159; Pendente na 0.2.160)

## Objetivo
O **Radar Caixa Escolar MG** é um robô local (Python, repositório
`Antenor-Aquino/robo_caixa_escolar_mg`) que acha no portal Caixa Escolar da
SEE-MG os orçamentos com as palavras-chave do usuário e acompanha as propostas
enviadas (enviada, aprovada, recusada, cancelada). Com a integração, cada
orçamento vira um cartão num funil comercial e o cartão acompanha o processo
até o resultado, sem digitar nada.

## Como os dois conversam
- O Radar roda **no mesmo computador** e serve um painel em
  `http://127.0.0.1:8765` (porta do `.env` dele, `PAINEL_PORTA`).
- A partir da versão 1.16, o Radar tem a rota **só de leitura**
  `GET /api/crm/oportunidades` e aceita a origem `chrome-extension://<ID>` do
  ConectCRM (ID fixo pelo campo `key` do manifest:
  `fabjbdmhpofceejnkeffkkiomoeifedj`; no Radar, `CONECTCRM_ID` no `.env`).
  Outras origens, as rotas de gravação e o `/api/dados` continuam recusados.
- O ConectCRM **busca** (não recebe): o service worker lê o Radar a cada
  10 min, no mesmo ciclo dos lembretes (`runNotifications`), e o botão
  **Sincronizar agora** lê na hora. Nada é gravado no Radar nem no portal.
- Permissão opcional `http://127.0.0.1/*` (ou `http://localhost/*`), pedida no
  clique de **Testar conexão**. Fica fora do pacote para a atualização não
  desativar a extensão.
- Com o Radar desligado ou o Chrome fechado, nada se perde: a leitura seguinte
  continua de onde parou.

## Configurações → Integrações → Radar Caixa Escolar MG (só administradores)
- **Endereço do Radar** (padrão `http://127.0.0.1:8765`; só `127.0.0.1` ou
  `localhost`) e **Testar conexão** (versão do Radar, quantos orçamentos ele
  guarda e as palavras-chave dele).
- **Funil dos cartões** (só comerciais) e as etapas:
  - **orçamentos novos** (padrão: primeira etapa);
  - **ao enviar a proposta no portal** (vazio = não move);
  - **ao aprovar no portal** (vazio = não move; o cartão fica Pendente onde estiver).
- **Palavras-chave que viram cartão**: as do Radar, com caixa de marcar
  (nenhuma = todas). Ignora caixa e acento.
- **Ao ligar, trazer**: os abertos agora e os que surgirem (padrão), só os que
  surgirem daqui para frente, ou todo o histórico (os encerrados entram já
  ganhos ou perdidos). "Surgir" = o Radar analisou o orçamento depois da data
  em que a integração foi ligada (`ativadoEm`).
- **Ligar/Desligar integração**, **Sincronizar agora**, última leitura, erro da
  última tentativa e quantos cartões vieram do Radar.
- Tudo fica em `chrome.storage.local` (`conectcrm-radar`) e vai no arquivo de
  configurações do backup (não há senha).

## Regras do cartão (`src/db/radar.ts`)
- **Vínculo** em `external_ref`, provider `radar`:
  - cartão: `entity_type = deal`, `external_id = idBudget` do portal;
    `source_updated_at` guarda, em JSON, o que já foi aplicado (estado, valor da
    proposta, nota do mapa, atividade do prazo). Assim a mesma leitura repetida
    não muda nada;
  - escola: `entity_type = organization`, `external_id = inep:<INEP>` (Censo)
    ou `email:<e-mail institucional>`.
- **Quem vira cartão**: não descartado no Radar, não arquivado (a não ser que
  já tenha status no portal), com as palavras-chave escolhidas e dentro do
  ponto de partida. O que já tem cartão segue sempre.
- **Cartão novo**: título `ESCOLA — Pedido N`, origem `Radar Caixa Escolar MG`,
  valor = a proposta enviada; senão o estimado (o R$ 1,00 que o portal usa
  quando a escola não estima vira 0), previsão de fechamento = data de
  entrega, descrição com pedido, município, grupo, turmas e INEP (Censo),
  palavras-chave, itens e o link do portal.
- **Notas do orçamento** (0.2.158), cada uma separada: **Descrição do
  processo** (descrição de cada item), **Garantia exigida** (garantia de cada
  item; só se houver; Radar 1.16 manda `itens[].garantia`) e **Contato e
  prazos** (e-mail da escola, envio da proposta e entrega, em dd/mm/aaaa hh:mm).
- **Campos do cartão** (0.2.158), achados pelo nome (ignora caixa e acento):
  **Processo SGD** = nº do pedido; **Qtd Turmas** = turmas do Censo. Só
  campos de texto ou número; não sobrescreve o que já estiver preenchido. Sem
  o campo no funil, nada acontece.
- **Etiquetas** (0.2.158): **MG** e **Pública** são acrescentadas às que o
  cartão já tem (criadas se não existirem).
- **Cartões importados antes** recebem notas, campos e etiquetas uma vez, na
  leitura seguinte (marcador `x` no JSON do vínculo). Se o usuário tirar uma
  etiqueta ou apagar uma nota depois, o Radar não repõe.
- **Organização**: a já vinculada; senão a de mesmo CNPJ ou mesmo nome e
  cidade; senão é criada como *Unidade / escola* com e-mail institucional,
  telefone, endereço e CEP do Censo, cidade e `MG`. Dado fora do formato
  aceito (telefone, CEP) fica de fora sem impedir o cadastro.
- **Prazo de envio**: atividade "Enviar proposta no portal — pedido N" no
  cartão, com lembrete 1 dia antes, só para orçamento ainda no prazo. É
  concluída sozinha quando a proposta aparece como enviada.
- **Só avança**: entrada → proposta enviada → resultado.
  - enviada: move para a etapa configurada e o valor passa a ser o da
    proposta;
  - aprovada: etapa configurada + **Pendente** (0.2.160; antes, Ganho);
  - recusada ou cancelada: **Pendente** (0.2.160; antes, Perdido). O motivo
    e o vencedor vão na nota "Resultado no portal";
  - o desfecho final (ganho/perdido) é decisão do usuário (spec 26).
- **Nota do resultado** (0.2.159): quando o status passa a aprovada,
  recusada ou cancelada, entra uma nota nova "Resultado no portal": o status
  (e "você venceu"), o motivo do cancelamento, sua posição, seu valor, o
  vencedor e o mapa de apuração (cada participante com o valor e a diferença
  em % para o seu). Se o mapa ainda não foi lido pelo Radar, a nota avisa, e o
  mapa entra numa segunda nota quando chegar (uma vez só). Vale também para
  cartão fechado à mão (só o status não é mexido). Fica no banco local, como
  no Radar.
- **Mão do usuário vale mais**: cartão já ganho ou perdido à mão não tem o
  status mudado; cartão movido para outro funil não é movido de etapa; cartão
  excluído não volta.
- **Avisos**: notificação do Chrome e no sino para cada cartão novo, proposta
  enviada, aprovada, recusada ou cancelada; mais de 5 de uma vez (primeira
  carga) viram um aviso só.

## Testes
`extension/tests/radar.test.ts`: cartão e organização, sem duplicar, mesma
escola em dois orçamentos, avanço até ganho com nota única, recusada e
cancelada, cartão fechado à mão e excluído, filtros e ponto de partida,
histórico e funil inexistente, notas/campos/etiquetas no cartão novo e nos
já importados (sem apagar campo preenchido pelo usuário). Conferido também com as 229 oportunidades de
uma cópia da base real do Radar (histórico completo: 182 cartões, 174 escolas,
123 notas de mapa e 31 tarefas de prazo, sem erro; a segunda leitura não muda
nada).

## Fora desta versão
- Volta CRM → Radar (por exemplo, perder o cartão descartar no Radar).
- Radar e ConectCRM em computadores diferentes (seria por arquivo).
