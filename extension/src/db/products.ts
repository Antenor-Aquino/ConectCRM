// Produtos e serviços (catálogo usado nos itens do negócio).
import { normalizeCents, optionalText, requireText, ValidationError } from "../lib/validate";
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, type DatabaseSync, type SqlValue } from "./sql";

export type ProductKind = "produto" | "servico";
export type Recurrence = "avulso" | "mensal" | "trimestral" | "semestral" | "anual";
export const RECURRENCES: Recurrence[] = ["avulso", "mensal", "trimestral", "semestral", "anual"];

export interface Product {
  id: string;
  code: string | null;
  name: string;
  kind: ProductKind;
  unit: string | null;
  price_cents: number;
  cost_cents: number | null;
  recurrence: Recurrence;
  category_id: string | null;
  description: string | null;
  active: number;
}

export interface ProductInput {
  code?: string | null;
  name: string;
  kind: ProductKind;
  unit?: string | null;
  priceCents?: number;
  costCents?: number | null;
  recurrence?: Recurrence;
  categoryId?: string | null;
  description?: string | null;
  active?: boolean;
}

function productData(db: DatabaseSync, input: Partial<ProductInput>, full: boolean, exceptId = ""): Record<string, SqlValue> {
  const data: Record<string, SqlValue> = {};
  if (full || input.name !== undefined) data.name = requireText(input.name, "Informe o nome do produto ou serviço.");
  if (full || input.kind !== undefined) {
    if (input.kind !== "produto" && input.kind !== "servico") throw new ValidationError("Escolha produto ou serviço.");
    data.kind = input.kind;
  }
  if (full || input.code !== undefined) {
    data.code = optionalText(input.code);
    if (data.code && one(db, "SELECT 1 FROM product WHERE code = ? AND deleted_at IS NULL AND id <> ?", data.code, exceptId)) {
      throw new ValidationError(`O código ${data.code} já está em uso.`);
    }
  }
  if (full || input.unit !== undefined) data.unit = optionalText(input.unit);
  if (full || input.priceCents !== undefined) data.price_cents = normalizeCents(input.priceCents, "Preço");
  if (full || input.costCents !== undefined) data.cost_cents = input.costCents == null ? null : normalizeCents(input.costCents, "Custo");
  if (full || input.recurrence !== undefined) {
    const r = input.recurrence ?? "avulso";
    if (!RECURRENCES.includes(r)) throw new ValidationError("Recorrência inválida.");
    data.recurrence = r;
  }
  if (full || input.categoryId !== undefined) {
    if (input.categoryId && !one(db, "SELECT 1 FROM product_category WHERE id = ? AND deleted_at IS NULL", input.categoryId)) {
      throw new ValidationError("Categoria não encontrada.");
    }
    data.category_id = input.categoryId ?? null;
  }
  if (full || input.description !== undefined) data.description = optionalText(input.description);
  if (input.active !== undefined) data.active = input.active ? 1 : 0;
  return data;
}

export function createProduct(db: DatabaseSync, ctx: DbContext, input: ProductInput): string {
  return insertRow(db, ctx, "product", productData(db, input, true));
}

export function updateProduct(db: DatabaseSync, ctx: DbContext, id: string, patch: Partial<ProductInput>): void {
  updateRow(db, ctx, "product", id, productData(db, patch, false, id));
}

export function deleteProduct(db: DatabaseSync, ctx: DbContext, id: string): void {
  softDelete(db, ctx, "product", id);
}

export function getProduct(db: DatabaseSync, id: string): Product | undefined {
  return one<Product>(db, "SELECT * FROM product WHERE id = ? AND deleted_at IS NULL", id);
}

export function listProducts(db: DatabaseSync, opts: { search?: string; includeInactive?: boolean; categoryId?: string } = {}): Product[] {
  const where = ["deleted_at IS NULL"];
  const params: SqlValue[] = [];
  if (!opts.includeInactive) where.push("active = 1");
  if (opts.search?.trim()) {
    where.push("(name LIKE ? OR code LIKE ?)");
    params.push(`%${opts.search.trim()}%`, `%${opts.search.trim()}%`);
  }
  if (opts.categoryId) {
    where.push("category_id = ?");
    params.push(opts.categoryId);
  }
  return many<Product>(
    db,
    `SELECT id, code, name, kind, unit, price_cents, cost_cents, recurrence, category_id, description, active FROM product
     WHERE ${where.join(" AND ")} ORDER BY name COLLATE NOCASE`,
    ...params,
  );
}

export function listProductCategories(db: DatabaseSync): { id: string; name: string }[] {
  return many(db, "SELECT id, name FROM product_category WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE");
}

export function createProductCategory(db: DatabaseSync, ctx: DbContext, name: string): string {
  return insertRow(db, ctx, "product_category", { name: requireText(name, "Informe o nome da categoria.") });
}

export function renameProductCategory(db: DatabaseSync, ctx: DbContext, id: string, name: string): void {
  updateRow(db, ctx, "product_category", id, { name: requireText(name, "Informe o nome da categoria.") });
}

export function deleteProductCategory(db: DatabaseSync, ctx: DbContext, id: string): void {
  if (one(db, "SELECT 1 FROM product WHERE category_id = ? AND deleted_at IS NULL", id)) {
    throw new ValidationError("Há produtos nesta categoria.");
  }
  softDelete(db, ctx, "product_category", id);
}

/** Quantos itens de negócio usam cada produto. */
export function productUsage(db: DatabaseSync): Record<string, number> {
  const rows = many<{ product_id: string; n: number }>(
    db,
    "SELECT product_id, COUNT(*) AS n FROM deal_item WHERE product_id IS NOT NULL AND deleted_at IS NULL GROUP BY product_id",
  );
  return Object.fromEntries(rows.map((r) => [r.product_id, r.n]));
}
