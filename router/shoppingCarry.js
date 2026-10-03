const express = require("express");
const prisma = require("../prisma/prisma");
const auth = require("../middleware/auth.middleware");
const { getAccessibleList } = require("../utils/permissions");
const { carryMissing, undoCarry, ShoppingCarryError, hasPending } = require("../utils/shoppingCarry");
const { shoppingTransaction: transaction } = require("../utils/shoppingTransaction");
const router = express.Router();
const errorResponse = (res, error) => {
  if (!(error instanceof ShoppingCarryError)) console.error(error);
  res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "No se pudo guardar lo que falta. Se conservan tus datos." });
};
const notify = (req, sourceId, targetId) => {
  const io = req.app.get("io");
  for (const id of [sourceId, targetId]) if (id) io?.to(`list:${id}`).emit("list:changed", { list_id: id });
};

router.get("/carry-missing/:sourceId", auth, async (req, res) => {
  try {
    const source = await getAccessibleList(req.user?.id, req.params.sourceId);
    if (!source) throw new ShoppingCarryError("No tienes permiso para consultar esta lista.", 403);
    const [lists, carry] = await Promise.all([
      prisma.list.findMany({ where: { home_id: source.home_id, id: { not: source.id }, listCheck: false }, include: { itemsList: { include: { item: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.shoppingCarry.findUnique({ where: { source_list_id: source.id } }),
    ]);
    const legacy = !carry ? await prisma.list.findFirst({ where: { copied_from_not_found_list_id: source.id }, select: { id: true } }) : null;
    res.json({ success: true, targets: lists.filter(list => hasPending(list.itemsList)), carry: carry && !carry.undone_at ? carry : legacy ? { source_list_id: source.id, target_list_id: legacy.id, legacy: true } : null });
  } catch (error) { errorResponse(res, error); }
});

const create = async (req, res) => {
  try {
    const sourceId = req.params.sourceId;
    const result = await transaction(tx => carryMissing(tx, { userId: req.user?.id, sourceId, mode: req.body.mode || "new", title: req.body.title, targetId: req.body.target_list_id }));
    notify(req, sourceId, result.list.id);
    res.json({ success: true, message: result.reused ? "Lo que faltaba ya estaba guardado en esta lista." : "Unidades no compradas guardadas.", ...result, clientMutationId: req.body.clientMutationId });
  } catch (error) { errorResponse(res, error); }
};
router.post("/carry-missing/:sourceId", auth, create);
router.post("/carry-missing/:sourceId/undo", auth, async (req, res) => {
  try {
    const result = await transaction(tx => undoCarry(tx, { userId: req.user?.id, sourceId: req.params.sourceId, carryId: req.body.carry_id }));
    notify(req, req.params.sourceId, result.carry.target_list_id);
    res.json({ success: true, message: "Traslado deshecho; las compras y cambios posteriores se conservan.", ...result, clientMutationId: req.body.clientMutationId });
  } catch (error) { errorResponse(res, error); }
});
// Existing clients keep their endpoint and response fields, with transactional checks.
router.post("/create-from-not-found/:sourceId", auth, create);

module.exports = router;
