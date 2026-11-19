// @vitest-environment jsdom
// Janela "Criar campo personalizado": disponível em todos os funis ou só nos escolhidos.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { method: string; params: Record<string, unknown> }[]);
vi.mock("../src/rpc/client", () => ({
  call: vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === "pipelines.list")
      return [
        { id: "p1", name: "PowerCubus", type: "comercial", archived_at: null },
        { id: "p2", name: "Certificados", type: "comercial", archived_at: null },
        { id: "p3", name: "Suporte", type: "operacional", archived_at: null },
      ];
    if (method === "fieldGroups.list") return [];
    return "new-id";
  }),
  DATA_CHANGED_EVENT: "x",
}));
import { CustomFieldModal } from "../src/dashboard/settings/CustomFieldModal";

afterEach(cleanup);

describe("campo personalizado: funis", () => {
  it("Negócio: escolhe um ou vários funis comerciais; contato mostra que vale para todos", async () => {
    const onSaved = vi.fn();
    render(<CustomFieldModal field={null} defaultEntity="person" onClose={() => {}} onSaved={onSaved} />);
    expect(screen.getByText(/Contatos, organizações e produtos não ficam em funil/)).toBeTruthy();
    fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "deal" } });
    fireEvent.change(document.querySelector("input") as HTMLInputElement, { target: { value: "Nº de alunos" } });
    fireEvent.click(document.querySelector("[data-field-pipelines-some]")!);
    await waitFor(() => expect(document.querySelector('[data-field-pipeline="PowerCubus"]')).not.toBeNull());
    expect(document.querySelector('[data-field-pipeline="Suporte"]')).toBeNull();
    // Nenhum marcado: pede para marcar.
    await act(async () => fireEvent.click(screen.getByText("Salvar")));
    expect(screen.getByText(/Marque pelo menos um funil/)).toBeTruthy();
    fireEvent.click(document.querySelector('[data-field-pipeline="PowerCubus"]')!);
    fireEvent.click(document.querySelector('[data-field-pipeline="Certificados"]')!);
    await act(async () => fireEvent.click(screen.getByText("Salvar")));
    expect(calls.find((c) => c.method === "customFields.create")!.params).toMatchObject({ entity: "deal", pipelineIds: ["p1", "p2"] });
    expect(onSaved).toHaveBeenCalled();
  });

  it("Atividade: funis de todos os tipos", async () => {
    render(<CustomFieldModal field={null} defaultEntity="activity" onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(document.querySelector("[data-field-pipelines-some]")!);
    await waitFor(() => expect(document.querySelector('[data-field-pipeline="Suporte"]')).not.toBeNull());
    expect(document.querySelector('[data-field-pipeline="PowerCubus"]')).not.toBeNull();
  });
});
