// @vitest-environment jsdom
// Atividade (TaskModal): o que foi digitado vira rascunho, fechar pergunta, e minimizar
// libera a tela sem perder o formulário.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDrafts, resetDrafts } from "../src/lib/drafts";

vi.mock("../src/rpc/client", () => ({
  call: vi.fn(async (method: string) => {
    if (method === "activityTypes.list") return [{ id: "t1", name: "Tarefa", is_meeting: 0, icon: "check" }];
    if (method === "customFields.list") return [];
    if (method === "cards.get") return { id: "c1", title: "Agência Brasil Central", person_id: null };
    if (method === "contactMessages.context") return { current: null, recipients: [] };
    if (/\.list$|\.search$|forActivity$/.test(method)) return [];
    return undefined;
  }),
  DATA_CHANGED_EVENT: "data-changed",
  TRASH_EVENT: "trash",
}));
vi.mock("../src/dashboard/session", () => ({
  useSession: () => ({ user: { id: "u1", name: "Antenor", role: "admin" }, users: [], label: (u: { name: string }) => u.name }),
}));
vi.mock("../src/lib/notify/settings", async (orig) => ({
  ...((await orig()) as object),
  loadNotifySettings: async () => ({ defaults: [], chrome: true, contact: { template: "", minutes: 60, senderId: null }, email: { enabled: false, to: "" }, whatsapp: {}, calendarEmailBackup: false }),
  activeSettings: (s: unknown) => s,
}));
vi.mock("../src/lib/whatsappSenders", () => ({ loadSenders: async () => ({ senders: [] }) }));
vi.mock("../src/lib/calendar", () => ({
  busyRanges: vi.fn(),
  calendarConnected: async () => false,
  computeFreeSlots: vi.fn(),
  connectCalendar: vi.fn(),
  createCalendarEvent: vi.fn(),
  PROVIDER_LABEL: { google: "Google Agenda", outlook: "Outlook" },
}));

import { TaskModal } from "../src/dashboard/tasks/TaskModal";

function Host({ onClose }: { onClose: () => void }) {
  const [min, setMin] = useState(false);
  return <TaskModal request={{ dealId: "c1" }} minimized={min} onMinimizedChange={setMin} onClose={onClose} onSaved={() => {}} />;
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 750))));
const nameInput = () => screen.getByPlaceholderText("Nome da atividade") as HTMLInputElement;

beforeEach(() => resetDrafts());
afterEach(cleanup);

describe("atividade em edição", () => {
  it("recém-aberta, sem mexer em nada, não conta como rascunho e fecha direto", async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await settle();
    expect(listDrafts()).toEqual([]);
    fireEvent.click(screen.getByText("Cancelar"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("digitar o nome vira rascunho; Cancelar pergunta antes de descartar", async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await settle();
    fireEvent.change(nameInput(), { target: { value: "Enviar proposta" } });
    expect(listDrafts().map((d) => d.label)).toEqual(["Atividade nova “Enviar proposta”"]);
    fireEvent.click(screen.getByText("Cancelar"));
    expect(await screen.findByText("Existem itens não salvos")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Continuar editando"));
    expect(nameInput().value).toBe("Enviar proposta");
    fireEvent.click(screen.getByText("Cancelar"));
    fireEvent.click(await screen.findByText("Descartar atividade"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("minimizar esconde o formulário, mostra o chip e reabrir devolve tudo como estava", async () => {
    render(<Host onClose={() => {}} />);
    await settle();
    fireEvent.change(nameInput(), { target: { value: "Enviar proposta" } });
    fireEvent.click(screen.getByLabelText("Minimizar"));
    expect(screen.queryByPlaceholderText("Nome da atividade")).toBeNull();
    expect(screen.getByText(/Atividade em edição: Enviar proposta/)).toBeTruthy();
    expect(listDrafts()).toHaveLength(1); // continua valendo ao fechar o cartão

    fireEvent.click(screen.getByTitle("Reabrir a atividade"));
    expect(nameInput().value).toBe("Enviar proposta");
  });

  it("descartar pelo chip pede confirmação", async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await settle();
    fireEvent.change(nameInput(), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText("Minimizar"));
    fireEvent.click(screen.getByLabelText("Descartar a atividade em edição"));
    fireEvent.click(await screen.findByText("Descartar atividade"));
    expect(onClose).toHaveBeenCalled();
  });
});
