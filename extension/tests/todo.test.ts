// To Do (spec 15, fase 1): listas, tarefas, etapas, listas inteligentes,
// concluídas, mover entre listas, lixeira (lista leva as tarefas junto) e
// cada usuário vê só o que é dele.
import { describe, expect, it } from "vitest";
import * as todo from "../src/db/todo";
import { listTrash, restoreTrashItem } from "../src/db/trash";
import { createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ana = createUser(db, sys, { name: "Ana", role: "vendedor" });
  return { db, ctx: { ...sys, userId: me }, ana: { ...sys, userId: ana } };
}
const titles = (r: { open: todo.TodoTask[]; done: todo.TodoTask[] }) => ({ open: r.open.map((t) => t.title), done: r.done.map((t) => t.title) });

describe("To Do", () => {
  it("listas com contagem; tarefa nova no topo; listas inteligentes", async () => {
    const { db, ctx } = await setup();
    const pessoal = todo.createTodoList(db, ctx, { name: "Pessoal" });
    const perseus = todo.createTodoList(db, ctx, { name: "PERSEUS", color: "green" });
    todo.createTodoTask(db, ctx, { title: "Oficina Voyage", listId: pessoal });
    todo.createTodoTask(db, ctx, { title: "Teste", listId: pessoal, important: true, dueDate: "2026-11-26" });
    todo.createTodoTask(db, ctx, { title: "Ligar contador" }); // sem lista = "Tarefas"
    todo.createTodoTask(db, ctx, { title: "Revisar contrato", listId: perseus, dueDate: "2026-11-10" });

    expect(todo.listTodoLists(db, ctx).map((l) => [l.name, l.pending])).toEqual([["Pessoal", 2], ["PERSEUS", 1]]);
    expect(todo.todoCounts(db, ctx)).toEqual({ meudia: 0, importante: 1, planejado: 2, todas: 4, tarefas: 1 });
    expect(titles(todo.listTodoTasks(db, ctx, { listId: pessoal })).open).toEqual(["Teste", "Oficina Voyage"]);
    expect(titles(todo.listTodoTasks(db, ctx, { smart: "planejado" })).open).toEqual(["Revisar contrato", "Teste"]);
    expect(titles(todo.listTodoTasks(db, ctx, { smart: "importante" })).open).toEqual(["Teste"]);
    expect(titles(todo.listTodoTasks(db, ctx, { smart: "tarefas" })).open).toEqual(["Ligar contador"]);
    expect(titles(todo.listTodoTasks(db, ctx, { smart: "todas" }, { search: "contra" })).open).toEqual(["Revisar contrato"]);
    expect(() => todo.createTodoTask(db, ctx, { title: "x", dueDate: "26/11/2026" })).toThrow(/inválida/);
  });

  it("concluir, etapas, mover entre listas", async () => {
    const { db, ctx } = await setup();
    const a = todo.createTodoList(db, ctx, { name: "A" });
    const b = todo.createTodoList(db, ctx, { name: "B" });
    const t = todo.createTodoTask(db, ctx, { title: "Agendar pagamentos", listId: a });
    const s1 = todo.addTodoStep(db, ctx, t, "Separar boletos");
    todo.addTodoStep(db, ctx, t, "Pagar no banco");
    todo.updateTodoStep(db, ctx, s1, { done: true });
    expect(todo.getTodoTask(db, ctx, t)).toMatchObject({ steps_total: 2, steps_done: 1 });
    todo.updateTodoTask(db, ctx, t, { done: true });
    expect(titles(todo.listTodoTasks(db, ctx, { listId: a }))).toEqual({ open: [], done: ["Agendar pagamentos"] });
    expect(todo.listTodoLists(db, ctx).find((l) => l.id === a)!.pending).toBe(0);
    todo.updateTodoTask(db, ctx, t, { done: false, listId: b, notes: "  ver PGR  " });
    expect(todo.getTodoTask(db, ctx, t)).toMatchObject({ list_id: b, list_name: "B", done: 0, done_at: null, notes: "ver PGR" });
  });

  it("lixeira: tarefa e lista (com as tarefas) voltam ao restaurar", async () => {
    const { db, ctx } = await setup();
    const l = todo.createTodoList(db, ctx, { name: "POWERCUBUS" });
    const t1 = todo.createTodoTask(db, ctx, { title: "Proposta", listId: l });
    todo.addTodoStep(db, ctx, t1, "Planilha");
    todo.createTodoTask(db, ctx, { title: "Reunião", listId: l });
    todo.deleteTodoList(db, ctx, l);
    expect(todo.listTodoLists(db, ctx)).toEqual([]);
    expect(todo.todoCounts(db, ctx).todas).toBe(0);
    const item = listTrash(db, null).find((i) => i.entity === "todo_list")!;
    expect(item.title).toBe("POWERCUBUS");
    restoreTrashItem(db, ctx, null, item.id);
    expect(titles(todo.listTodoTasks(db, ctx, { listId: l })).open.sort()).toEqual(["Proposta", "Reunião"]);
    expect(todo.getTodoTask(db, ctx, t1)!.steps.map((s) => s.title)).toEqual(["Planilha"]);
  });

  it("Meu Dia: vale só hoje (zera à meia-noite) e sugere o que ficou para trás", async () => {
    const { db, ctx } = await setup();
    const hoje = todo.createTodoTask(db, ctx, { title: "Responder Natália", myDay: true });
    const ontem = todo.createTodoTask(db, ctx, { title: "Ligar contador", myDay: true });
    db.exec(`UPDATE todo_task SET my_day = '2000-01-01' WHERE id = '${ontem}'`); // ficou em um Meu Dia antigo
    const vence = todo.createTodoTask(db, ctx, { title: "Pagar boleto", dueDate: "2000-01-02" });
    todo.createTodoTask(db, ctx, { title: "Revisar proposta", important: true });
    todo.createTodoTask(db, ctx, { title: "Sem nada" });

    expect(titles(todo.listTodoTasks(db, ctx, { smart: "meudia" })).open).toEqual(["Responder Natália"]);
    expect(todo.todoCounts(db, ctx).meudia).toBe(1);
    // No dia seguinte, o Meu Dia começa vazio.
    const amanha = "2999-12-31";
    expect(todo.listTodoTasks(db, ctx, { smart: "meudia" }, { today: amanha }).open).toEqual([]);
    expect(todo.todoCounts(db, ctx, amanha).meudia).toBe(0);

    const s = todo.todoSuggestions(db, ctx);
    expect(s.earlier.map((t) => t.title)).toEqual(["Ligar contador"]);
    expect(s.due.map((t) => t.title)).toEqual(["Pagar boleto"]);
    expect(s.important.map((t) => t.title)).toEqual(["Revisar proposta"]);
    // Aceitar a sugestão põe no Meu Dia de hoje; concluir mantém em "Concluída" do Meu Dia.
    todo.updateTodoTask(db, ctx, ontem, { myDay: true });
    todo.updateTodoTask(db, ctx, vence, { myDay: true, done: true });
    expect(titles(todo.listTodoTasks(db, ctx, { smart: "meudia" }))).toEqual({ open: ["Ligar contador", "Responder Natália"], done: ["Pagar boleto"] });
    todo.updateTodoTask(db, ctx, hoje, { myDay: false });
    expect(todo.getTodoTask(db, ctx, hoje)!.my_day).toBeNull();
  });

  it("cada usuário vê só o que é dele", async () => {
    const { db, ctx, ana } = await setup();
    const minha = todo.createTodoList(db, ctx, { name: "Minha" });
    const t = todo.createTodoTask(db, ctx, { title: "Só minha", listId: minha });
    expect(todo.listTodoLists(db, ana)).toEqual([]);
    expect(todo.listTodoTasks(db, ana, { smart: "todas" }).open).toEqual([]);
    expect(() => todo.updateTodoTask(db, ana, t, { done: true })).toThrow(/não encontrada/);
    expect(() => methods["todo.taskCreate"](db, ana, { title: "x", listId: minha })).toThrow(/Lista não encontrada/);
  });
});
