const crypto = require("crypto");
const express = require("express");
const { DateTime } = require("luxon");
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const { getAccessibleHome } = require("../utils/permissions");
const menuData = require("../utils/menuData");
const {
  expensiveUserRateLimiter,
  publicMenuRateLimiter,
} = require("../middleware/rateLimit");

const router = express.Router();

const MENU_ZONE = "Europe/Madrid";
const MENU_WINDOW_WEEKS = 4;
const MENU_MEAL_TYPES = ["COMIDA", "CENA"];
const DAY_NAMES = [
  "LUNES",
  "MARTES",
  "MIERCOLES",
  "JUEVES",
  "VIERNES",
  "SABADO",
  "DOMINGO",
];
const EMPTY_VALUES = new Set([
  "",
  "-",
  "NO HAY DATOS",
  "SIN DATOS",
  "VACIO",
  "VACÍA",
  "NADA",
]);

const normalizeTextKey = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");

const dateOnlyToDate = (dateIso) => new Date(`${dateIso}T00:00:00.000Z`);

const dbDateToIso = (date) =>
  DateTime.fromJSDate(date, { zone: "utc" }).toISODate();

const getCurrentWeekStart = () =>
  DateTime.now().setZone(MENU_ZONE).startOf("week").startOf("day");

const getWeekStart = (dateTime) => dateTime.startOf("week").startOf("day");

const getAllowedWindow = () => {
  const firstWeekStart = getCurrentWeekStart();
  const weekStarts = Array.from({ length: MENU_WINDOW_WEEKS }, (_, index) =>
    firstWeekStart.plus({ weeks: index }).toISODate()
  );

  return {
    firstWeekStart,
    lastAllowedDate: firstWeekStart
      .plus({ weeks: MENU_WINDOW_WEEKS })
      .minus({ days: 1 }),
    weekStarts,
  };
};

const parseIsoDate = (rawDate) => {
  const date = DateTime.fromISO(String(rawDate || "").trim(), {
    zone: MENU_ZONE,
  }).startOf("day");

  return date.isValid ? date : null;
};

const isAllowedDay = (date) => {
  const { firstWeekStart, lastAllowedDate } = getAllowedWindow();
  return date >= firstWeekStart && date <= lastAllowedDate;
};

const isAllowedWeekStart = (weekStartIso) =>
  getAllowedWindow().weekStarts.includes(weekStartIso);

const getEmptyMeal = () => ({ title: null, notes: null });

const getEmptyDay = (date, keys = MENU_MEAL_TYPES) => ({
  date: date.toISODate(),
  meals: Object.fromEntries(keys.map((key) => [key, getEmptyMeal()])),
});

const cleanMenuValue = (value = "") => {
  const cleanedValue = String(value).trim();
  return EMPTY_VALUES.has(normalizeTextKey(cleanedValue)) ? null : cleanedValue;
};

const parseHeaderLine = (line) => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) return null;

  const key = normalizeTextKey(line.slice(0, separatorIndex));
  if (!["SEMANA", "DIA"].includes(key)) return null;

  const dateMatch = line.slice(separatorIndex + 1).match(/\d{4}-\d{2}-\d{2}/);
  if (!dateMatch) {
    throw new Error(`${key} debe tener formato YYYY-MM-DD`);
  }

  return {
    mode: key === "SEMANA" ? "week" : "day",
    dateIso: dateMatch[0],
  };
};

const getDayIndexFromLine = (line) => {
  const normalizedLine = normalizeTextKey(line).replace(/:$/, "");
  return DAY_NAMES.findIndex((dayName) => normalizedLine === dayName);
};

const parseKeyValueLine = (line) => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) return null;

  return {
    key: normalizeTextKey(line.slice(0, separatorIndex)),
    value: line.slice(separatorIndex + 1).trim(),
  };
};

const parseMealValue = (value) => {
  const parts = String(value || "")
    .split("|")
    .map((part) => part.trim());
  const title = cleanMenuValue(parts.shift() || "");
  let notes = null;

  parts.forEach((part) => {
    const parsedPart = parseKeyValueLine(part);
    if (!parsedPart) return;

    if (parsedPart.key === "NOTAS" || parsedPart.key.startsWith("NOTAS ")) {
      notes = cleanMenuValue(parsedPart.value);
    }
  });

  return { title, notes };
};

// extraKeys: nombres normalizados de otros tipos de comida del hogar
// (DESAYUNO, MERIENDA...). COMIDA y CENA siempre se reconocen.
const parseMenuImportText = (text, extraKeys = []) => {
  const mealKeys = [...new Set([...MENU_MEAL_TYPES, ...extraKeys])];
  const mentioned = new Set();
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const headers = lines
    .map((line, index) => {
      const header = parseHeaderLine(line);
      return header ? { ...header, index } : null;
    })
    .filter(Boolean);

  if (headers.length === 0) {
    throw new Error("Incluye una cabecera SEMANA: YYYY-MM-DD o DIA: YYYY-MM-DD");
  }

  if (headers.length > 1) {
    throw new Error("Importa solo una semana o un día cada vez");
  }

  const header = headers[0];
  const headerDate = parseIsoDate(header.dateIso);
  if (!headerDate) {
    throw new Error("La fecha no es válida");
  }

  if (header.mode === "day" && !isAllowedDay(headerDate)) {
    throw new Error("Solo puedes importar días de las próximas 4 semanas");
  }

  const weekStart = getWeekStart(headerDate);
  const weekStartIso = weekStart.toISODate();
  if (!isAllowedWeekStart(weekStartIso)) {
    throw new Error("Solo puedes importar menús de las próximas 4 semanas");
  }

  const days =
    header.mode === "week"
      ? Array.from({ length: 7 }, (_, index) =>
          getEmptyDay(weekStart.plus({ days: index }), mealKeys)
        )
      : [getEmptyDay(headerDate, mealKeys)];
  const daysByIso = new Map(days.map((day) => [day.date, day]));
  let currentDay =
    header.mode === "day" ? daysByIso.get(headerDate.toISODate()) : null;

  lines.slice(header.index + 1).forEach((line) => {
    if (!line) return;

    if (header.mode === "week") {
      const dayIndex = getDayIndexFromLine(line);
      if (dayIndex !== -1) {
        currentDay = daysByIso.get(weekStart.plus({ days: dayIndex }).toISODate());
        return;
      }
    }

    if (!currentDay) return;

    const parsedLine = parseKeyValueLine(line);
    if (!parsedLine) return;

    if (mealKeys.includes(parsedLine.key)) {
      mentioned.add(parsedLine.key);
      currentDay.meals[parsedLine.key] = {
        ...currentDay.meals[parsedLine.key],
        ...parseMealValue(parsedLine.value),
      };
      return;
    }

    const notesKey = parsedLine.key.startsWith("NOTAS ")
      ? parsedLine.key.slice(6)
      : null;
    if (notesKey && mealKeys.includes(notesKey)) {
      mentioned.add(notesKey);
      currentDay.meals[notesKey].notes = cleanMenuValue(parsedLine.value);
    }
  });

  return {
    mode: header.mode,
    requestedDate: header.dateIso,
    weekStart: weekStartIso,
    affectedDays: days.map((day) => day.date),
    mentionedKeys: [...mentioned],
    days,
  };
};

const buildWeekSkeleton = (weekStartIso) => {
  const weekStart = parseIsoDate(weekStartIso);
  return {
    weekStart: weekStartIso,
    days: Array.from({ length: 7 }, (_, index) =>
      getEmptyDay(weekStart.plus({ days: index }))
    ),
  };
};

// Respuesta antigua (COMIDA/CENA) construida desde los platos nuevos, para las
// versiones anteriores de la app y el enlace público antiguo.
const getMenuWeeksForHome = async (homeId) => {
  await menuData.ensureMenuSetup(homeId);
  const { weekStarts } = getAllowedWindow();
  const first = weekStarts[0];
  const last = DateTime.fromISO(weekStarts[weekStarts.length - 1]).plus({ days: 6 }).toISODate();
  const types = await prisma.mealType.findMany({
    where: { home_id: homeId, legacy_type: { not: null } },
    select: { id: true, legacy_type: true },
  });
  const legacyByTypeId = new Map(types.map((type) => [type.id, type.legacy_type]));
  const dishes = await prisma.plannedDish.findMany({
    where: {
      home_id: homeId,
      meal_type_id: { in: types.map((type) => type.id) },
      date: { gte: dateOnlyToDate(first), lte: dateOnlyToDate(last) },
    },
    orderBy: [{ date: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    select: { date: true, meal_type_id: true, title: true, notes: true },
  });

  const weeks = weekStarts.map(buildWeekSkeleton);
  const daysByIso = new Map(weeks.flatMap((week) => week.days).map((day) => [day.date, day]));
  dishes.forEach((dish) => {
    const day = daysByIso.get(dbDateToIso(dish.date));
    const type = legacyByTypeId.get(dish.meal_type_id);
    if (!day || !type) return;
    const meal = day.meals[type];
    meal.title = meal.title ? `${meal.title} / ${dish.title}` : dish.title;
    if (dish.notes && !meal.notes) meal.notes = dish.notes;
  });

  return weeks;
};

// Claves de importación de los tipos de comida del hogar (además de COMIDA/CENA).
const getImportKeys = async (homeId) => {
  await menuData.ensureMenuSetup(homeId);
  const types = await prisma.mealType.findMany({
    where: { home_id: homeId, deleted_at: null, legacy_type: null },
    select: { name: true },
  });
  return types.map((type) => normalizeTextKey(type.name)).filter(Boolean);
};

// Sustituye los platos de los días importados. Solo toca COMIDA, CENA y los
// tipos que aparecen en el texto; el resto de comidas de esos días se conserva.
const applyMenuImport = async ({ homeId, userId, parsedMenu }) => {
  await menuData.ensureMenuSetup(homeId);
  const types = await prisma.mealType.findMany({
    where: { home_id: homeId, deleted_at: null },
    select: { id: true, name: true, legacy_type: true },
  });
  const typeIdByKey = new Map();
  types.forEach((type) => {
    if (type.legacy_type) typeIdByKey.set(type.legacy_type, type.id);
  });
  types.forEach((type) => {
    const key = normalizeTextKey(type.name);
    if (!typeIdByKey.has(key)) typeIdByKey.set(key, type.id);
  });

  const keys = [...new Set([...MENU_MEAL_TYPES, ...(parsedMenu.mentionedKeys || [])])]
    .filter((key) => typeIdByKey.has(key));
  const typeIds = keys.map((key) => typeIdByKey.get(key));

  return prisma.$transaction(async (tx) => {
    await tx.plannedDish.deleteMany({
      where: {
        home_id: homeId,
        meal_type_id: { in: typeIds },
        date: { in: parsedMenu.affectedDays.map(dateOnlyToDate) },
      },
    });
    const data = parsedMenu.days.flatMap((day) =>
      keys
        .map((key) => ({ key, meal: day.meals[key] }))
        .filter(({ meal }) => meal && (meal.title || meal.notes))
        .map(({ key, meal }) => ({
          home_id: homeId,
          date: dateOnlyToDate(day.date),
          meal_type_id: typeIdByKey.get(key),
          kind: "FREE",
          title: meal.title || "Sin título",
          notes: meal.notes || null,
          created_by_user_id: userId || null,
        }))
    );
    if (data.length) await tx.plannedDish.createMany({ data });
    return { created: data.length };
  });
};

const hashPublicToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createPublicToken = () => crypto.randomBytes(32).toString("hex");

const ensurePublicTokenForHome = async (homeId) => {
  const existingPublicToken = await prisma.menuPublicToken.findFirst({
    where: {
      home_id: homeId,
      revokedAt: null,
      token: {
        not: null,
      },
    },
    select: {
      id: true,
      token: true,
    },
  });

  if (existingPublicToken?.token) return existingPublicToken;

  await prisma.menuPublicToken.updateMany({
    where: {
      home_id: homeId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  const token = createPublicToken();
  return prisma.menuPublicToken.create({
    data: {
      home_id: homeId,
      token,
      token_hash: hashPublicToken(token),
      name: "Enlace público",
    },
    select: {
      id: true,
      token: true,
    },
  });
};

const buildPublicTokenPayload = (publicToken) => ({
  success: true,
  token: publicToken.token,
  token_id: publicToken.id,
  public_path: `/menu-publico/${publicToken.token}`,
});

router.get("/public/:token", publicMenuRateLimiter, async (req, res) => {
  const { token } = req.params;

  try {
    if (!token) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const publicToken = await prisma.menuPublicToken.findFirst({
      where: {
        OR: [{ token }, { token_hash: hashPublicToken(token) }],
        revokedAt: null,
      },
      select: {
        home: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!publicToken?.home) {
      return res.status(404).json({ message: "Menú no encontrado" });
    }

    return res.json({
      success: true,
      home: publicToken.home,
      weeks: await getMenuWeeksForHome(publicToken.home.id),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.use(authMiddleware);

router.get("/home/:home_id", async (req, res) => {
  const { home_id } = req.params;

  try {
    const home = await getAccessibleHome(req.user?.id, home_id, {
      select: {
        id: true,
        name: true,
      },
    });

    if (!home) {
      return res.status(403).json({
        message: "No tienes permisos para consultar este hogar",
      });
    }

    return res.json({
      success: true,
      home,
      weeks: await getMenuWeeksForHome(home_id),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/import/preview", expensiveUserRateLimiter, async (req, res) => {
  const { home_id, text } = req.body;

  try {
    const home = await getAccessibleHome(req.user?.id, home_id);
    if (!home) {
      return res.status(403).json({
        message: "No tienes permisos para importar menús en este hogar",
      });
    }

    const parsedMenu = parseMenuImportText(text, await getImportKeys(home_id));

    return res.json({
      success: true,
      parsedMenu,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "No se ha podido interpretar el menú",
    });
  }
});

router.post("/import", expensiveUserRateLimiter, async (req, res) => {
  const { home_id, text } = req.body;
  const userId = req.user?.id;

  try {
    const home = await getAccessibleHome(userId, home_id);
    if (!home) {
      return res.status(403).json({
        message: "No tienes permisos para importar menús en este hogar",
      });
    }

    const parsedMenu = parseMenuImportText(text, await getImportKeys(home_id));
    await applyMenuImport({ homeId: home_id, userId, parsedMenu });

    return res.json({
      success: true,
      message:
        parsedMenu.mode === "week"
          ? "Semana reemplazada correctamente"
          : "Día reemplazado correctamente",
      parsedMenu,
      weeks: await getMenuWeeksForHome(home_id),
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({
      success: false,
      message: error.message || "No se ha podido importar el menú",
    });
  }
});

router.get("/home/:home_id/public-token", async (req, res) => {
  const { home_id } = req.params;

  try {
    const home = await getAccessibleHome(req.user?.id, home_id, {
      select: {
        id: true,
      },
    });

    if (!home) {
      return res.status(403).json({
        message: "No tienes permisos para compartir este menú",
      });
    }

    const publicToken = await ensurePublicTokenForHome(home_id);
    return res.json(buildPublicTokenPayload(publicToken));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/home/:home_id/public-token", async (req, res) => {
  const { home_id } = req.params;

  try {
    const home = await getAccessibleHome(req.user?.id, home_id, {
      select: {
        id: true,
      },
    });

    if (!home) {
      return res.status(403).json({
        message: "No tienes permisos para compartir este menú",
      });
    }

    const publicToken = await ensurePublicTokenForHome(home_id);
    return res.json(buildPublicTokenPayload(publicToken));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
module.exports.parseMenuImportText = parseMenuImportText;
