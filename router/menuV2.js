// Menús y recetas (v2). Rutas bajo /menu/v2. Las rutas antiguas de /menu
// siguen existiendo para las versiones anteriores de la app.
const crypto = require("crypto");
const express = require("express");
const { CATEGORY, Prisma } = require("@prisma/client");
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const { getAccessibleHome } = require("../utils/permissions");
const { expensiveUserRateLimiter, publicMenuRateLimiter } = require("../middleware/rateLimit");
const { getHomeLimits } = require("../utils/plans");
const { shoppingTransaction } = require("../utils/shoppingTransaction");
const P = require("../utils/menuPlanner");
const D = require("../utils/menuData");

const router = express.Router();

const MAX_RANGE_DAYS = 31;
const MAX_MEAL_TYPES = 12;
const CATEGORY_VALUES = new Set(Object.values(CATEGORY || {}));

const fail = (message, status = 400) => {
  throw new P.MenuInputError(message, status);
};

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof P.MenuInputError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error(error);
    return res.status(500).json({ success: false, message: "Error del servidor. No se ha cambiado nada." });
  }
};

const requireHome = async (req, homeId) => {
  if (!homeId || typeof homeId !== "string") fail("Falta el hogar");
  const home = await getAccessibleHome(req.user?.id, homeId, { select: { id: true, name: true } });
  if (!home) fail("No tienes permisos en este hogar", 403);
  await D.ensureMenuSetup(homeId);
  return home;
};

const requireOwned = async (req, model, id, select = {}) => {
  if (!id || typeof id !== "string") fail("Falta el identificador");
  const row = await prisma[model].findUnique({ where: { id }, select: { id: true, home_id: true, ...select } });
  if (!row) fail("No se ha encontrado", 404);
  await requireHome(req, row.home_id);
  return row;
};

const requireIsoDate = (value, label = "La fecha") => {
  if (!P.isValidIsoDate(value)) fail(`${label} debe tener formato AAAA-MM-DD`);
  return value;
};

const daysBetween = (start, end) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);

const leftoverConsumption = (dish) =>
  Math.max(1, (dish.diners?.length || 0) + (dish.guests || 0));

// Raciones de táper que quedan de cada plato fuente.
const remainingLeftovers = async (sourceIds, excludeDishId = null) => {
  if (!sourceIds.length) return new Map();
  const consumers = await prisma.plannedDish.findMany({
    where: {
      leftover_of_id: { in: sourceIds },
      ...(excludeDishId ? { id: { not: excludeDishId } } : {}),
    },
    select: { leftover_of_id: true, guests: true, diners: { select: { id: true } } },
  });
  const used = new Map();
  for (const consumer of consumers) {
    used.set(consumer.leftover_of_id, (used.get(consumer.leftover_of_id) || 0) + leftoverConsumption(consumer));
  }
  return used;
};

// ---------------------------------------------------------------------------
// Público (sin sesión): solo títulos de los platos. Sin comensales, notas ni raciones.
// ---------------------------------------------------------------------------
const hashPublicToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

router.get("/public/:token", publicMenuRateLimiter, handle(async (req, res) => {
  const { token } = req.params;
  const publicToken = await prisma.menuPublicToken.findFirst({
    where: { OR: [{ token }, { token_hash: hashPublicToken(String(token || "")) }], revokedAt: null },
    select: { home: { select: { id: true, name: true } } },
  });
  if (!publicToken?.home) fail("Menú no encontrado", 404);
  const homeId = publicToken.home.id;
  await D.ensureMenuSetup(homeId);

  const start = D.weekStartOf(D.todayIso());
  const end = D.addDays(start, 27);
  const [mealTypes, dishes] = await Promise.all([
    D.getMealTypes(homeId, { includeDeleted: true }),
    prisma.plannedDish.findMany({
      where: { home_id: homeId, date: { gte: D.isoToDbDate(start), lte: D.isoToDbDate(end) } },
      orderBy: [{ date: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      select: { date: true, meal_type_id: true, title: true, kind: true, time: true },
    }),
  ]);

  res.json({
    success: true,
    home: { name: publicToken.home.name },
    start,
    end,
    today: D.todayIso(),
    meal_types: mealTypes.map(({ id, name, default_time, active, deleted_at }) => ({
      id, name, default_time, active: active && !deleted_at,
    })),
    dishes: dishes.map((dish) => ({
      date: D.dbDateToIso(dish.date),
      meal_type_id: dish.meal_type_id,
      title: dish.title,
      kind: dish.kind,
      time: dish.time,
    })),
  });
}));

router.use(authMiddleware);

// ---------------------------------------------------------------------------
// Configuración del hogar: tipos de comida, personas y límites.
// ---------------------------------------------------------------------------
router.get("/home/:home_id/setup", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const [mealTypes, people, limits, recipesCount] = await Promise.all([
    D.getMealTypes(home.id),
    D.getHomePeople(home.id),
    getHomeLimits(home.id),
    prisma.recipe.count({ where: { home_id: home.id } }),
  ]);
  res.json({
    success: true,
    home,
    today: D.todayIso(),
    meal_types: mealTypes,
    people,
    limits: {
      plan: limits.plan,
      max_recipes: limits.maxRecipes,
      max_diners: limits.maxDiners,
      recipes_count: recipesCount,
      diners_count: people.diners.length,
    },
  });
}));

// ---------------------------------------------------------------------------
// Semana: platos de 7 días (cualquier semana, también pasadas = historial).
// ---------------------------------------------------------------------------
router.get("/home/:home_id/week", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const start = D.weekStartOf(req.query.start ? requireIsoDate(req.query.start) : D.todayIso());
  const end = D.addDays(start, 6);

  const dishes = await prisma.plannedDish.findMany({
    where: { home_id: home.id, date: { gte: D.isoToDbDate(start), lte: D.isoToDbDate(end) } },
    orderBy: [{ date: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    include: D.dishInclude,
  });

  const sources = dishes.filter((dish) => dish.kind === "RECIPE" && dish.extra_servings > 0);
  const used = await remainingLeftovers(sources.map((dish) => dish.id));

  const usedTypeIds = [...new Set(dishes.map((dish) => dish.meal_type_id))];
  const extraTypes = usedTypeIds.length
    ? await prisma.mealType.findMany({
        where: { id: { in: usedTypeIds }, NOT: { deleted_at: null } },
        select: { ...D.mealTypeSelect, deleted_at: true },
      })
    : [];

  res.json({
    success: true,
    week_start: start,
    days: Array.from({ length: 7 }, (_, index) => D.addDays(start, index)),
    today: D.todayIso(),
    hidden_meal_types: extraTypes,
    dishes: dishes.map((dish) => ({
      ...D.serializeDish(dish),
      leftovers_remaining: dish.kind === "RECIPE" && dish.extra_servings > 0
        ? Math.max(0, dish.extra_servings - (used.get(dish.id) || 0))
        : 0,
    })),
  });
}));

// Táperes disponibles para una fecha (los cocinados en las 2 semanas anteriores).
router.get("/home/:home_id/leftovers", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const date = requireIsoDate(req.query.date);
  const excludeDishId = typeof req.query.exclude_dish === "string" ? req.query.exclude_dish : null;

  const sources = await prisma.plannedDish.findMany({
    where: {
      home_id: home.id,
      kind: "RECIPE",
      extra_servings: { gt: 0 },
      date: { gte: D.isoToDbDate(D.addDays(date, -14)), lte: D.isoToDbDate(date) },
    },
    orderBy: [{ date: "desc" }],
    select: { id: true, title: true, date: true, extra_servings: true },
  });
  const used = await remainingLeftovers(sources.map((dish) => dish.id), excludeDishId);

  res.json({
    success: true,
    leftovers: sources
      .map((dish) => ({
        id: dish.id,
        title: dish.title,
        date: D.dbDateToIso(dish.date),
        remaining: Math.max(0, dish.extra_servings - (used.get(dish.id) || 0)),
        total: dish.extra_servings,
      }))
      .filter((dish) => dish.remaining > 0),
  });
}));

// ---------------------------------------------------------------------------
// Platos
// ---------------------------------------------------------------------------
const buildDishData = async (homeId, input, existing = null) => {
  const merged = { ...(existing || {}), ...input };
  const date = requireIsoDate(merged.date);
  const kind = P.DISH_KINDS.includes(merged.kind) ? merged.kind : fail("Tipo de plato no válido");

  const mealType = await prisma.mealType.findFirst({
    where: { id: String(merged.meal_type_id || ""), home_id: homeId },
    select: { id: true, deleted_at: true },
  });
  if (!mealType) fail("El tipo de comida no existe en este hogar");
  if (mealType.deleted_at && (!existing || existing.meal_type_id !== mealType.id)) {
    fail("Ese tipo de comida se ha eliminado");
  }

  const time = merged.time ? String(merged.time) : null;
  if (time && !P.isValidTime(time)) fail("La hora debe tener formato HH:MM");

  const data = {
    date: D.isoToDbDate(date),
    meal_type_id: mealType.id,
    kind,
    time,
    notes: P.cleanText(merged.notes, 1000),
    guests: P.clampInt(merged.guests, 0, 50, 0),
    extra_servings: kind === "RECIPE" ? P.clampInt(merged.extra_servings, 0, 50, 0) : 0,
    recipe_id: null,
    leftover_of_id: null,
    title: null,
  };

  if (kind === "RECIPE") {
    const recipe = await prisma.recipe.findFirst({
      where: { id: String(merged.recipe_id || ""), home_id: homeId },
      select: { id: true, name: true },
    });
    if (!recipe) {
      // Un plato antiguo cuya receta se borró conserva su copia guardada.
      if (existing?.recipe_snapshot && !merged.recipe_id) {
        data.title = existing.title;
      } else {
        fail("Elige una receta del recetario");
      }
    } else {
      data.recipe_id = recipe.id;
      data.title = recipe.name;
    }
  } else if (kind === "LEFTOVER") {
    if (merged.leftover_of_id) {
      const source = await prisma.plannedDish.findFirst({
        where: { id: String(merged.leftover_of_id), home_id: homeId, kind: "RECIPE" },
        select: { id: true, title: true, date: true },
      });
      if (!source) fail("Ese táper no existe");
      if (D.dbDateToIso(source.date) > date) fail("No puedes comer sobras de un plato que se cocina después");
      if (existing && source.id === existing.id) fail("Un plato no puede ser sobras de sí mismo");
      data.leftover_of_id = source.id;
      data.title = P.cleanText(merged.title, 120) || source.title;
    } else {
      data.title = P.cleanText(merged.title, 120) || fail("Escribe qué sobró");
    }
  } else if (kind === "OUT") {
    data.title = P.cleanText(merged.title, 120) || "Come fuera";
  } else {
    data.title = P.cleanText(merged.title, 120) || fail("Escribe el nombre del plato");
  }

  const userIds = [...new Set((Array.isArray(merged.user_ids) ? merged.user_ids : []).map(String))];
  const dinerIds = [...new Set((Array.isArray(merged.diner_ids) ? merged.diner_ids : []).map(String))];
  if (userIds.length) {
    const count = await prisma.member.count({ where: { home_id: homeId, user_id: { in: userIds } } });
    if (count !== userIds.length) fail("Alguna persona no pertenece al hogar");
  }
  if (dinerIds.length) {
    const count = await prisma.diner.count({ where: { home_id: homeId, id: { in: dinerIds } } });
    if (count !== dinerIds.length) fail("Alguna persona no pertenece al hogar");
  }

  return { data, userIds, dinerIds };
};

const dinerRows = (userIds, dinerIds) => [
  ...userIds.map((user_id) => ({ user_id })),
  ...dinerIds.map((diner_id) => ({ diner_id })),
];

router.post("/home/:home_id/dishes", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const { data, userIds, dinerIds } = await buildDishData(home.id, req.body || {});
  const last = await prisma.plannedDish.findFirst({
    where: { home_id: home.id, date: data.date, meal_type_id: data.meal_type_id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const dish = await prisma.plannedDish.create({
    data: {
      ...data,
      home_id: home.id,
      position: (last?.position ?? -1) + 1,
      created_by_user_id: req.user?.id || null,
      diners: { create: dinerRows(userIds, dinerIds) },
    },
    include: D.dishInclude,
  });
  res.status(201).json({ success: true, dish: D.serializeDish(dish) });
}));

router.patch("/dishes/:dish_id", handle(async (req, res) => {
  const existing = await requireOwned(req, "plannedDish", req.params.dish_id, {
    date: true, meal_type_id: true, kind: true, title: true, time: true, notes: true,
    recipe_id: true, recipe_snapshot: true, guests: true, extra_servings: true, leftover_of_id: true,
    diners: { select: { user_id: true, diner_id: true } },
  });
  const current = {
    ...existing,
    date: D.dbDateToIso(existing.date),
    user_ids: existing.diners.filter((row) => row.user_id).map((row) => row.user_id),
    diner_ids: existing.diners.filter((row) => row.diner_id).map((row) => row.diner_id),
  };
  const { data, userIds, dinerIds } = await buildDishData(existing.home_id, req.body || {}, current);

  const moved = data.meal_type_id !== existing.meal_type_id || D.dbDateToIso(data.date) !== current.date;
  if (moved) {
    const last = await prisma.plannedDish.findFirst({
      where: { home_id: existing.home_id, date: data.date, meal_type_id: data.meal_type_id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    data.position = (last?.position ?? -1) + 1;
  }
  if (data.recipe_id && data.recipe_id !== existing.recipe_id) data.recipe_snapshot = Prisma.DbNull;

  const dish = await prisma.$transaction(async (tx) => {
    await tx.plannedDishDiner.deleteMany({ where: { dish_id: existing.id } });
    return tx.plannedDish.update({
      where: { id: existing.id },
      data: { ...data, diners: { create: dinerRows(userIds, dinerIds) } },
      include: D.dishInclude,
    });
  });
  res.json({ success: true, dish: D.serializeDish(dish) });
}));

router.delete("/dishes/:dish_id", handle(async (req, res) => {
  const dish = await requireOwned(req, "plannedDish", req.params.dish_id);
  await prisma.plannedDish.delete({ where: { id: dish.id } });
  res.json({ success: true });
}));

router.post("/dishes/:dish_id/duplicate", handle(async (req, res) => {
  const source = await requireOwned(req, "plannedDish", req.params.dish_id, {
    date: true, meal_type_id: true, kind: true, title: true, time: true, notes: true, recipe_id: true,
    recipe_snapshot: true, guests: true, extra_servings: true, leftover_of_id: true,
    diners: { select: { user_id: true, diner_id: true } },
  });
  const date = requireIsoDate(req.body?.date || D.dbDateToIso(source.date));
  const mealTypeId = String(req.body?.meal_type_id || source.meal_type_id);
  const mealType = await prisma.mealType.findFirst({
    where: { id: mealTypeId, home_id: source.home_id, deleted_at: null },
    select: { id: true },
  });
  if (!mealType) fail("El tipo de comida no existe en este hogar");
  const last = await prisma.plannedDish.findFirst({
    where: { home_id: source.home_id, date: D.isoToDbDate(date), meal_type_id: mealType.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const dish = await prisma.plannedDish.create({
    data: {
      home_id: source.home_id,
      date: D.isoToDbDate(date),
      meal_type_id: mealType.id,
      position: (last?.position ?? -1) + 1,
      kind: source.kind === "LEFTOVER" ? "FREE" : source.kind,
      title: source.title,
      time: source.time,
      notes: source.notes,
      recipe_id: source.recipe_id,
      recipe_snapshot: source.recipe_id ? undefined : source.recipe_snapshot ?? undefined,
      guests: source.guests,
      extra_servings: source.extra_servings,
      created_by_user_id: req.user?.id || null,
      diners: { create: source.diners.map(({ user_id, diner_id }) => (user_id ? { user_id } : { diner_id })) },
    },
    include: D.dishInclude,
  });
  res.status(201).json({ success: true, dish: D.serializeDish(dish) });
}));

// Copia todos los platos de una semana a otra (se añaden; no borra nada).
router.post("/home/:home_id/copy-week", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const from = D.weekStartOf(requireIsoDate(req.body?.from, "La semana de origen"));
  const to = D.weekStartOf(requireIsoDate(req.body?.to, "La semana de destino"));
  if (from === to) fail("Elige una semana distinta");
  const offset = daysBetween(from, to);

  const sources = await prisma.plannedDish.findMany({
    where: { home_id: home.id, date: { gte: D.isoToDbDate(from), lte: D.isoToDbDate(D.addDays(from, 6)) } },
    orderBy: [{ date: "asc" }, { position: "asc" }],
    include: { diners: { select: { user_id: true, diner_id: true } }, mealType: { select: { deleted_at: true } } },
  });
  const copyable = sources.filter((dish) => !dish.mealType.deleted_at);
  if (!copyable.length) fail("La semana de origen no tiene platos");

  const created = await prisma.$transaction(async (tx) => {
    const idMap = new Map();
    for (const dish of copyable) {
      const newDish = await tx.plannedDish.create({
        data: {
          home_id: home.id,
          date: D.isoToDbDate(D.addDays(D.dbDateToIso(dish.date), offset)),
          meal_type_id: dish.meal_type_id,
          position: dish.position,
          kind: dish.kind,
          title: dish.title,
          time: dish.time,
          notes: dish.notes,
          recipe_id: dish.recipe_id,
          recipe_snapshot: dish.recipe_id ? undefined : dish.recipe_snapshot ?? undefined,
          guests: dish.guests,
          extra_servings: dish.extra_servings,
          created_by_user_id: req.user?.id || null,
          diners: { create: dish.diners.map(({ user_id, diner_id }) => (user_id ? { user_id } : { diner_id })) },
        },
        select: { id: true },
      });
      idMap.set(dish.id, newDish.id);
    }
    for (const dish of copyable) {
      if (dish.leftover_of_id && idMap.has(dish.leftover_of_id)) {
        await tx.plannedDish.update({
          where: { id: idMap.get(dish.id) },
          data: { leftover_of_id: idMap.get(dish.leftover_of_id) },
        });
      }
    }
    return idMap.size;
  });

  res.json({ success: true, copied: created, week_start: to });
}));

// ---------------------------------------------------------------------------
// Tipos de comida
// ---------------------------------------------------------------------------
router.post("/home/:home_id/meal-types", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const name = P.cleanText(req.body?.name, 40) || fail("Escribe el nombre del tipo de comida");
  const time = req.body?.default_time ? String(req.body.default_time) : null;
  if (time && !P.isValidTime(time)) fail("La hora debe tener formato HH:MM");
  const count = await prisma.mealType.count({ where: { home_id: home.id, deleted_at: null } });
  if (count >= MAX_MEAL_TYPES) fail(`Puedes tener como máximo ${MAX_MEAL_TYPES} tipos de comida`);
  const last = await prisma.mealType.findFirst({
    where: { home_id: home.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const mealType = await prisma.mealType.create({
    data: { home_id: home.id, name, default_time: time, position: (last?.position ?? -1) + 1 },
    select: D.mealTypeSelect,
  });
  res.status(201).json({ success: true, meal_type: mealType });
}));

router.patch("/meal-types/:id", handle(async (req, res) => {
  const row = await requireOwned(req, "mealType", req.params.id, { deleted_at: true });
  if (row.deleted_at) fail("Ese tipo de comida se ha eliminado", 404);
  const data = {};
  if (req.body?.name !== undefined) data.name = P.cleanText(req.body.name, 40) || fail("El nombre no puede estar vacío");
  if (req.body?.default_time !== undefined) {
    const time = req.body.default_time ? String(req.body.default_time) : null;
    if (time && !P.isValidTime(time)) fail("La hora debe tener formato HH:MM");
    data.default_time = time;
  }
  if (req.body?.active !== undefined) data.active = Boolean(req.body.active);
  const mealType = await prisma.mealType.update({ where: { id: row.id }, data, select: D.mealTypeSelect });
  res.json({ success: true, meal_type: mealType });
}));

// Si tiene platos no se borra: se oculta y los platos se conservan.
router.delete("/meal-types/:id", handle(async (req, res) => {
  const row = await requireOwned(req, "mealType", req.params.id);
  const dishes = await prisma.plannedDish.count({ where: { meal_type_id: row.id } });
  if (dishes > 0) {
    await prisma.mealType.update({ where: { id: row.id }, data: { deleted_at: new Date(), active: false } });
    return res.json({ success: true, hidden: true, message: "Se ha quitado. Sus platos anteriores se conservan." });
  }
  await prisma.mealType.delete({ where: { id: row.id } });
  res.json({ success: true, hidden: false });
}));

router.put("/home/:home_id/meal-types/order", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : fail("Faltan los tipos de comida");
  const owned = await prisma.mealType.count({ where: { home_id: home.id, id: { in: ids } } });
  if (owned !== ids.length) fail("Algún tipo de comida no es de este hogar");
  await prisma.$transaction(ids.map((id, position) => prisma.mealType.update({ where: { id }, data: { position } })));
  res.json({ success: true, meal_types: await D.getMealTypes(home.id) });
}));

// ---------------------------------------------------------------------------
// Personas sin cuenta y grupos de invitados
// ---------------------------------------------------------------------------
const DINER_KINDS = ["HOUSEHOLD", "GUEST"];

const requireGroupId = async (homeId, groupId) => {
  if (!groupId) return null;
  const group = await prisma.dinerGroup.findFirst({ where: { id: String(groupId), home_id: homeId }, select: { id: true } });
  return group ? group.id : fail("El grupo no existe en este hogar");
};

router.post("/home/:home_id/diners", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const name = P.cleanText(req.body?.name, 60) || fail("Escribe el nombre");
  const kind = DINER_KINDS.includes(req.body?.kind) ? req.body.kind : "HOUSEHOLD";
  const [limits, count] = await Promise.all([
    getHomeLimits(home.id),
    prisma.diner.count({ where: { home_id: home.id } }),
  ]);
  if (count >= limits.maxDiners) {
    fail(`Tu plan permite como máximo ${limits.maxDiners} personas sin cuenta`, 403);
  }
  const groupId = kind === "GUEST" ? await requireGroupId(home.id, req.body?.group_id) : null;
  const diner = await prisma.diner.create({
    data: { home_id: home.id, name, kind, group_id: groupId },
    select: { id: true, name: true, kind: true, group_id: true },
  });
  res.status(201).json({ success: true, diner });
}));

router.patch("/diners/:id", handle(async (req, res) => {
  const row = await requireOwned(req, "diner", req.params.id, { kind: true });
  const data = {};
  if (req.body?.name !== undefined) data.name = P.cleanText(req.body.name, 60) || fail("El nombre no puede estar vacío");
  if (req.body?.kind !== undefined) {
    if (!DINER_KINDS.includes(req.body.kind)) fail("Tipo de persona no válido");
    data.kind = req.body.kind;
    if (req.body.kind === "HOUSEHOLD") data.group_id = null;
  }
  if (req.body?.group_id !== undefined && (data.kind || row.kind) === "GUEST") {
    data.group_id = await requireGroupId(row.home_id, req.body.group_id);
  }
  const diner = await prisma.diner.update({
    where: { id: row.id },
    data,
    select: { id: true, name: true, kind: true, group_id: true },
  });
  res.json({ success: true, diner });
}));

router.delete("/diners/:id", handle(async (req, res) => {
  const row = await requireOwned(req, "diner", req.params.id);
  await prisma.diner.delete({ where: { id: row.id } });
  res.json({ success: true });
}));

const setGroupMembers = async (tx, homeId, groupId, dinerIds) => {
  const ids = [...new Set(dinerIds.map(String))];
  const owned = await tx.diner.count({ where: { home_id: homeId, id: { in: ids } } });
  if (owned !== ids.length) fail("Alguna persona no es de este hogar");
  await tx.diner.updateMany({ where: { group_id: groupId, id: { notIn: ids } }, data: { group_id: null } });
  if (ids.length) {
    await tx.diner.updateMany({ where: { id: { in: ids } }, data: { group_id: groupId, kind: "GUEST" } });
  }
};

router.post("/home/:home_id/groups", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const name = P.cleanText(req.body?.name, 60) || fail("Escribe el nombre del grupo");
  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.dinerGroup.create({ data: { home_id: home.id, name }, select: { id: true, name: true } });
    if (Array.isArray(req.body?.diner_ids)) await setGroupMembers(tx, home.id, created.id, req.body.diner_ids);
    return created;
  });
  res.status(201).json({ success: true, group });
}));

router.patch("/groups/:id", handle(async (req, res) => {
  const row = await requireOwned(req, "dinerGroup", req.params.id);
  const group = await prisma.$transaction(async (tx) => {
    const data = {};
    if (req.body?.name !== undefined) data.name = P.cleanText(req.body.name, 60) || fail("El nombre no puede estar vacío");
    const updated = await tx.dinerGroup.update({ where: { id: row.id }, data, select: { id: true, name: true } });
    if (Array.isArray(req.body?.diner_ids)) await setGroupMembers(tx, row.home_id, row.id, req.body.diner_ids);
    return updated;
  });
  res.json({ success: true, group });
}));

router.delete("/groups/:id", handle(async (req, res) => {
  const row = await requireOwned(req, "dinerGroup", req.params.id);
  await prisma.dinerGroup.delete({ where: { id: row.id } });
  res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// Recetas
// ---------------------------------------------------------------------------
const recipeFullSelect = {
  id: true,
  home_id: true,
  name: true,
  servings: true,
  prep_minutes: true,
  difficulty: true,
  tags: true,
  steps: true,
  notes: true,
  source: true,
  favorite: true,
  createdAt: true,
  updatedAt: true,
  ingredients: {
    orderBy: { position: "asc" },
    select: {
      id: true, name: true, quantity: true, unit: true, pantry: true, item_id: true, position: true,
      item: { select: { id: true, name: true } },
    },
  },
};

const validateItemIds = async (homeId, ingredients) => {
  const ids = [...new Set(ingredients.map((ingredient) => ingredient.item_id).filter(Boolean))];
  if (!ids.length) return;
  const items = await prisma.item.findMany({ where: { home_id: homeId, id: { in: ids } }, select: { id: true } });
  const valid = new Set(items.map((item) => item.id));
  for (const ingredient of ingredients) {
    if (ingredient.item_id && !valid.has(ingredient.item_id)) ingredient.item_id = null;
  }
};

const ingredientCreateData = (ingredients) =>
  ingredients.map(({ position, name, quantity, unit, pantry, item_id }) => ({
    position, name, quantity, unit, pantry, item_id,
  }));

const recipeData = (recipe) => ({
  name: recipe.name,
  servings: recipe.servings,
  prep_minutes: recipe.prep_minutes,
  difficulty: recipe.difficulty,
  tags: recipe.tags,
  steps: recipe.steps,
  notes: recipe.notes,
  source: recipe.source,
  favorite: recipe.favorite,
});

const ensureRecipeLimit = async (homeId, adding = 1) => {
  const [limits, count] = await Promise.all([
    getHomeLimits(homeId),
    prisma.recipe.count({ where: { home_id: homeId } }),
  ]);
  if (count + adding > limits.maxRecipes) {
    fail(`Tu plan permite guardar como máximo ${limits.maxRecipes} recetas`, 403);
  }
};

router.get("/home/:home_id/recipes", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const recipes = await prisma.recipe.findMany({
    where: { home_id: home.id },
    orderBy: [{ favorite: "desc" }, { name: "asc" }],
    select: {
      id: true, name: true, servings: true, prep_minutes: true, difficulty: true, tags: true, favorite: true,
      updatedAt: true,
      ingredients: { select: { name: true } },
      _count: { select: { dishes: true } },
    },
  });
  res.json({
    success: true,
    recipes: recipes.map(({ ingredients, _count, ...recipe }) => ({
      ...recipe,
      ingredient_names: ingredients.map((ingredient) => ingredient.name),
      times_planned: _count.dishes,
    })),
  });
}));

router.get("/recipes/:id", handle(async (req, res) => {
  await requireOwned(req, "recipe", req.params.id);
  const [recipe, history] = await Promise.all([
    prisma.recipe.findUnique({ where: { id: req.params.id }, select: recipeFullSelect }),
    prisma.plannedDish.findMany({
      where: { recipe_id: req.params.id },
      orderBy: { date: "desc" },
      take: 10,
      select: { id: true, date: true },
    }),
  ]);
  const timesPlanned = await prisma.plannedDish.count({ where: { recipe_id: req.params.id } });
  res.json({
    success: true,
    recipe,
    history: {
      times_planned: timesPlanned,
      last_dates: history.map((dish) => D.dbDateToIso(dish.date)),
    },
  });
}));

router.post("/home/:home_id/recipes", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const input = P.sanitizeRecipeInput(req.body || {});
  await ensureRecipeLimit(home.id);
  await validateItemIds(home.id, input.ingredients);
  const recipe = await prisma.recipe.create({
    data: {
      ...recipeData(input),
      home_id: home.id,
      created_by_user_id: req.user?.id || null,
      ingredients: { create: ingredientCreateData(input.ingredients) },
    },
    select: recipeFullSelect,
  });
  res.status(201).json({ success: true, recipe });
}));

// Editar: los platos ya pasados guardan una copia de cómo era la receta.
router.put("/recipes/:id", handle(async (req, res) => {
  const row = await requireOwned(req, "recipe", req.params.id);
  const input = P.sanitizeRecipeInput(req.body || {});
  await validateItemIds(row.home_id, input.ingredients);
  const today = D.isoToDbDate(D.todayIso());

  const recipe = await prisma.$transaction(async (tx) => {
    const current = await tx.recipe.findUnique({ where: { id: row.id }, select: recipeFullSelect });
    await tx.plannedDish.updateMany({
      where: { recipe_id: row.id, date: { lt: today }, recipe_snapshot: { equals: Prisma.DbNull } },
      data: { recipe_snapshot: D.recipeSnapshot(current) },
    });
    await tx.recipeIngredient.deleteMany({ where: { recipe_id: row.id } });
    await tx.plannedDish.updateMany({ where: { recipe_id: row.id, date: { gte: today } }, data: { title: input.name } });
    return tx.recipe.update({
      where: { id: row.id },
      data: { ...recipeData(input), ingredients: { create: ingredientCreateData(input.ingredients) } },
      select: recipeFullSelect,
    });
  });
  res.json({ success: true, recipe });
}));

router.patch("/recipes/:id/favorite", handle(async (req, res) => {
  const row = await requireOwned(req, "recipe", req.params.id);
  const recipe = await prisma.recipe.update({
    where: { id: row.id },
    data: { favorite: Boolean(req.body?.favorite) },
    select: { id: true, favorite: true },
  });
  res.json({ success: true, recipe });
}));

// Borrar: los platos que la usaban conservan una copia (nombre e ingredientes).
router.delete("/recipes/:id", handle(async (req, res) => {
  const row = await requireOwned(req, "recipe", req.params.id);
  await prisma.$transaction(async (tx) => {
    const current = await tx.recipe.findUnique({ where: { id: row.id }, select: recipeFullSelect });
    await tx.plannedDish.updateMany({
      where: { recipe_id: row.id, recipe_snapshot: { equals: Prisma.DbNull } },
      data: { recipe_snapshot: D.recipeSnapshot(current) },
    });
    await tx.recipe.delete({ where: { id: row.id } });
  });
  res.json({ success: true });
}));

const homeItems = (homeId) =>
  prisma.item.findMany({ where: { home_id: homeId }, select: { id: true, name: true, categories: true } });

router.post("/home/:home_id/recipes/import/preview", expensiveUserRateLimiter, handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const recipes = P.parseRecipeText(req.body?.text);
  const items = await homeItems(home.id);
  res.json({
    success: true,
    recipes: recipes.map((recipe) => ({
      ...recipe,
      ingredients: recipe.ingredients.map((ingredient) => {
        const match = P.matchProduct(ingredient.name, items);
        return {
          ...ingredient,
          item_id: match.item?.id || null,
          match: match.status,
          suggestion: match.suggestion ? { id: match.suggestion.id, name: match.suggestion.name } : null,
        };
      }),
    })),
  });
}));

router.post("/home/:home_id/recipes/import", expensiveUserRateLimiter, handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const raw = Array.isArray(req.body?.recipes) ? req.body.recipes : fail("No hay recetas para importar");
  if (!raw.length || raw.length > 20) fail("Importa entre 1 y 20 recetas cada vez");
  const inputs = raw.map((recipe) => P.sanitizeRecipeInput(recipe));
  await ensureRecipeLimit(home.id, inputs.length);
  for (const input of inputs) await validateItemIds(home.id, input.ingredients);

  const created = await prisma.$transaction(inputs.map((input) =>
    prisma.recipe.create({
      data: {
        ...recipeData(input),
        source: input.source || "ChatGPT",
        home_id: home.id,
        created_by_user_id: req.user?.id || null,
        ingredients: { create: ingredientCreateData(input.ingredients) },
      },
      select: { id: true, name: true },
    })
  ));
  res.status(201).json({ success: true, recipes: created });
}));

// ---------------------------------------------------------------------------
// Compra: vista previa y aplicar
// ---------------------------------------------------------------------------
const ingredientsOf = (dish) => (dish.recipe || dish.recipe_snapshot || null);

const buildEntries = (recipe, factor, items, itemsById, sourceName) =>
  (recipe?.ingredients || []).map((ingredient) => {
    let itemId = ingredient.item_id && itemsById.has(ingredient.item_id) ? ingredient.item_id : null;
    if (!itemId) {
      const match = P.matchProduct(ingredient.name, items);
      if (match.status === "found") itemId = match.item.id;
    }
    return {
      key: itemId ? `item:${itemId}` : `name:${P.nameKey(ingredient.name)}`,
      itemId,
      name: itemId ? itemsById.get(itemId).name : ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      pantry: ingredient.pantry,
      factor,
      source: sourceName,
      ingredientId: ingredient.id || null,
    };
  });

router.post("/home/:home_id/shopping/preview", handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const body = req.body || {};
  const [items, people, lists] = await Promise.all([
    homeItems(home.id),
    D.getHomePeople(home.id),
    prisma.list.findMany({
      where: { home_id: home.id },
      orderBy: [{ fav: "desc" }, { updatedAt: "desc" }],
      take: 40,
      select: {
        id: true, title: true, fav: true, listCheck: true,
        itemsList: { where: { status: "PENDING" }, select: { id: true } },
      },
    }),
  ]);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const householdSize = D.householdSizeOf(people);

  let entries = [];
  let included = [];
  let alreadyAdded = [];

  if (body.recipe_id) {
    const recipe = await prisma.recipe.findFirst({
      where: { id: String(body.recipe_id), home_id: home.id },
      select: recipeFullSelect,
    });
    if (!recipe) fail("La receta no existe", 404);
    const servings = P.clampInt(body.servings, 1, 200, recipe.servings);
    entries = buildEntries(recipe, servings / recipe.servings, items, itemsById, recipe.name);
  } else {
    const start = requireIsoDate(body.start, "La fecha de inicio");
    const end = requireIsoDate(body.end || body.start, "La fecha de fin");
    if (end < start || daysBetween(start, end) > MAX_RANGE_DAYS) fail(`Elige un periodo de como máximo ${MAX_RANGE_DAYS} días`);
    const dishIds = Array.isArray(body.dish_ids) ? body.dish_ids.map(String) : null;

    const dishes = await prisma.plannedDish.findMany({
      where: {
        home_id: home.id,
        kind: "RECIPE",
        date: { gte: D.isoToDbDate(start), lte: D.isoToDbDate(end) },
        ...(dishIds ? { id: { in: dishIds } } : {}),
      },
      orderBy: [{ date: "asc" }, { position: "asc" }],
      include: D.dishInclude,
    });

    for (const dish of dishes) {
      const summary = { id: dish.id, title: dish.title, date: D.dbDateToIso(dish.date), added_to_list_at: dish.added_to_list_at };
      if (dish.added_to_list_at && !body.include_added) {
        alreadyAdded.push(summary);
        continue;
      }
      const recipe = ingredientsOf(dish);
      if (!recipe?.ingredients?.length || !recipe.servings) continue;
      const servings = P.dishServings({
        dinerCount: dish.diners.length,
        guests: dish.guests,
        extraServings: dish.extra_servings,
        householdSize,
      });
      included.push({ ...summary, servings });
      entries = entries.concat(buildEntries(recipe, servings / recipe.servings, items, itemsById, dish.title));
    }
  }

  let pendingByItem = new Map();
  const targetList = body.list_id ? lists.find((list) => list.id === body.list_id) : null;
  if (targetList) {
    const pending = await prisma.itemList.findMany({
      where: { list_id: targetList.id, status: "PENDING" },
      select: { item_id: true, quantity: true, purchased_quantity: true },
    });
    pendingByItem = new Map(
      pending
        .filter((row) => row.purchased_quantity < row.quantity)
        .map((row) => [row.item_id, row.quantity - row.purchased_quantity])
    );
  }

  const order = { similar: 0, new: 1, found: 2 };
  const lines = P.aggregateShopping(entries)
    .map((line) => {
      const match = line.item_id
        ? { status: "found", suggestion: null }
        : P.matchProduct(line.name, items);
      return {
        ...line,
        status: line.item_id ? "found" : match.status === "found" ? "found" : match.status,
        item_id: line.item_id || (match.status === "found" ? match.item.id : null),
        suggestion: match.suggestion ? { id: match.suggestion.id, name: match.suggestion.name } : null,
        in_list: line.item_id && pendingByItem.has(line.item_id) ? pendingByItem.get(line.item_id) : 0,
      };
    })
    .sort((a, b) =>
      Number(a.pantry) - Number(b.pantry) ||
      order[a.status] - order[b.status] ||
      a.name.localeCompare(b.name, "es")
    );

  res.json({
    success: true,
    lines,
    dishes_included: included,
    dishes_already_added: alreadyAdded,
    lists: lists.map((list) => ({
      id: list.id, title: list.title, fav: list.fav, done: list.listCheck, pending: list.itemsList.length,
    })),
  });
}));

router.post("/home/:home_id/shopping/apply", expensiveUserRateLimiter, handle(async (req, res) => {
  const home = await requireHome(req, req.params.home_id);
  const body = req.body || {};
  const rawLines = Array.isArray(body.lines) ? body.lines : fail("No hay productos que añadir");
  if (!rawLines.length) fail("Selecciona al menos un producto");
  if (rawLines.length > 300) fail("Demasiados productos de una vez");

  const lines = rawLines.map((line) => {
    const quantity = P.clampInt(line?.quantity, 1, 999, 1);
    const detail = P.cleanText(line?.detail, 120);
    const ingredientIds = Array.isArray(line?.ingredient_ids) ? line.ingredient_ids.map(String).slice(0, 100) : [];
    if (line?.item_id) return { itemId: String(line.item_id), quantity, detail, ingredientIds };
    const name = P.cleanText(line?.create?.name, 120) || fail("Falta el nombre de un producto nuevo");
    const category = CATEGORY_VALUES.has(line?.create?.category) ? line.create.category : null;
    return { create: { name, category }, quantity, detail, ingredientIds };
  });
  const dishIds = Array.isArray(body.dish_ids) ? [...new Set(body.dish_ids.map(String))] : [];
  const listTitle = P.cleanText(body.new_list_title, 80);
  if (!body.list_id && !listTitle) fail("Elige una lista o escribe el nombre de una nueva");

  const result = await shoppingTransaction(async (tx) => {
    let list;
    if (body.list_id) {
      list = await tx.list.findFirst({ where: { id: String(body.list_id), home_id: home.id }, select: { id: true } });
      if (!list) fail("La lista no es de este hogar");
    } else {
      list = await tx.list.create({ data: { title: listTitle, home_id: home.id }, select: { id: true } });
    }

    if (dishIds.length) {
      const dishes = await tx.plannedDish.findMany({
        where: { id: { in: dishIds }, home_id: home.id },
        select: { id: true, added_to_list_at: true },
      });
      if (dishes.length !== dishIds.length) fail("Algún plato no es de este hogar");
      if (!body.include_added && dishes.some((dish) => dish.added_to_list_at)) {
        fail("Algunos platos ya se añadieron a la compra. Vuelve a abrir la revisión.", 409);
      }
    }

    const items = await tx.item.findMany({ where: { home_id: home.id }, select: { id: true, name: true } });
    const byKey = new Map(items.map((item) => [P.nameKey(item.name), item]));
    const validIds = new Set(items.map((item) => item.id));
    let createdItems = 0;

    const perItem = new Map();
    const links = [];
    for (const line of lines) {
      let itemId = line.itemId;
      if (itemId && !validIds.has(itemId)) fail("Algún producto no es de este hogar");
      if (!itemId) {
        const key = P.nameKey(line.create.name);
        let item = byKey.get(key);
        if (!item) {
          item = await tx.item.create({
            data: {
              home_id: home.id,
              name: line.create.name,
              description: "",
              price: "",
              categories: line.create.category ? [line.create.category] : [],
              supermarket: "CUALQUIERA",
              is_recurring: false,
            },
            select: { id: true, name: true },
          });
          byKey.set(key, item);
          validIds.add(item.id);
          createdItems += 1;
        }
        itemId = item.id;
      }
      const current = perItem.get(itemId) || { quantity: 0, details: [] };
      current.quantity += line.quantity;
      if (line.detail) current.details.push(line.detail);
      perItem.set(itemId, current);
      if (line.ingredientIds.length) links.push({ itemId, ingredientIds: line.ingredientIds });
    }

    let addedLines = 0;
    for (const [itemId, { quantity, details }] of perItem) {
      const detail = details.join(" + ").slice(0, 200) || null;
      const pending = await tx.itemList.findMany({
        where: { item_id: itemId, list_id: list.id, status: "PENDING" },
        select: { id: true, quantity: true, purchased_quantity: true, detail: true },
      });
      const existing = pending.find((row) => row.purchased_quantity < row.quantity);
      if (existing) {
        await tx.itemList.update({
          where: { id: existing.id },
          data: {
            quantity: { increment: quantity },
            detail: [existing.detail, detail].filter(Boolean).join(" + ").slice(0, 200) || null,
          },
        });
      } else {
        await tx.itemList.create({
          data: { item_id: itemId, list_id: list.id, quantity, purchased_quantity: 0, status: "PENDING", detail },
        });
      }
      addedLines += 1;
    }

    // Recuerda qué producto se eligió para cada ingrediente.
    for (const { itemId, ingredientIds } of links) {
      await tx.recipeIngredient.updateMany({
        where: { id: { in: ingredientIds }, recipe: { home_id: home.id } },
        data: { item_id: itemId },
      });
    }

    if (dishIds.length) {
      await tx.plannedDish.updateMany({
        where: { id: { in: dishIds }, home_id: home.id },
        data: { added_to_list_at: new Date(), added_to_list_id: list.id },
      });
    }

    return { listId: list.id, createdItems, addedLines };
  });

  req.app.get("io")?.to(`list:${result.listId}`).emit("list:changed", { list_id: result.listId });
  res.json({
    success: true,
    list_id: result.listId,
    created_items: result.createdItems,
    added_lines: result.addedLines,
  });
}));

module.exports = router;
