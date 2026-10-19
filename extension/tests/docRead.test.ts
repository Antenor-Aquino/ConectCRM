import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { readDocx, wordXmlText } from "../src/lib/copilot/docRead";

const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

describe("leitura de .docx para o Copiloto", () => {
  it("texto do cabeçalho, corpo (com tabela) e rodapé; imagem do cabeçalho", () => {
    const docx = zipSync({
      "word/document.xml": strToU8(
        `<w:document><w:body>${p("PESQUISA DE PREÇO")}${p("CAIXA ESCOLAR &amp; CIA")}<w:tbl><w:tr><w:tc>${p("Item")}</w:tc><w:tc>${p("Quantidade")}</w:tc></w:tr><w:tr><w:tc>${p("01")}</w:tc><w:tc>${p("12 turmas")}</w:tc></w:tr></w:tbl></w:body></w:document>`,
      ),
      "word/header1.xml": strToU8(`<w:hdr>${p("Escola Estadual")}</w:hdr>`),
      "word/_rels/header1.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="media/image1.jpeg"/></Relationships>`),
      "word/media/image1.jpeg": new Uint8Array([1, 2, 3]),
      "word/footer1.xml": strToU8(`<w:ftr>${p("Rodapé &#233; aqui")}</w:ftr>`),
    });
    const r = readDocx(docx);
    expect(r.text).toBe("Escola Estadual\n\nPESQUISA DE PREÇO\nCAIXA ESCOLAR & CIA\nItem | Quantidade\n01 | 12 turmas\n\nRodapé é aqui");
    expect(r.images.map((i) => i.name)).toEqual(["word/media/image1.jpeg"]);
  });

  it("quebras e tabulações", () => {
    expect(wordXmlText(`<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>`)).toBe("A\tB\nC");
  });

  it("arquivo que não é Word", () => {
    expect(() => readDocx(zipSync({ "a.txt": strToU8("x") }))).toThrow(/não parece ser um documento do Word/);
    expect(() => readDocx(new Uint8Array([1, 2, 3]))).toThrow(/Não foi possível abrir/);
  });
});
