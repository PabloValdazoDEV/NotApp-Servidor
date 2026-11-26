const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  aggregateShopping,
  describeIngredientAmount,
  dishServings,
  formatAmount,
  isLikelyPantry,
  matchProduct,
  nameKey,
  normalizeUnit,
  parseIngredientLine,
  parseRecipeText,
  roundToPack,
  sanitizeRecipeInput,
} = require("../utils/menuPlanner");

describe("nameKey", () => {
  it("ignores accents, case and simple plurals", () => {
    assert.equal(nameKey("Cebollas"), nameKey("cebolla"));
    assert.equal(nameKey("Ajos"), nameKey("ajo"));
    assert.equal(nameKey("Limones"), nameKey("Limón"));
    assert.equal(nameKey("  Pimentón   dulce "), "pimenton dulce");
  });
});

describe("roundToPack", () => {
  it("rounds to standard sizes", () => {
    assert.equal(roundToPack(120), 250);
    assert.equal(roundToPack(450), 500);
    assert.equal(roundToPack(700), 750);
    assert.equal(roundToPack(1000), 1000);
    assert.equal(roundToPack(1300), 1500);
    assert.equal(roundToPack(0), 0);
  });
});

describe("formatAmount", () => {
  it("uses quarter symbols and comma decimals", () => {
    assert.equal(formatAmount(0.5), "½");
    assert.equal(formatAmount(1.25), "1 ¼");
    assert.equal(formatAmount(0.75), "¾");
    assert.equal(formatAmount(2), "2");
    assert.equal(formatAmount(1.3), "1,3");
  });
});

describe("dishServings", () => {
  it("adds diners, guests and leftovers", () => {
    assert.equal(dishServings({ dinerCount: 3, guests: 2, extraServings: 1 }), 6);
  });
  it("uses the household size when nobody is assigned", () => {
    assert.equal(dishServings({ dinerCount: 0, guests: 0, extraServings: 1, householdSize: 3 }), 4);
  });
  it("counts only guests when the household is not eating", () => {
    assert.equal(dishServings({ dinerCount: 0, guests: 2, householdSize: 3 }), 2);
  });
});

describe("aggregateShopping", () => {
  it("sums before rounding (200 g + 300 g = one 500 g pack)", () => {
    const [line] = aggregateShopping([
      { key: "item:pollo", itemId: "pollo", name: "Pollo", quantity: 200, unit: "G", factor: 1, source: "A" },
      { key: "item:pollo", itemId: "pollo", name: "Pollo", quantity: 0.3, unit: "KG", factor: 1, source: "B" },
    ]);
    assert.equal(line.quantity, 1);
    assert.equal(line.detail, "≈500 g");
    assert.deepEqual(line.sources, ["A", "B"]);
  });

  it("rounds units up after summing (½ + ¾ onion = 2 onions)", () => {
    const [line] = aggregateShopping([
      { key: "n:cebolla", name: "Cebolla", quantity: 1, unit: "UD", factor: 0.75 },
      { key: "n:cebolla", name: "Cebolla", quantity: 0.5, unit: "UD", factor: 1 },
    ]);
    assert.equal(line.quantity, 2);
    assert.equal(line.detail, "1 ¼ ud");
  });

  it("counts small units as one product", () => {
    const [line] = aggregateShopping([
      { key: "n:ajo", name: "Ajo", quantity: 2, unit: "DIENTE", factor: 0.75 },
      { key: "n:ajo", name: "Ajo", quantity: 3, unit: "DIENTE", factor: 1 },
    ]);
    assert.equal(line.quantity, 1);
    assert.equal(line.detail, "4 ½ dientes");
  });

  it("keeps the pantry flag only when every use is pantry", () => {
    const lines = aggregateShopping([
      { key: "n:sal", name: "Sal", quantity: null, unit: "AL_GUSTO", pantry: true },
      { key: "n:aceite", name: "Aceite", quantity: 2, unit: "CUCHARADA", pantry: true },
      { key: "n:aceite", name: "Aceite", quantity: 1, unit: "L", pantry: false },
    ]);
    const salt = lines.find((line) => line.key === "n:sal");
    assert.equal(salt.pantry, true);
    assert.equal(salt.detail, "al gusto");
    const oilLitre = lines.find((line) => line.key === "n:aceite" && line.detail.includes("l"));
    assert.equal(oilLitre.pantry, false);
  });

  it("scales with the servings factor", () => {
    const [line] = aggregateShopping([
      { key: "n:nata", name: "Nata", quantity: 200, unit: "ML", factor: 1.25 },
    ]);
    assert.equal(line.detail, "≈250 ml");
    assert.equal(line.needed, "250 ml");
  });
});

describe("matchProduct", () => {
  const items = [
    { id: "1", name: "Contramuslo de pollo" },
    { id: "2", name: "Cebollas" },
    { id: "3", name: "Leche entera" },
  ];

  it("finds exact matches ignoring plurals and accents", () => {
    assert.equal(matchProduct("cebolla", items).item.id, "2");
  });

  it("suggests but never picks a different product", () => {
    const result = matchProduct("Filetes de pollo", items);
    assert.equal(result.status, "similar");
    assert.equal(result.item, null);
    assert.equal(result.suggestion.id, "1");
  });

  it("returns new when nothing is related", () => {
    assert.equal(matchProduct("Leche de coco", [{ id: "9", name: "Arroz" }]).status, "new");
  });
});

describe("units and pantry", () => {
  it("normalizes unit aliases", () => {
    assert.equal(normalizeUnit("gramos"), "G");
    assert.equal(normalizeUnit("Dientes"), "DIENTE");
    assert.equal(normalizeUnit("al gusto"), "AL_GUSTO");
    assert.equal(normalizeUnit("furgonetas"), null);
  });

  it("detects common pantry items by whole word", () => {
    assert.equal(isLikelyPantry("Sal"), true);
    assert.equal(isLikelyPantry("Aceite de oliva"), true);
    assert.equal(isLikelyPantry("Salmón"), false);
  });

  it("describes ingredient amounts", () => {
    assert.equal(describeIngredientAmount(600, "G"), "600 g");
    assert.equal(describeIngredientAmount(1.5, "KG"), "1,5 kg");
    assert.equal(describeIngredientAmount(2, "DIENTE"), "2 dientes");
    assert.equal(describeIngredientAmount(null, "AL_GUSTO"), "al gusto");
  });
});

describe("parseIngredientLine", () => {
  it("reads the pipe format", () => {
    assert.deepEqual(parseIngredientLine("- Contramuslo de pollo | 600 | g"), {
      name: "Contramuslo de pollo", quantity: 600, unit: "G", rawUnit: "g",
    });
  });

  it("reads free text quantities", () => {
    const line = parseIngredientLine("- 2 dientes de ajo");
    assert.equal(line.name, "Ajo");
    assert.equal(line.quantity, 2);
    assert.equal(line.unit, "DIENTE");
    assert.equal(parseIngredientLine("- media cebolla").quantity, 0.5);
    assert.equal(parseIngredientLine("- Sal al gusto").unit, "AL_GUSTO");
  });
});

describe("parseRecipeText", () => {
  it("parses a ChatGPT recipe", () => {
    const [recipe] = parseRecipeText([
      "```text",
      "RECETA: Pollo al curry",
      "RACIONES: 4",
      "TIEMPO: 45",
      "ETIQUETAS: Táper, Congelable",
      "INGREDIENTES:",
      "- Contramuslo de pollo | 600 | g",
      "- Ajo | 2 | diente",
      "- Sal | al gusto",
      "PASOS:",
      "1. Dora el pollo.",
      "2. Añade el curry.",
      "```",
    ].join("\n"));
    assert.equal(recipe.name, "Pollo al curry");
    assert.equal(recipe.servings, 4);
    assert.equal(recipe.prep_minutes, 45);
    assert.deepEqual(recipe.tags, ["Táper", "Congelable"]);
    assert.equal(recipe.ingredients.length, 3);
    assert.equal(recipe.ingredients[2].pantry, true);
    assert.deepEqual(recipe.steps, ["Dora el pollo.", "Añade el curry."]);
    assert.deepEqual(recipe.errors, []);
  });

  it("reports errors instead of guessing", () => {
    const [recipe] = parseRecipeText("RECETA: Rara\nINGREDIENTES:\n- Harina | mucho | g\n- Pan | 1 | furgoneta");
    assert.equal(recipe.errors.length, 2);
  });

  it("rejects text without recipes", () => {
    assert.throws(() => parseRecipeText("hola"), /RECETA/);
  });
});

describe("sanitizeRecipeInput", () => {
  it("normalizes and validates", () => {
    const recipe = sanitizeRecipeInput({
      name: "  Lentejas ",
      servings: "4",
      ingredients: [{ name: "Lentejas", quantity: "0,5", unit: "kg" }, { name: "Sal", unit: "AL_GUSTO", quantity: 3 }, { name: "" }],
      steps: ["Cocer", ""],
      tags: ["Táper", "Táper"],
    });
    assert.equal(recipe.name, "Lentejas");
    assert.equal(recipe.ingredients.length, 2);
    assert.equal(recipe.ingredients[0].quantity, 0.5);
    assert.equal(recipe.ingredients[0].unit, "KG");
    assert.equal(recipe.ingredients[1].quantity, null);
    assert.equal(recipe.ingredients[1].pantry, true);
    assert.deepEqual(recipe.steps, ["Cocer"]);
    assert.deepEqual(recipe.tags, ["Táper"]);
  });

  it("rejects bad quantities", () => {
    assert.throws(() => sanitizeRecipeInput({ name: "X", ingredients: [{ name: "Pan", quantity: -1, unit: "UD" }] }), /Cantidad/);
    assert.throws(() => sanitizeRecipeInput({ name: "" }), /nombre/);
  });
});
