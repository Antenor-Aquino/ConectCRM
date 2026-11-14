// Atalho para a extensão Agenda Unificada (mostra juntas as agendas do Google e
// do Outlook). O evento criado pelo "Adicionar à agenda" da atividade vai para
// uma dessas agendas, então aparece lá.
export const UNIFIED_AGENDA_ID = "kliknamdgccgfoglbehcjmlpmdojcamm";
export const UNIFIED_AGENDA_URL = `chrome-extension://${UNIFIED_AGENDA_ID}/dashboard.html`;

/** Abre (ou foca, se já estiver aberta) a Agenda Unificada numa aba. */
export async function openUnifiedAgenda(): Promise<void> {
  const open = await chrome.tabs.query({ url: `chrome-extension://${UNIFIED_AGENDA_ID}/*` }).catch(() => [] as chrome.tabs.Tab[]);
  const tab = open[0];
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: UNIFIED_AGENDA_URL });
}
