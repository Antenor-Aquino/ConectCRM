// Assistente do ConectCRM dentro do Emissor Nacional (spec 19, fase 3).
// Injetado pelo service worker na aba do portal (chrome.scripting, mundo
// isolado). Por isso é uma função só, sem importações: tudo o que usa está aqui dentro.
// Painel fixo à direita com:
//  - conferência da empresa logada (CNPJ na página);
//  - os campos da etapa (Pessoas, Serviço, Valores), cada um com Copiar;
//  - "Preencher esta etapa": acha os campos pelo rótulo do guia oficial,
//    preenche, marca de verde e diz o que não achou;
//  - na tela "NFS-e gerada": lê a chave de acesso e o número e traz para o CRM.
// Quem clica em Avançar e em Emitir NFS-e é sempre o usuário.
import type { PortalPayload } from "./portalSteps";

export function nfseAssistant(payload: PortalPayload): void {
  const HOST_ID = "conectcrm-nfse-assistant";
  document.getElementById(HOST_ID)?.remove();
  const w = window as unknown as { __conectcrmNfseTimer?: number };
  if (w.__conectcrmNfseTimer) clearInterval(w.__conectcrmNfseTimer);

  type Step = "pessoas" | "servico" | "valores";
  type Field = PortalPayload["fields"][number];
  type Result = "ok" | "notfound" | "ambiguous" | "nosuggestion";
  const STEP_LABEL: Record<Step, string> = { pessoas: "Pessoas", servico: "Serviço", valores: "Valores" };
  const SECTIONS = ["emitente", "prestador", "tomador", "intermediario", "destinatario", "local"];
  const results: Record<string, Result> = {};

  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[*:]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const digits = (s: string) => s.replace(/\D/g, "");
  const host = document.createElement("div");
  host.id = HOST_ID;
  const visible = (el: Element) => {
    const h = el as HTMLElement;
    if (host.contains(h)) return false;
    const r = h.getBoundingClientRect();
    return (r.width > 0 || r.height > 0) && getComputedStyle(h).visibility !== "hidden";
  };
  const ownText = (el: Element) => norm(el.textContent ?? "");
  const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  /** Títulos de bloco (Tomador, Prestador…), para saber a qual bloco um rótulo pertence. */
  function sectionHeads(): { el: Element; key: string }[] {
    const out: { el: Element; key: string }[] = [];
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,strong,b,label,span,div,p,th,td").forEach((el) => {
      if (!visible(el) || el.childElementCount > 2) return;
      const t = ownText(el);
      if (!t || t.length > 60) return;
      const key = SECTIONS.find((s) => t.startsWith(s) || t.includes(`${s}/`) || t.includes(`${s} do`) || t.endsWith(s));
      if (key) out.push({ el, key });
    });
    return out;
  }
  function sectionOf(el: Element, heads: { el: Element; key: string }[]): string | null {
    let found: string | null = null;
    for (const h of heads) if (h.el !== el && !h.el.contains(el) && before(h.el, el)) found = h.key;
    return found;
  }

  /** Rótulos visíveis com o texto pedido (igual ou começando por ele). */
  function findLabels(labels: string[], section?: string): { els: Element[]; ambiguous: boolean } {
    const heads = section ? sectionHeads() : [];
    const sec = section ? norm(section) : null;
    for (const lb of labels) {
      const want = norm(lb);
      const cands: Element[] = [];
      document.querySelectorAll("label,legend,th,td,span,div,p,strong,b,dt").forEach((el) => {
        if (!visible(el) || el.childElementCount > 3) return;
        const t = ownText(el);
        // Rótulo igual, ou começando pelo nome (os longos, como "Número do Pedido, Ordem de Compra…", podem ter bastante texto depois).
        if (t === want || (t.startsWith(want) && t.length <= want.length + (want.length >= 12 ? 90 : 25))) cands.push(el);
      });
      // Fica só o mais interno (o <span> dentro do <label> etc.).
      let list = cands.filter((c) => !cands.some((o) => o !== c && c.contains(o)));
      if (sec && heads.length) list = list.filter((c) => sectionOf(c, heads) === sec);
      if (list.length === 1) return { els: list, ambiguous: false };
      if (list.length > 1) {
        const labelsOnly = list.filter((c) => c.tagName === "LABEL");
        if (labelsOnly.length === 1) return { els: labelsOnly, ambiguous: false };
        return { els: list, ambiguous: true };
      }
    }
    return { els: [], ambiguous: false };
  }

  type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const CONTROL = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,select";
  function controlFor(label: Element): Control | null {
    const id = (label as HTMLLabelElement).htmlFor;
    if (id) {
      const el = document.getElementById(id);
      if (el && el.matches(CONTROL)) return el as Control;
    }
    const inside = label.querySelector(CONTROL);
    if (inside) return inside as Control;
    let anc: Element | null = label;
    for (let i = 0; i < 4 && anc; i++) {
      anc = anc.parentElement;
      if (!anc) break;
      const all = [...anc.querySelectorAll(CONTROL)].filter((c) => before(label, c) && (visible(c) || (c as HTMLSelectElement).tagName === "SELECT"));
      if (all.length) return all[0] as Control;
    }
    return null;
  }

  function setValue(el: Control, value: string) {
    if (el instanceof HTMLSelectElement) {
      const v = norm(value);
      const opt = [...el.options].find((o) => norm(o.text) === v || o.value === value) ?? [...el.options].find((o) => norm(o.text).includes(v) || v.includes(norm(o.text)));
      if (!opt) return false;
      el.value = opt.value;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      el.focus();
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: value.slice(-1) }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    (el as HTMLElement).style.outline = "2px solid #12b76a";
    return true;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function pickSuggestion(value: string): Promise<boolean> {
    const v = norm(value);
    const code = digits(value);
    for (let i = 0; i < 8; i++) {
      await sleep(300);
      const opts = [...document.querySelectorAll("li,[role=option],.ui-menu-item,.select2-results__option,.dropdown-item,.autocomplete-suggestion,.tt-suggestion,.list-group-item")].filter(
        (o) => visible(o) && o.childElementCount < 6,
      );
      const hit =
        opts.find((o) => ownText(o).startsWith(v)) ??
        opts.find((o) => ownText(o).includes(v)) ??
        (code.length >= 4 ? opts.find((o) => digits(o.textContent ?? "").startsWith(code)) : undefined);
      if (hit) {
        (hit as HTMLElement).click();
        return true;
      }
    }
    return false;
  }

  async function fillField(f: Field): Promise<Result> {
    if (f.kind === "copy") return "notfound";
    const { els, ambiguous } = findLabels(f.labels, f.section);
    if (ambiguous) return "ambiguous";
    if (!els.length) return "notfound";
    const label = els[0]!;
    if (f.kind === "choice") {
      const id = (label as HTMLLabelElement).htmlFor;
      const radio =
        (id ? (document.getElementById(id) as HTMLInputElement | null) : null) ??
        label.querySelector<HTMLInputElement>("input[type=radio],input[type=checkbox]") ??
        (label.previousElementSibling?.matches("input[type=radio],input[type=checkbox]") ? (label.previousElementSibling as HTMLInputElement) : null) ??
        label.parentElement?.querySelector<HTMLInputElement>("input[type=radio],input[type=checkbox]") ??
        null;
      if (!radio) return "notfound";
      if (!radio.checked) radio.click();
      (radio.parentElement as HTMLElement).style.outline = "2px solid #12b76a";
      return "ok";
    }
    const el = controlFor(label);
    if (!el) return "notfound";
    if (f.kind === "combo" && el instanceof HTMLSelectElement) return setValue(el, f.value) ? "ok" : "nosuggestion";
    if (!setValue(el, f.kind === "combo" ? (digits(f.value).length >= 4 ? digits(f.value) : f.value) : f.value)) return "notfound";
    if (f.kind === "combo") return (await pickSuggestion(f.value)) ? "ok" : "nosuggestion";
    return "ok";
  }

  // ---------- Estado da página ----------
  function pageText() {
    return norm(document.body.innerText || "");
  }
  function guessStep(): Step {
    const score = (s: Step) => payload.fields.filter((f) => f.step === s && f.kind !== "copy" && findLabels(f.labels).els.length).length;
    const ranked = (["pessoas", "servico", "valores"] as Step[]).map((s) => ({ s, n: score(s) })).sort((a, b) => b.n - a.n);
    return ranked[0]!.n ? ranked[0]!.s : current;
  }
  function issuedInfo(): { key: string | null; number: string | null } | null {
    const raw = document.body.innerText || "";
    const t = norm(raw);
    if (!/(nfs-e|nota fiscal).{0,40}(gerada|emitida) com sucesso|nfs-e gerada/.test(t)) return null;
    const m = raw.match(/chave\s+de\s+acesso[^0-9A-Za-z]{0,30}([0-9A-Za-z][0-9A-Za-z .\-]{48,90})/i);
    let key = m ? m[1]!.replace(/[^0-9A-Za-z]/g, "").slice(0, 50).toUpperCase() : null;
    if (!key || key.length !== 50) key = raw.replace(/[ .\-]/g, "").match(/\b[0-9A-Z]{50}\b/)?.[0] ?? null;
    const n = raw.match(/n[úu]mero\s+(?:da\s+)?nfs-?e[^0-9]{0,20}(\d{1,15})/i) ?? raw.match(/nfs-?e\s*n[º°o.]*\s*(\d{1,15})/i);
    return { key, number: n ? n[1]! : null };
  }
  function companyCheck(): { kind: "ok" | "warn" | "unknown"; text: string } {
    const txt = (document.body.innerText || "").replace(/[^\d]/g, " ");
    const fmt = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    const has = (c: string) => (document.body.innerText || "").includes(fmt(c)) || txt.includes(c);
    if (has(payload.issuer.cnpj)) return { kind: "ok", text: `Portal na empresa certa: ${fmt(payload.issuer.cnpj)}.` };
    const other = payload.otherCnpjs.find(has);
    if (other) return { kind: "warn", text: `O portal parece estar na empresa ${fmt(other)}, mas esta nota é de ${payload.issuer.name} (${fmt(payload.issuer.cnpj)}). Troque o perfil ou entre com o certificado certo.` };
    return { kind: "unknown", text: `Confira se o portal está em ${payload.issuer.name} (${fmt(payload.issuer.cnpj)}).` };
  }

  // ---------- Painel ----------
  const root = host.attachShadow({ mode: "open" });
  host.style.cssText = "position:fixed;top:72px;right:16px;z-index:2147483647;";
  document.body.appendChild(host);
  let current: Step = "pessoas";
  let minimized = false;
  let busy = false;
  let sentMsg = "";

  const css = `
    *{box-sizing:border-box;font-family:Inter,system-ui,Arial,sans-serif}
    .box{width:340px;max-height:calc(100vh - 100px);overflow:auto;background:#fff;border:1px solid #d0d5dd;border-radius:14px;box-shadow:0 12px 32px rgba(16,24,40,.18);font-size:13px;color:#344054}
    .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#465fff;color:#fff;border-radius:13px 13px 0 0}
    .hd b{flex:1;font-size:13px}.hd button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer}
    .bd{padding:10px 12px}
    .env{font-size:11px;margin-bottom:6px;color:#b54708}
    .chk{padding:6px 8px;border-radius:8px;margin-bottom:8px;font-size:12px}
    .ok{background:#ecfdf3;color:#027a48}.warn{background:#fef3f2;color:#b42318}.unk{background:#f2f4f7;color:#475467}
    .tabs{display:flex;gap:4px;margin-bottom:8px}.tabs button{flex:1;border:1px solid #d0d5dd;background:#fff;border-radius:8px;padding:5px;cursor:pointer;font-size:12px}
    .tabs button.on{background:#465fff;color:#fff;border-color:#465fff}
    .f{border:1px solid #eaecf0;border-radius:8px;padding:6px 8px;margin-bottom:6px}
    .f .t{display:flex;justify-content:space-between;gap:6px;font-size:11px;color:#667085}
    .f .v{white-space:pre-wrap;word-break:break-word;margin-top:2px;color:#101828;max-height:90px;overflow:auto}
    .f button{border:0;background:#f2f4f7;border-radius:6px;padding:1px 7px;cursor:pointer;font-size:11px}
    .st{font-size:11px;margin-top:3px}.st.ok{background:none}.st.warn{background:none}
    .main{width:100%;margin:6px 0;padding:8px;border:0;border-radius:8px;background:#465fff;color:#fff;font-weight:600;cursor:pointer}
    .main:disabled{opacity:.6}
    .rem{font-size:11px;color:#667085;margin:6px 0 0 14px;padding:0}
    .done{background:#ecfdf3;border:1px solid #abefc6;border-radius:8px;padding:8px;margin-bottom:8px}
    input{width:100%;padding:5px;border:1px solid #d0d5dd;border-radius:6px;font-size:12px}
  `;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

  function render() {
    if (minimized) {
      root.innerHTML = `<style>${css}</style><div class="box"><div class="hd"><b>ConectCRM · NFS-e</b><button data-a="max">Abrir</button></div></div>`;
      bind();
      return;
    }
    const comp = companyCheck();
    const iss = issuedInfo();
    const fields = payload.fields.filter((f) => f.step === current);
    const status = (f: Field) => {
      const r = results[f.id];
      if (!r) return "";
      const map: Record<Result, [string, string]> = {
        ok: ["ok", "✓ preenchido — confira"],
        notfound: ["warn", f.kind === "copy" ? "" : "campo não achado: copie e cole"],
        ambiguous: ["warn", "mais de um campo com esse nome: copie e cole"],
        nosuggestion: ["warn", "digitado; escolha a opção na lista do portal"],
      };
      const [c, t] = map[r];
      return t ? `<div class="st ${c}">${t}</div>` : "";
    };
    root.innerHTML = `<style>${css}</style>
      <div class="box">
        <div class="hd"><b>ConectCRM · NFS-e</b><button data-a="min">–</button><button data-a="close">✕</button></div>
        <div class="bd">
          ${payload.environment === "producao_restrita" ? `<div class="env">Ambiente de testes (produção restrita): a nota não tem valor fiscal.</div>` : ""}
          <div class="chk ${comp.kind === "ok" ? "ok" : comp.kind === "warn" ? "warn" : "unk"}">${esc(comp.text)}</div>
          ${
            iss
              ? `<div class="done"><b>NFS-e gerada.</b><br>
                 Chave: <input data-k="key" value="${esc(iss.key ?? "")}" placeholder="cole a chave de acesso (50 caracteres)"><br>
                 Número: <input data-k="num" value="${esc(iss.number ?? "")}" placeholder="número da NFS-e">
                 <button class="main" data-a="send">Trazer nota para o CRM</button>${sentMsg ? `<div class="st">${esc(sentMsg)}</div>` : ""}</div>`
              : ""
          }
          <div class="tabs">${(["pessoas", "servico", "valores"] as Step[]).map((s) => `<button data-step="${s}" class="${s === current ? "on" : ""}">${STEP_LABEL[s]}</button>`).join("")}</div>
          <button class="main" data-a="fill" ${busy ? "disabled" : ""}>${busy ? "Preenchendo…" : `Preencher a etapa ${STEP_LABEL[current]}`}</button>
          ${fields
            .map(
              (f) => `<div class="f"><div class="t"><span>${esc(f.title)}</span><button data-copy="${f.id}">Copiar</button></div><div class="v">${esc(f.value)}</div>${status(f)}</div>`,
            )
            .join("")}
          <ul class="rem">${payload.reminders.map((r) => `<li>${esc(r)}</li>`).join("")}<li>Quem clica em Avançar e em Emitir NFS-e é você.</li></ul>
        </div>
      </div>`;
    bind();
  }

  function bind() {
    root.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) =>
      b.addEventListener("click", () => {
        current = b.dataset.step as Step;
        render();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) =>
      b.addEventListener("click", async () => {
        const f = payload.fields.find((x) => x.id === b.dataset.copy)!;
        await navigator.clipboard.writeText(f.value);
        b.textContent = "Copiado";
        setTimeout(() => (b.textContent = "Copiar"), 1200);
      }),
    );
    root.querySelector("[data-a=min]")?.addEventListener("click", () => {
      minimized = true;
      render();
    });
    root.querySelector("[data-a=max]")?.addEventListener("click", () => {
      minimized = false;
      render();
    });
    root.querySelector("[data-a=close]")?.addEventListener("click", () => {
      if (w.__conectcrmNfseTimer) clearInterval(w.__conectcrmNfseTimer);
      host.remove();
    });
    root.querySelector("[data-a=fill]")?.addEventListener("click", async () => {
      busy = true;
      render();
      for (const f of payload.fields.filter((x) => x.step === current)) results[f.id] = await fillField(f);
      busy = false;
      render();
    });
    root.querySelector("[data-a=send]")?.addEventListener("click", async () => {
      const key = (root.querySelector<HTMLInputElement>("[data-k=key]")?.value ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
      const number = root.querySelector<HTMLInputElement>("[data-k=num]")?.value.trim() ?? "";
      if (key.length !== 50) {
        sentMsg = "A chave de acesso tem 50 caracteres: copie da tela e cole aqui.";
        return render();
      }
      const r = (await chrome.runtime.sendMessage({ target: "background", kind: "nfse-issued", cardId: payload.cardId, accessKey: key, number, environment: payload.environment })) as
        | { ok: boolean; error?: string }
        | undefined;
      sentMsg = r?.ok ? "Nota registrada no cartão do ConectCRM." : `Não deu para registrar: ${r?.error ?? "sem resposta do ConectCRM"}`;
      render();
    });
  }

  current = guessStep();
  render();
  // A página muda de etapa sem recarregar (ou recarrega e o assistente volta): confere a cada 2 s.
  let lastSig = "";
  w.__conectcrmNfseTimer = window.setInterval(() => {
    if (busy || minimized || !document.getElementById(HOST_ID)) return;
    const iss = issuedInfo();
    const sig = `${guessStep()}|${iss ? `${iss.key}${iss.number}` : ""}|${companyCheck().kind}`;
    if (sig !== lastSig) {
      const focused = root.activeElement;
      if (focused && focused.tagName === "INPUT") return; // não atrapalha quem está digitando a chave
      lastSig = sig;
      current = guessStep();
      render();
    }
  }, 2000);
}
