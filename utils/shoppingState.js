const MAX_QUANTITY = 2147483647;
const STATUSES = ["PENDING", "FOUND", "NOT_FOUND"];
class ShoppingStateError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const integer = (value, minimum = 0) => {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value.trim()))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= MAX_QUANTITY ? parsed : null;
};
const legacyBoolean = value => value === true || value === 1 || value === "1" || typeof value === "string" && value.toLowerCase() === "true";

// A resolved row keeps its bought units even when its remaining units are missing.
function shoppingState(current, changes) {
  if (changes.quantity_delta !== undefined && changes.quantity !== undefined) throw new ShoppingStateError("Indica una cantidad o un incremento, no ambos.");
  const increment = changes.quantity_delta === undefined ? 0 : integer(changes.quantity_delta, 1);
  if (increment === null) throw new ShoppingStateError("La cantidad que se añade no es válida.");
  const quantity = changes.quantity_delta !== undefined ? integer(current.quantity + increment, 1) : changes.quantity === undefined ? current.quantity : integer(changes.quantity, 1);
  if (quantity === null) throw new ShoppingStateError("La cantidad no es válida.");
  let purchased = current.status === "FOUND" || current.check_take ? current.quantity : current.purchased_quantity;
  let status = current.status || (current.check_take ? "FOUND" : "PENDING");
  if (changes.status !== undefined) {
    status = typeof changes.status === "string" ? changes.status.toUpperCase() : "";
    if (!STATUSES.includes(status)) throw new ShoppingStateError("El estado no es válido.");
  } else if (changes.check_take !== undefined) status = legacyBoolean(changes.check_take) ? "FOUND" : "PENDING";
  if (changes.purchased_quantity !== undefined) {
    purchased = integer(changes.purchased_quantity);
    if (purchased === null) throw new ShoppingStateError("La cantidad comprada no es válida.");
    if (changes.status === undefined && changes.check_take === undefined) status = purchased === quantity ? "FOUND" : "PENDING";
  } else if (changes.status !== undefined && status === "FOUND" || changes.check_take !== undefined && legacyBoolean(changes.check_take)) {
    purchased = quantity;
  } else if (changes.status !== undefined && (status === "PENDING" || status === "NOT_FOUND" && (current.status === "FOUND" || current.check_take))) {
    purchased = 0;
  } else if (changes.check_take !== undefined && !legacyBoolean(changes.check_take)) {
    purchased = 0;
  }
  if (purchased > quantity) throw new ShoppingStateError("La cantidad no puede ser menor que las unidades compradas.");
  if (purchased === quantity) status = "FOUND";
  else if (status === "FOUND") status = "PENDING";
  return { quantity, purchased_quantity: purchased, status, check_take: status === "FOUND" };
}
module.exports = { shoppingState, ShoppingStateError, integer, MAX_QUANTITY };
