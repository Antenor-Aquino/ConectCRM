// @vitest-environment jsdom
// Rascunhos em memória: o que foi digitado numa nota não se perde ao trocar de aba e
// o cartão pergunta antes de fechar com algo não salvo.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDraft, listDrafts, markDraft, resetDrafts } from "../src/lib/drafts";

const calls: { method: string; params: unknown }[] = [];
vi.mock("../src/rpc/client", () => ({
  call: vi.fn(async (method: string, params: unknown) => {
    calls.push({ method, params });
    if (method === "notes.list") return [];
    return undefined;
  }),
  DATA_CHANGED_EVENT: "data-changed",
  TRASH_EVENT: "trash",
}));

import { NotesPanel } from "../src/dashboard/ui/NotesPanel";
import { DraftScope, useLeaveGuard } from "../src/dashboard/ui/unsaved";

function Card({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"notas" | "docs">("notas");
  const { guard, dialog } = useLeaveGuard("c1");
  return (
    <DraftScope.Provider value="c1">
      <button onClick={() => setTab("notas")}>aba-notas</button>
      <button onClick={() => setTab("docs")}>aba-docs</button>
      <button onClick={() => guard(onClose)}>fechar-card</button>
      <div hidden={tab !== "notas"}>
        <NotesPanel entityType="deal" entityId="c1" />
      </div>
      {tab === "docs" && <p>Documentos do cartão</p>}
      {dialog}
    </DraftScope.Provider>
  );
}

const textarea = () => screen.getByLabelText("Nova nota") as HTMLTextAreaElement;

beforeEach(() => {
  resetDrafts();
  calls.length = 0;
});
afterEach(cleanup);

describe("registro de rascunhos", () => {
  it("marca, lista por escopo e limpa", () => {
    markDraft({ key: "a", scope: "c1", label: "Nota nova", tab: "notas" });
    markDraft({ key: "b", scope: "c2", label: "Outra" });
    expect(listDrafts("c1").map((d) => d.label)).toEqual(["Nota nova"]);
    expect(listDrafts()).toHaveLength(2);
    clearDraft("a");
    expect(listDrafts("c1")).toEqual([]);
  });
});

describe("nota no cartão", () => {
  it("o texto continua ao trocar de aba e voltar", async () => {
    render(<Card onClose={() => {}} />);
    fireEvent.change(textarea(), { target: { value: "Ligar para o diretor amanhã" } });
    fireEvent.click(screen.getByText("aba-docs"));
    expect(screen.getByText("Documentos do cartão")).toBeTruthy();
    fireEvent.click(screen.getByText("aba-notas"));
    expect(textarea().value).toBe("Ligar para o diretor amanhã");
    expect(listDrafts("c1").map((d) => d.label)).toEqual(["Nota nova"]);
  });

  it("fechar o cartão com nota digitada pergunta e não fecha; continuar editando mantém o texto", async () => {
    const onClose = vi.fn();
    render(<Card onClose={onClose} />);
    fireEvent.change(textarea(), { target: { value: "rascunho" } });
    fireEvent.click(screen.getByText("fechar-card"));
    expect(await screen.findByText("Existem itens não salvos")).toBeTruthy();
    expect(screen.getByText("Nota nova")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Continuar editando"));
    expect(screen.queryByText("Existem itens não salvos")).toBeNull();
    expect(textarea().value).toBe("rascunho");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("descartar e sair fecha o cartão", async () => {
    const onClose = vi.fn();
    render(<Card onClose={onClose} />);
    fireEvent.change(textarea(), { target: { value: "rascunho" } });
    fireEvent.click(screen.getByText("fechar-card"));
    fireEvent.click(await screen.findByText("Descartar e sair"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sem nada digitado, fecha direto", () => {
    const onClose = vi.fn();
    render(<Card onClose={onClose} />);
    fireEvent.click(screen.getByText("fechar-card"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Existem itens não salvos")).toBeNull();
  });

  it("depois de salvar a nota não há mais rascunho e o cartão fecha direto", async () => {
    const onClose = vi.fn();
    render(<Card onClose={onClose} />);
    fireEvent.change(textarea(), { target: { value: "Nota salva" } });
    fireEvent.click(screen.getByText("Salvar nota"));
    await waitFor(() => expect(calls.some((c) => c.method === "notes.add")).toBe(true));
    await waitFor(() => expect(listDrafts("c1")).toEqual([]));
    expect(textarea().value).toBe("");
    fireEvent.click(screen.getByText("fechar-card"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("apagar o texto digitado também tira o rascunho", () => {
    render(<Card onClose={() => {}} />);
    fireEvent.change(textarea(), { target: { value: "x" } });
    expect(listDrafts("c1")).toHaveLength(1);
    fireEvent.change(textarea(), { target: { value: "" } });
    expect(listDrafts("c1")).toHaveLength(0);
  });
});

import { GuardedModal } from "../src/dashboard/ui/GuardedModal";

describe("janela de formulário", () => {
  const Form = ({ onClose }: { onClose: () => void }) => (
    <GuardedModal isOpen onClose={onClose} title="Criar contato">
      <input aria-label="Nome" />
      <button onClick={onClose}>Cancelar</button>
    </GuardedModal>
  );

  it("sem nada digitado, o X fecha direto", () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Fechar"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("com algo digitado, o X e o Esc perguntam; o rascunho aparece para a tela que guarda", async () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Maria" } });
    expect(listDrafts().map((d) => d.label)).toEqual(["Criar contato (não salvo)"]);
    fireEvent.click(screen.getByLabelText("Fechar"));
    expect(await screen.findByText("Existem itens não salvos")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Continuar editando"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("Existem itens não salvos")).toBeTruthy();
    fireEvent.click(screen.getByText("Descartar"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
