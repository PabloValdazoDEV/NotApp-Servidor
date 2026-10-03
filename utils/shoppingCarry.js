const MAX_QUANTITY = 2147483647;
const { randomUUID } = require("node:crypto");

class ShoppingCarryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const remaining = row => Math.max(0, row.quantity - row.purchased_quantity);
const hasPending = rows => rows.some(row => row.status === "PENDING" && remaining(row) > 0);
const missingRows = rows => rows.filter(row => row.status === "NOT_FOUND" && remaining(row) > 0);

// The caller supplies a serializable transaction. Existing rows are never reset.
async function carryMissing(tx, { userId, sourceId, mode, title, targetId }) {
  if (!userId) throw new ShoppingCarryError("No tienes permiso para modificar esta lista.", 403);
  const source = await tx.list.findFirst({
    where: { id: sourceId, home: { members: { some: { user_id: userId } } } },
    include: { itemsList: true },
  });
  if (!source) throw new ShoppingCarryError("No tienes permiso para consultar esta lista.", 403);
  const previous = await tx.shoppingCarry.findUnique({ where: { source_list_id: sourceId }, include: { target: { include: { itemsList: { include: { item: true } } } } } });
  if (previous && !previous.undone_at) return { list: previous.target, carry: previous, reused: true };
  const legacy = await tx.list.findFirst({ where: { copied_from_not_found_list_id: sourceId, home_id: source.home_id }, include: { itemsList: true } });
  if (legacy && !previous) return { list: legacy, carry: { source_list_id: sourceId, target_list_id: legacy.id, legacy: true }, reused: true };
  if (!source.itemsList.length || hasPending(source.itemsList)) throw new ShoppingCarryError("Termina de revisar la compra antes de guardar lo que falta.", 409);
  const rows = missingRows(source.itemsList);
  if (!rows.length) throw new ShoppingCarryError("No quedan unidades no compradas para otra lista.");
  if (!["new", "existing"].includes(mode)) throw new ShoppingCarryError("Elige una lista nueva o una lista activa.");
  let target;
  if (mode === "existing") {
    if (typeof targetId !== "string" || !targetId.trim()) throw new ShoppingCarryError("Elige una lista activa del mismo hogar.", 400);
    target = await tx.list.findFirst({ where: { id: targetId, home_id: source.home_id }, include: { itemsList: true } });
    if (!target || target.id === source.id || target.listCheck || !hasPending(target.itemsList)) throw new ShoppingCarryError("Elige una lista activa del mismo hogar.", 409);
  } else {
    if (typeof title !== "string" || !title.trim() || title.trim().length > 120) throw new ShoppingCarryError("Escribe un nombre de lista de hasta 120 caracteres.");
    target = await tx.list.create({ data: { title: title.trim(), home_id: source.home_id, copied_from_not_found_list_id: source.id }, include: { itemsList: true } });
  }
  const deltas = [];
  // Multiple historical rows for the same product may have units left over.
  const quantities = new Map();
  for (const row of rows) quantities.set(row.item_id, (quantities.get(row.item_id) || 0) + remaining(row));
  for (const [itemId, quantity] of quantities) {
    const existing = target.itemsList.find(row => row.item_id === itemId && row.status === "PENDING" && remaining(row) > 0);
    if (!Number.isInteger(quantity) || quantity > MAX_QUANTITY || existing && existing.quantity + quantity > MAX_QUANTITY) throw new ShoppingCarryError("La cantidad supera el máximo permitido.");
    const row = existing
      ? await tx.itemList.update({ where: { id: existing.id }, data: { quantity: { increment: quantity } } })
      : await tx.itemList.create({ data: { item_id: itemId, list_id: target.id, quantity, purchased_quantity: 0, check_take: false, status: "PENDING" } });
    deltas.push({ id: row.id, item_id: itemId, quantity, created: !existing });
  }
  const data = { target_list_id: target.id, created_by_user_id: userId, created_target: mode === "new", deltas, undone_at: null };
  const carry = await tx.shoppingCarry.upsert({ where: { source_list_id: sourceId }, create: { source_list_id: sourceId, ...data }, update: { ...data, id: randomUUID(), createdAt: new Date() } });
  const list = await tx.list.findUnique({ where: { id: target.id }, include: { itemsList: { include: { item: true } } } });
  return { list, carry, reused: false };
}

async function undoCarry(tx, { userId, sourceId, carryId }) {
  if (!userId) throw new ShoppingCarryError("No tienes permiso para modificar esta lista.", 403);
  const source = await tx.list.findFirst({ where: { id: sourceId, home: { members: { some: { user_id: userId } } } } });
  if (!source) throw new ShoppingCarryError("No tienes permiso para modificar esta lista.", 403);
  const carry = await tx.shoppingCarry.findUnique({ where: { source_list_id: sourceId } });
  if (!carry || carry.id !== carryId) throw new ShoppingCarryError("No existe ese traslado para esta lista.", 404);
  if (carry.created_by_user_id !== userId) throw new ShoppingCarryError("Solo quien guardó las unidades puede deshacer el traslado.", 403);
  if (carry.undone_at) return { carry, reused: true };
  for (const delta of carry.deltas) {
    const row = await tx.itemList.findUnique({ where: { id: delta.id } });
    if (!row) continue;
    const quantity = row.quantity - delta.quantity;
    // A later purchase is history: do not delete it to make an undo succeed.
    if (quantity < row.purchased_quantity || !delta.created && quantity < 1) throw new ShoppingCarryError("La lista de destino ya ha cambiado. Conservamos sus compras; no se puede deshacer este traslado.", 409);
    if (quantity <= 0 && delta.created && row.purchased_quantity === 0) await tx.itemList.delete({ where: { id: row.id } });
    else {
      const status = row.purchased_quantity >= quantity ? "FOUND" : row.status;
      await tx.itemList.update({ where: { id: row.id }, data: { quantity, status, check_take: status === "FOUND" } });
    }
  }
  // Keep the newly created list itself, and every unrelated row/rename/change.
  if (carry.created_target) await tx.list.update({ where: { id: carry.target_list_id }, data: { copied_from_not_found_list_id: null } });
  const undone = await tx.shoppingCarry.update({ where: { id: carry.id }, data: { undone_at: new Date() } });
  return { carry: undone, reused: false };
}

const getCarryMap = async (db, listIds) => {
  if (!listIds.length) return new Map();
  const legacy = await db.list.findMany({ where: { copied_from_not_found_list_id: { in: listIds } }, select: { id: true, copied_from_not_found_list_id: true } });
  let current = [];
  try { current = await db.shoppingCarry.findMany({ where: { source_list_id: { in: listIds }, undone_at: null }, select: { source_list_id: true, target_list_id: true } }); }
  catch (error) { if (error.code !== "P2021") throw error; } // Old databases keep serving existing lists before the additive update.
  return new Map([...legacy.map(row => [row.copied_from_not_found_list_id, row.id]), ...current.map(row => [row.source_list_id, row.target_list_id])]);
};

module.exports = { ShoppingCarryError, carryMissing, undoCarry, getCarryMap, remaining, hasPending, MAX_QUANTITY };
