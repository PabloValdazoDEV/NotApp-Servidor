const { ShoppingStateError } = require("./shoppingState");
const mutationKey = value => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 128) throw new ShoppingStateError("El identificador del cambio no es válido.");
  return value;
};
async function replayMutation(tx, { listId, mutationId, userId, select }) {
  if (!mutationId) return null;
  const saved = await tx.shoppingMutation.findUnique({ where: { list_id_mutation_id: { list_id: listId, mutation_id: mutationId } } });
  if (!saved) return null;
  if (saved.user_id !== userId) throw new ShoppingStateError("No se puede repetir ese cambio.", 403);
  const row = await tx.itemList.findUnique({ where: { id: saved.item_list_id }, select });
  if (!row) throw new ShoppingStateError("Este cambio ya se aplicó y el producto se ha retirado de la lista.", 409);
  return row;
}
async function recordMutation(tx, { listId, mutationId, userId, rowId, operation }) {
  if (mutationId) await tx.shoppingMutation.create({ data: { list_id: listId, mutation_id: mutationId, user_id: userId, item_list_id: rowId, operation } });
}
module.exports = { mutationKey, replayMutation, recordMutation };
