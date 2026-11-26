// Acceso a datos del módulo de menús (v2): preparación de cada hogar,
// consultas compartidas y formato de respuesta.
const { DateTime } = require("luxon");
const prisma = require("../prisma/prisma");

const MENU_ZONE = "Europe/Madrid";

const DEFAULT_MEAL_TYPES = [
  { name: "Desayuno", default_time: "08:30", position: 0, legacy_type: null },
  { name: "Comida", default_time: "14:00", position: 1, legacy_type: "COMIDA" },
  { name: "Merienda", default_time: "17:30", position: 2, legacy_type: null },
  { name: "Cena", default_time: "21:00", position: 3, legacy_type: "CENA" },
];

const isoToDbDate = (iso) => new Date(`${iso}T00:00:00.000Z`);
const dbDateToIso = (date) => DateTime.fromJSDate(date, { zone: "utc" }).toISODate();
const todayIso = () => DateTime.now().setZone(MENU_ZONE).toISODate();
const weekStartOf = (iso) =>
  DateTime.fromISO(iso, { zone: "utc" }).startOf("week").toISODate();
const addDays = (iso, days) =>
  DateTime.fromISO(iso, { zone: "utc" }).plus({ days }).toISODate();

// Primera vez que un hogar abre el menú v2: crea los tipos de comida por
// defecto y COPIA (sin borrar nada) el contenido de MenuMeal a PlannedDish.
const ensureMenuSetup = async (homeId) => {
  const home = await prisma.home.findUnique({
    where: { id: homeId },
    select: { menu_v2_ready_at: true },
  });
  if (!home || home.menu_v2_ready_at) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`menu-setup:${homeId}`}))`;
    const fresh = await tx.home.findUnique({
      where: { id: homeId },
      select: { menu_v2_ready_at: true },
    });
    if (!fresh || fresh.menu_v2_ready_at) return;

    let types = await tx.mealType.findMany({ where: { home_id: homeId } });
    if (!types.length) {
      await tx.mealType.createMany({
        data: DEFAULT_MEAL_TYPES.map((type) => ({ ...type, home_id: homeId })),
      });
      types = await tx.mealType.findMany({ where: { home_id: homeId } });
    }
    const byLegacy = Object.fromEntries(
      types.filter((type) => type.legacy_type).map((type) => [type.legacy_type, type.id])
    );

    const legacyMeals = await tx.menuMeal.findMany({
      where: { weeklyMenu: { home_id: homeId } },
      select: {
        id: true,
        day_date: true,
        type: true,
        title: true,
        notes: true,
        weeklyMenu: { select: { created_by_user_id: true } },
      },
    });
    const data = legacyMeals
      .filter((meal) => (meal.title || meal.notes) && byLegacy[meal.type])
      .map((meal) => ({
        home_id: homeId,
        date: meal.day_date,
        meal_type_id: byLegacy[meal.type],
        kind: "FREE",
        title: meal.title || "Sin título",
        notes: meal.notes || null,
        legacy_menu_meal_id: meal.id,
        created_by_user_id: meal.weeklyMenu?.created_by_user_id || null,
      }));
    if (data.length) {
      await tx.plannedDish.createMany({ data, skipDuplicates: true });
    }

    await tx.home.update({
      where: { id: homeId },
      data: { menu_v2_ready_at: new Date() },
    });
  });
};

const mealTypeSelect = {
  id: true,
  name: true,
  default_time: true,
  position: true,
  active: true,
  legacy_type: true,
};

const getMealTypes = (homeId, { includeDeleted = false } = {}) =>
  prisma.mealType.findMany({
    where: { home_id: homeId, ...(includeDeleted ? {} : { deleted_at: null }) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { ...mealTypeSelect, deleted_at: true },
  });

// Personas del hogar: miembros con cuenta + personas sin cuenta del hogar.
const getHomePeople = async (homeId) => {
  const [members, diners, groups] = await Promise.all([
    prisma.member.findMany({
      where: { home_id: homeId },
      select: { user: { select: { id: true, name: true, email: true, image: true } } },
    }),
    prisma.diner.findMany({
      where: { home_id: homeId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, kind: true, group_id: true },
    }),
    prisma.dinerGroup.findMany({
      where: { home_id: homeId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, diners: { select: { id: true } } },
    }),
  ]);

  return {
    members: members
      .filter((member) => member.user)
      .map(({ user }) => ({
        id: user.id,
        name: user.name || (user.email ? user.email.split("@")[0] : "Miembro"),
        image: user.image || null,
      })),
    diners,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      diner_ids: group.diners.map((diner) => diner.id),
    })),
  };
};

const householdSizeOf = (people) =>
  people.members.length + people.diners.filter((diner) => diner.kind === "HOUSEHOLD").length;

const dishInclude = {
  diners: { select: { user_id: true, diner_id: true } },
  recipe: {
    select: {
      id: true,
      name: true,
      servings: true,
      prep_minutes: true,
      ingredients: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, quantity: true, unit: true, pantry: true, item_id: true },
      },
    },
  },
  leftoverOf: { select: { id: true, title: true, date: true } },
};

const serializeDish = (dish) => {
  const recipe = dish.recipe || dish.recipe_snapshot || null;
  return {
    id: dish.id,
    date: dbDateToIso(dish.date),
    meal_type_id: dish.meal_type_id,
    position: dish.position,
    kind: dish.kind,
    title: dish.title,
    time: dish.time,
    notes: dish.notes,
    recipe_id: dish.recipe_id,
    recipe: recipe
      ? { id: recipe.id || null, name: recipe.name, servings: recipe.servings, prep_minutes: recipe.prep_minutes ?? null }
      : null,
    recipe_from_snapshot: !dish.recipe && Boolean(dish.recipe_snapshot),
    guests: dish.guests,
    extra_servings: dish.extra_servings,
    leftover_of: dish.leftoverOf
      ? { id: dish.leftoverOf.id, title: dish.leftoverOf.title, date: dbDateToIso(dish.leftoverOf.date) }
      : null,
    user_ids: (dish.diners || []).filter((row) => row.user_id).map((row) => row.user_id),
    diner_ids: (dish.diners || []).filter((row) => row.diner_id).map((row) => row.diner_id),
    added_to_list_at: dish.added_to_list_at,
    added_to_list_id: dish.added_to_list_id,
  };
};

const recipeSnapshot = (recipe) => ({
  id: recipe.id,
  name: recipe.name,
  servings: recipe.servings,
  prep_minutes: recipe.prep_minutes,
  steps: recipe.steps || [],
  ingredients: (recipe.ingredients || []).map((ingredient) => ({
    id: ingredient.id,
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    pantry: ingredient.pantry,
    item_id: ingredient.item_id,
  })),
  snapshot_at: new Date().toISOString(),
});

module.exports = {
  DEFAULT_MEAL_TYPES,
  MENU_ZONE,
  addDays,
  dbDateToIso,
  dishInclude,
  ensureMenuSetup,
  getHomePeople,
  getMealTypes,
  householdSizeOf,
  isoToDbDate,
  mealTypeSelect,
  recipeSnapshot,
  serializeDish,
  todayIso,
  weekStartOf,
};
