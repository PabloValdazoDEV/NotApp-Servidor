// Lógica pura del módulo de menús y recetas (sin base de datos), para poder
// probarla de forma aislada: unidades, suma y redondeo de la compra, búsqueda
// de productos parecidos e interpretación de recetas pegadas desde ChatGPT.

const DISH_KINDS = ["RECIPE", "FREE", "LEFTOVER", "OUT"];

// family: cómo se suman y redondean.
//   mass/volume -> se pasa a g/ml, se suma y se redondea a envases estándar
//   unit/pack   -> se suma y se redondea hacia arriba
//   small       -> diente, cucharada... cuenta como 1 unidad del producto en total
//   taste       -> "al gusto": 1 unidad si no es de despensa
const UNITS = {
  G: { family: "mass", factor: 1, label: "g", plural: "g" },
  KG: { family: "mass", factor: 1000, label: "kg", plural: "kg" },
  ML: { family: "volume", factor: 1, label: "ml", plural: "ml" },
  L: { family: "volume", factor: 1000, label: "l", plural: "l" },
  UD: { family: "unit", label: "ud", plural: "ud" },
  LATA: { family: "pack", label: "lata", plural: "latas" },
  PAQUETE: { family: "pack", label: "paquete", plural: "paquetes" },
  BOTE: { family: "pack", label: "bote", plural: "botes" },
  SOBRE: { family: "pack", label: "sobre", plural: "sobres" },
  DIENTE: { family: "small", label: "diente", plural: "dientes" },
  CUCHARADA: { family: "small", label: "cucharada", plural: "cucharadas" },
  CUCHARADITA: { family: "small", label: "cucharadita", plural: "cucharaditas" },
  PIZCA: { family: "small", label: "pizca", plural: "pizcas" },
  RODAJA: { family: "small", label: "rodaja", plural: "rodajas" },
  HOJA: { family: "small", label: "hoja", plural: "hojas" },
  RAMA: { family: "small", label: "rama", plural: "ramas" },
  CHORRITO: { family: "small", label: "chorrito", plural: "chorritos" },
  PUNADO: { family: "small", label: "puñado", plural: "puñados" },
  AL_GUSTO: { family: "taste", label: "al gusto", plural: "al gusto" },
};

const UNIT_ALIASES = {
  g: "G", gr: "G", grs: "G", gramo: "G", gramos: "G",
  kg: "KG", kilo: "KG", kilos: "KG", kilogramo: "KG", kilogramos: "KG",
  ml: "ML", mililitro: "ML", mililitros: "ML",
  l: "L", lt: "L", litro: "L", litros: "L",
  ud: "UD", uds: "UD", u: "UD", unidad: "UD", unidades: "UD", pieza: "UD", piezas: "UD",
  lata: "LATA", latas: "LATA",
  paquete: "PAQUETE", paquetes: "PAQUETE",
  bote: "BOTE", botes: "BOTE",
  sobre: "SOBRE", sobres: "SOBRE",
  diente: "DIENTE", dientes: "DIENTE",
  cucharada: "CUCHARADA", cucharadas: "CUCHARADA", cda: "CUCHARADA", cdas: "CUCHARADA",
  cucharadita: "CUCHARADITA", cucharaditas: "CUCHARADITA", cdta: "CUCHARADITA", cdtas: "CUCHARADITA",
  pizca: "PIZCA", pizcas: "PIZCA",
  rodaja: "RODAJA", rodajas: "RODAJA",
  hoja: "HOJA", hojas: "HOJA",
  rama: "RAMA", ramas: "RAMA", ramita: "RAMA", ramitas: "RAMA",
  chorrito: "CHORRITO", chorritos: "CHORRITO", chorro: "CHORRITO",
  punado: "PUNADO", punados: "PUNADO",
  "al gusto": "AL_GUSTO", gusto: "AL_GUSTO",
};

const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "con", "para", "en", "al", "y", "o", "a", "sin"]);
const PANTRY_WORDS = new Set([
  "sal", "aceite", "pimienta", "agua", "vinagre", "oregano", "comino", "pimenton",
  "curry", "canela", "laurel", "especia", "especias", "tomillo", "romero", "azafran",
  "colorante", "cayena",
]);

const MAX_NAME = 120;
const MAX_TEXT = 2000;

const stripAccents = (value = "") =>
  String(value).normalize("NFD").replace(/[̀-ͯ]/g, "");

// Clave de comparación: sin tildes, minúsculas, sin signos y en singular.
const singularWord = (word) => {
  if (word.length > 4 && /[^aeiou]es$/.test(word) && /[lnrdzj]es$/.test(word)) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
};

const normalizeName = (value = "") =>
  stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const nameKey = (value = "") =>
  normalizeName(value)
    .split(" ")
    .filter(Boolean)
    .map(singularWord)
    .join(" ");

const significantWords = (value = "") =>
  nameKey(value)
    .split(" ")
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));

const isLikelyPantry = (name = "") =>
  nameKey(name)
    .split(" ")
    .some((word) => PANTRY_WORDS.has(word));

const normalizeUnit = (raw) => {
  if (raw === undefined || raw === null || raw === "") return "UD";
  const upper = String(raw).trim().toUpperCase();
  if (UNITS[upper]) return upper;
  const alias = UNIT_ALIASES[normalizeName(raw)];
  return alias || null;
};

const unitFamily = (unit) => UNITS[unit]?.family || "unit";

// ---------------------------------------------------------------------------
// Formato de números para mostrar (½, ¼, ¾ y coma decimal).
// ---------------------------------------------------------------------------
const formatAmount = (value) => {
  if (!Number.isFinite(value)) return "";
  const whole = Math.floor(value + 1e-9);
  const rest = value - whole;
  const quarter = Math.round(rest * 4) / 4;
  if (Math.abs(rest - quarter) < 0.02) {
    if (quarter === 0) return String(whole);
    if (quarter === 1) return String(whole + 1);
    const symbol = quarter === 0.25 ? "¼" : quarter === 0.5 ? "½" : "¾";
    return whole ? `${whole} ${symbol}` : symbol;
  }
  return (Math.round(value * 10) / 10).toString().replace(".", ",");
};

// Envases estándar: 250, 500, 750, 1000 y luego de 500 en 500.
const roundToPack = (value) => {
  if (!(value > 0)) return 0;
  if (value <= 250) return 250;
  if (value <= 500) return 500;
  if (value <= 750) return 750;
  if (value <= 1000) return 1000;
  return Math.ceil(value / 500) * 500;
};

const formatMetric = (value, small, big) =>
  value >= 1000
    ? `${(value / 1000).toString().replace(".", ",")} ${big}`
    : `${value} ${small}`;

const unitLabel = (unit, amount) => {
  const def = UNITS[unit] || UNITS.UD;
  return amount > 1 ? def.plural : def.label;
};

const describeIngredientAmount = (quantity, unit) => {
  if (unit === "AL_GUSTO" || quantity === null || quantity === undefined) {
    return "al gusto";
  }
  const family = unitFamily(unit);
  if (family === "mass" || family === "volume") {
    const base = quantity * (UNITS[unit]?.factor || 1);
    const rounded = Math.round(base / 5) * 5 || Math.round(base);
    return formatMetric(rounded, family === "mass" ? "g" : "ml", family === "mass" ? "kg" : "l");
  }
  return `${formatAmount(quantity)} ${unitLabel(unit, quantity)}`;
};

// ---------------------------------------------------------------------------
// Raciones de un plato.
// ---------------------------------------------------------------------------
const dishServings = ({ dinerCount = 0, guests = 0, extraServings = 0, householdSize = 1 }) => {
  const eaters = dinerCount > 0 ? dinerCount : guests > 0 ? 0 : Math.max(1, householdSize);
  return Math.max(1, eaters + Math.max(0, guests) + Math.max(0, extraServings));
};

// ---------------------------------------------------------------------------
// Compra: agrupa ingredientes escalados y los convierte en líneas de lista.
// entries: [{ key, itemId, name, quantity, unit, pantry, factor, source, ingredientId }]
// ---------------------------------------------------------------------------
const aggregateShopping = (entries = []) => {
  const groups = new Map();

  for (const entry of entries) {
    const unit = UNITS[entry.unit] ? entry.unit : "UD";
    const family = unitFamily(unit);
    const bucket = family === "small" || family === "taste" ? "little" : family;
    const groupKey = `${entry.key}|${bucket}`;
    const factor = Number.isFinite(entry.factor) && entry.factor > 0 ? entry.factor : 1;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: entry.key,
        itemId: entry.itemId || null,
        name: entry.name,
        bucket,
        total: 0,
        littleUnits: new Map(),
        pantry: true,
        sources: [],
        ingredientIds: [],
      });
    }
    const group = groups.get(groupKey);
    if (!group.itemId && entry.itemId) group.itemId = entry.itemId;
    group.pantry = group.pantry && Boolean(entry.pantry);
    if (entry.source && !group.sources.includes(entry.source)) group.sources.push(entry.source);
    if (entry.ingredientId && !group.ingredientIds.includes(entry.ingredientId)) {
      group.ingredientIds.push(entry.ingredientId);
    }

    const quantity = Number(entry.quantity);
    if (bucket === "little") {
      if (unit !== "AL_GUSTO" && Number.isFinite(quantity) && quantity > 0) {
        group.littleUnits.set(unit, (group.littleUnits.get(unit) || 0) + quantity * factor);
      } else if (!group.littleUnits.has("AL_GUSTO")) {
        group.littleUnits.set("AL_GUSTO", 0);
      }
    } else if (Number.isFinite(quantity) && quantity > 0) {
      group.total += quantity * factor * (UNITS[unit]?.factor || 1);
    }
  }

  return [...groups.values()].map((group) => {
    let quantity = 1;
    let detail = "";
    let needed = "";

    if (group.bucket === "mass" || group.bucket === "volume") {
      const isMass = group.bucket === "mass";
      const rounded = roundToPack(group.total);
      needed = formatMetric(Math.round(group.total), isMass ? "g" : "ml", isMass ? "kg" : "l");
      detail = rounded ? `≈${formatMetric(rounded, isMass ? "g" : "ml", isMass ? "kg" : "l")}` : "";
    } else if (group.bucket === "unit") {
      quantity = Math.max(1, Math.ceil(group.total - 1e-9));
      needed = `${formatAmount(group.total)} ud`;
      detail = Number.isInteger(Math.round(group.total * 1000) / 1000) ? "" : needed;
    } else if (group.bucket === "pack") {
      quantity = Math.max(1, Math.ceil(group.total - 1e-9));
      needed = `${formatAmount(group.total)}`;
      detail = "";
    } else {
      const parts = [...group.littleUnits.entries()]
        .filter(([unit]) => unit !== "AL_GUSTO")
        .map(([unit, amount]) => `${formatAmount(amount)} ${unitLabel(unit, amount)}`);
      if (group.littleUnits.has("AL_GUSTO")) parts.push("al gusto");
      needed = parts.join(" + ");
      detail = needed;
    }

    return {
      key: group.key,
      item_id: group.itemId,
      name: group.name,
      quantity,
      detail,
      needed,
      pantry: group.pantry,
      sources: group.sources,
      ingredient_ids: group.ingredientIds,
    };
  });
};

// ---------------------------------------------------------------------------
// Búsqueda de producto en el catálogo: exacto (sin tildes ni plurales),
// parecido (comparte alguna palabra significativa) o nuevo.
// Nunca se elige un producto distinto sin que el usuario lo confirme.
// ---------------------------------------------------------------------------
const matchProduct = (name, items = []) => {
  const key = nameKey(name);
  if (!key) return { status: "new", item: null, suggestion: null };

  const exact = items.find((item) => nameKey(item.name) === key);
  if (exact) return { status: "found", item: exact, suggestion: null };

  const words = significantWords(name);
  let best = null;
  let bestScore = 0;
  for (const item of items) {
    const itemWords = significantWords(item.name);
    if (!itemWords.length) continue;
    const shared = words.filter((word) => itemWords.includes(word)).length;
    if (!shared) continue;
    const score = shared / Math.max(words.length, itemWords.length);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return best
    ? { status: "similar", item: null, suggestion: best }
    : { status: "new", item: null, suggestion: null };
};

// ---------------------------------------------------------------------------
// Validación de entrada.
// ---------------------------------------------------------------------------
const cleanText = (value, max = MAX_TEXT) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
};

const isValidTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
const isValidIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const clampInt = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

class MenuInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Valida y normaliza el cuerpo de una receta (crear/editar/importar).
const sanitizeRecipeInput = (body = {}) => {
  const name = cleanText(body.name, MAX_NAME);
  if (!name) throw new MenuInputError("La receta necesita un nombre");

  const servings = clampInt(body.servings, 1, 100, 4);
  const prepMinutes = body.prep_minutes === null || body.prep_minutes === "" || body.prep_minutes === undefined
    ? null
    : clampInt(body.prep_minutes, 0, 6000, null);

  const rawIngredients = Array.isArray(body.ingredients) ? body.ingredients : [];
  if (rawIngredients.length > 80) throw new MenuInputError("Una receta puede tener como máximo 80 ingredientes");
  const ingredients = rawIngredients
    .map((raw, index) => {
      const ingredientName = cleanText(raw?.name, MAX_NAME);
      if (!ingredientName) return null;
      const unit = normalizeUnit(raw?.unit);
      if (!unit) throw new MenuInputError(`Unidad no válida en «${ingredientName}»`);
      let quantity = raw?.quantity === null || raw?.quantity === "" || raw?.quantity === undefined
        ? null
        : Number(String(raw.quantity).replace(",", "."));
      if (unit === "AL_GUSTO") quantity = null;
      if (quantity !== null && !(Number.isFinite(quantity) && quantity > 0 && quantity <= 100000)) {
        throw new MenuInputError(`Cantidad no válida en «${ingredientName}»`);
      }
      return {
        id: typeof raw?.id === "string" ? raw.id : null,
        position: index,
        name: ingredientName,
        quantity,
        unit,
        pantry: raw?.pantry === undefined ? isLikelyPantry(ingredientName) : Boolean(raw.pantry),
        item_id: typeof raw?.item_id === "string" && raw.item_id ? raw.item_id : null,
      };
    })
    .filter(Boolean);

  const steps = (Array.isArray(body.steps) ? body.steps : [])
    .map((step) => cleanText(step, 1000))
    .filter(Boolean)
    .slice(0, 50);
  const tags = [...new Set((Array.isArray(body.tags) ? body.tags : [])
    .map((tag) => cleanText(tag, 30))
    .filter(Boolean))]
    .slice(0, 12);

  return {
    name,
    servings,
    prep_minutes: prepMinutes,
    difficulty: cleanText(body.difficulty, 30),
    tags,
    steps,
    notes: cleanText(body.notes, MAX_TEXT),
    source: cleanText(body.source, 300),
    favorite: Boolean(body.favorite),
    ingredients,
  };
};

// ---------------------------------------------------------------------------
// Recetas en texto (ChatGPT). Formato:
//   RECETA: Pollo al curry
//   RACIONES: 4
//   TIEMPO: 45
//   ETIQUETAS: Táper, Congelable
//   INGREDIENTES:
//   - Contramuslo de pollo | 600 | g
//   - Sal | al gusto
//   PASOS:
//   1. ...
// También entiende "- 600 g de contramuslo de pollo".
// ---------------------------------------------------------------------------
const parseQuantity = (raw) => {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim().replace(",", ".");
  if (!text) return null;
  const fractions = { "½": 0.5, "¼": 0.25, "¾": 0.75, medio: 0.5, media: 0.5, un: 1, una: 1, uno: 1 };
  if (fractions[text.toLowerCase()] !== undefined) return fractions[text.toLowerCase()];
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
};

const unitPattern = Object.keys(UNIT_ALIASES)
  .filter((alias) => alias !== "gusto")
  .sort((a, b) => b.length - a.length)
  .map((alias) => alias.replace(/\s+/g, "\\s+"))
  .join("|");
const FREE_INGREDIENT_RE = new RegExp(
  `^(\\d+(?:[.,]\\d+)?|\\d+\\/\\d+|½|¼|¾|medio|media|un|una|uno)\\s*(${unitPattern})?\\.?\\s+(?:de\\s+)?(.+)$`,
  "i"
);

const parseIngredientLine = (line) => {
  const clean = line.replace(/^[-*•·]\s*/, "").replace(/^\d+[.)]\s+/, "").trim();
  if (!clean) return null;

  if (clean.includes("|")) {
    const [name, second = "", third = ""] = clean.split("|").map((part) => part.trim());
    if (!name) return null;
    if (/^al gusto$/i.test(second) || /^al gusto$/i.test(third)) {
      return { name, quantity: null, unit: "AL_GUSTO" };
    }
    const quantity = parseQuantity(second);
    const unit = normalizeUnit(third || "UD");
    return { name, quantity: Number.isNaN(quantity) ? NaN : quantity, unit, rawUnit: third };
  }

  const tasteMatch = clean.match(/^(.+?)\s+al gusto$/i);
  if (tasteMatch) return { name: tasteMatch[1].trim(), quantity: null, unit: "AL_GUSTO" };

  const freeMatch = clean.match(FREE_INGREDIENT_RE);
  if (freeMatch) {
    const unit = freeMatch[2] ? normalizeUnit(freeMatch[2]) : "UD";
    let name = freeMatch[3].trim();
    name = name.charAt(0).toUpperCase() + name.slice(1);
    return { name, quantity: parseQuantity(freeMatch[1]), unit };
  }

  return { name: clean.charAt(0).toUpperCase() + clean.slice(1), quantity: null, unit: "AL_GUSTO" };
};

const extractCodeBlocks = (value = "") => {
  const blocks = [...String(value).matchAll(/```(?:[a-z]*)\s*([\s\S]*?)```/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  return blocks.length ? blocks.join("\n\n") : String(value);
};

const HEADER_KEYS = {
  RECETA: "name", NOMBRE: "name",
  RACIONES: "servings", PERSONAS: "servings",
  TIEMPO: "prep_minutes",
  DIFICULTAD: "difficulty",
  ETIQUETAS: "tags",
  NOTAS: "notes",
  INGREDIENTES: "ingredients",
  PASOS: "steps", PREPARACION: "steps", ELABORACION: "steps",
};

const parseRecipeText = (text) => {
  const source = extractCodeBlocks(text);
  if (source.length > 50000) throw new MenuInputError("El texto es demasiado largo");
  const lines = source.split(/\r?\n/);
  const recipes = [];
  let current = null;
  let section = null;

  const start = (name) => {
    current = { name, servings: 4, prep_minutes: null, difficulty: null, tags: [], notes: null, ingredients: [], steps: [], errors: [] };
    recipes.push(current);
    section = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^#+\s*/, "").replace(/\*\*/g, "");
    if (!line) continue;

    const header = line.match(/^([A-Za-zÁÉÍÓÚáéíóúÑñ ]+):\s*(.*)$/);
    const headerKey = header ? HEADER_KEYS[stripAccents(header[1]).trim().toUpperCase()] : null;

    if (headerKey === "name") {
      start(header[2].trim());
      continue;
    }
    if (!current) continue;

    if (headerKey) {
      const value = header[2].trim();
      if (headerKey === "ingredients" || headerKey === "steps") {
        section = headerKey;
        if (value) {
          if (headerKey === "steps") current.steps.push(value);
          else {
            const ingredient = parseIngredientLine(value);
            if (ingredient) current.ingredients.push(ingredient);
          }
        }
      } else if (headerKey === "servings") {
        const servings = parseInt(value, 10);
        if (Number.isFinite(servings) && servings > 0) current.servings = Math.min(servings, 100);
        else current.errors.push("RACIONES debe ser un número");
        section = null;
      } else if (headerKey === "prep_minutes") {
        const minutes = parseInt(value, 10);
        current.prep_minutes = Number.isFinite(minutes) ? minutes : null;
        section = null;
      } else if (headerKey === "tags") {
        current.tags = value.split(/[,;]/).map((tag) => tag.trim()).filter(Boolean);
        section = null;
      } else {
        current[headerKey] = value || null;
        section = headerKey === "notes" ? "notes" : null;
      }
      continue;
    }

    if (section === "ingredients") {
      const ingredient = parseIngredientLine(line);
      if (!ingredient) continue;
      if (ingredient.unit === null) {
        current.errors.push(`Unidad no reconocida en «${ingredient.name}»: ${ingredient.rawUnit}`);
      } else if (Number.isNaN(ingredient.quantity) || (ingredient.quantity !== null && ingredient.quantity <= 0)) {
        current.errors.push(`Cantidad no válida en «${ingredient.name}»`);
      }
      current.ingredients.push(ingredient);
    } else if (section === "steps") {
      current.steps.push(line.replace(/^\d+[.)-]\s*/, "").replace(/^[-*•]\s*/, ""));
    } else if (section === "notes") {
      current.notes = current.notes ? `${current.notes}\n${line}` : line;
    }
  }

  if (!recipes.length) {
    throw new MenuInputError("No encuentro ninguna receta. Empieza con una línea «RECETA: Nombre».");
  }

  return recipes.slice(0, 20).map((recipe) => {
    if (!recipe.name) recipe.errors.push("Falta el nombre de la receta");
    if (!recipe.ingredients.length) recipe.errors.push("No tiene ingredientes");
    recipe.ingredients = recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: Number.isNaN(ingredient.quantity) ? null : ingredient.quantity,
      unit: ingredient.unit || "UD",
      pantry: isLikelyPantry(ingredient.name),
    }));
    return recipe;
  });
};

module.exports = {
  DISH_KINDS,
  UNITS,
  MenuInputError,
  aggregateShopping,
  clampInt,
  cleanText,
  describeIngredientAmount,
  dishServings,
  formatAmount,
  isLikelyPantry,
  isValidIsoDate,
  isValidTime,
  matchProduct,
  nameKey,
  normalizeName,
  normalizeUnit,
  parseIngredientLine,
  parseRecipeText,
  roundToPack,
  sanitizeRecipeInput,
  unitFamily,
};
