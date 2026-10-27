# Especificação 14 — Instalação, ID fixo e mudança de instalação (0.2.74)

## Problema

As extensões são instaladas "sem compactação". Sem chave no manifest, o
Chrome calcula o ID **a partir do caminho da pasta**: mudar a pasta de lugar
(ou instalar em outro computador) cria uma extensão nova — banco vazio,
documentos guardados no navegador perdidos, pastas (documentos e backup) a
escolher de novo, configurações (chrome.storage) perdidas, pareamento com a
Gestão Financeira quebrado e o redirect do Outlook
(`https://<id>.chromiumapp.org/microsoft`) inválido. Remover a instalação
antiga apaga os dados dela.

## ID fixo

Desde o ConectCRM 0.2.74 e a Gestão Financeira 0.0.15 (instalador atual: 0.0.25) o manifest tem `key`:

| Extensão | ID fixo |
|---|---|
| ConectCRM | `fabjbdmhpofceejnkeffkkiomoeifedj` |
| Gestão Financeira | `majmmaadcobkpiefhnchmjjmaoalpdap` |

Qualquer pasta, qualquer computador: o mesmo ID. As chaves privadas (`.pem`)
ficam fora do repositório (só servem para empacotar `.crx`). A Chrome Web
Store, se um dia usada, dá outro ID (mudança única, pelo mesmo caminho abaixo).
Outlook: cadastrar no app do Azure o redirect
`https://fabjbdmhpofceejnkeffkkiomoeifedj.chromiumapp.org/microsoft`.

## Configurações no backup

`lib/settingsTransfer.ts`: o que fica fora do banco (notificações, som,
conta de e-mail, números de WhatsApp, IA, Pipedrive e de-para, backups,
termos; licença só com credenciais) vira `configuracoes.json`.

- Sem senhas e chaves por padrão (IA, Z-API, Pipedrive, CallMeBot, licença);
  "Incluir senhas e chaves" põe tudo (texto puro — aviso na tela).
- Todo backup do banco grava `conectcrm-configuracoes.json` (sem credenciais)
  na pasta; a cópia `.zip` leva `configuracoes.json`.
- Restaurar `.zip` (ou `.sqlite` com o arquivo na pasta de backup) pergunta se
  restaura as configurações. Importar sem credenciais mantém as que a
  instalação já tem; nomes de pasta só valem na mesma instalação.
- Configurações → Backup → **Configurações e mudança de instalação**:
  exportar, importar, abrir o assistente.

## Assistente de mudança

O banco guarda em `setting.installation` o ID da extensão. Ao abrir (Produção,
administrador), ID diferente = banco veio de outra instalação → abre o
**Assistente de mudança de instalação** (também em Configurações → Backup):

1. Configurações — da pasta de backup ou de um arquivo.
2. Pasta de documentos — escolher; o Localizar reencontra os arquivos.
3. Pasta do backup do banco.
4. Backup dos documentos.
5. Gestão Financeira — conectada? senão, Integrações.
6. Contas e serviços — Google, Outlook, WhatsApp Web, chaves.

Cada passo mostra a situação real. "Continuar depois" deixa um aviso no topo;
"Concluir" registra a instalação atual e o assistente não abre mais sozinho.

## Migração de quem está na 0.2.73 ou anterior (uma vez)

1. Na instalação atual, trocar os arquivos da **mesma pasta** pelos do
   `ConectCRM-0.2.74-ponte.zip` (sem chave, mesmo ID) e recarregar.
2. Configurações → Backup → ligar "Incluir senhas e chaves" → **Baixar cópia**.
   Na Gestão Financeira, fazer o backup dela.
3. **Desativar** (não remover) as instalações antigas — evita lembretes e
   mensagens em dobro.
4. Extrair `ConectCRM-0.2.74.zip` e `GestaoFinanceira-0.0.25.zip` numa pasta
   definitiva (fora de Downloads e das pastas de documentos/backup) e carregar.
5. Restaurar a cópia; o assistente abre e guia o resto. Restaurar a Gestão
   Financeira e conectar as duas.
6. Tudo conferido, remover as instalações antigas.

Depois disso, atualizar = substituir os arquivos e recarregar; mudar de pasta
ou de computador não muda o ID.
