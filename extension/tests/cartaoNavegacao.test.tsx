// @vitest-environment jsdom
// Cartão aberto: botões Anterior/Próximo, na ordem do quadro, com a posição.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardNavButtons } from "../src/dashboard/cards/CardNavButtons";

afterEach(cleanup);

describe("Anterior/Próximo no cartão", () => {
  it("mostra a posição e vai para o anterior e o próximo", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<CardNavButtons nav={{ pos: 2, total: 3, onPrev, onNext }} />);
    expect(document.querySelector("[data-card-pos]")!.textContent).toBe("2 de 3");
    fireEvent.click(screen.getByLabelText("Cartão anterior"));
    fireEvent.click(screen.getByLabelText("Próximo cartão"));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("no último cartão o Próximo fica desativado; com um cartão só, não aparece", () => {
    render(<CardNavButtons nav={{ pos: 3, total: 3, onPrev: () => {} }} />);
    expect((screen.getByLabelText("Próximo cartão") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Cartão anterior") as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    render(<CardNavButtons nav={{ pos: 1, total: 1 }} />);
    expect(document.querySelector("[data-card-nav]")).toBeNull();
  });
});
