// Janela de aviso do CRM (src/alert): os avisos do Chrome também aparecem
// numa janelinha da extensão, que não depende das notificações do sistema.
export const ALERTS_KEY = "conectcrm-alerts";
export const ALERT_WINDOW_KEY = "conectcrm-alert-window";
export const ALERT_PAGE = "src/alert/alert.html";

export interface AlertItem {
  /** Id da notificação ("task:<atividade>" ou "notify:<chave>"). */
  id: string;
  title: string;
  message: string;
  /** Lembrete de atividade: tem Concluir e Adiar. */
  task: boolean;
  at: string;
}

export interface AlertActionMessage {
  target: "background";
  kind: "alert-action";
  id: string;
  action: "done" | "snooze" | "open" | "ok" | "test";
}
