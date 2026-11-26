-- Menús y recetas (v2). Actualización NO destructiva: hacer copia de seguridad antes.
-- Solo crea tablas nuevas y añade columnas opcionales. No borra, renombra ni modifica
-- datos existentes. WeeklyMenu y MenuMeal se conservan tal cual; su contenido se copia
-- a "PlannedDish" desde la aplicación la primera vez que cada hogar abre el menú.
-- Se puede ejecutar más de una vez.
BEGIN;

ALTER TABLE "Home" ADD COLUMN IF NOT EXISTS "menu_v2_ready_at" TIMESTAMP(3);
ALTER TABLE "ItemList" ADD COLUMN IF NOT EXISTS "detail" TEXT;

CREATE TABLE IF NOT EXISTS "MealType" (
  "id" TEXT NOT NULL,
  "home_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "default_time" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "legacy_type" "MENU_MEAL_TYPE",
  "deleted_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MealType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MealType_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "MealType_home_id_position_idx" ON "MealType"("home_id", "position");

CREATE TABLE IF NOT EXISTS "DinerGroup" (
  "id" TEXT NOT NULL,
  "home_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DinerGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DinerGroup_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "DinerGroup_home_id_idx" ON "DinerGroup"("home_id");

CREATE TABLE IF NOT EXISTS "Diner" (
  "id" TEXT NOT NULL,
  "home_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'HOUSEHOLD',
  "group_id" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Diner_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Diner_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Diner_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "DinerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Diner_home_id_idx" ON "Diner"("home_id");
CREATE INDEX IF NOT EXISTS "Diner_group_id_idx" ON "Diner"("group_id");

CREATE TABLE IF NOT EXISTS "Recipe" (
  "id" TEXT NOT NULL,
  "home_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "servings" INTEGER NOT NULL DEFAULT 4,
  "prep_minutes" INTEGER,
  "difficulty" TEXT,
  "tags" TEXT[],
  "steps" TEXT[],
  "notes" TEXT,
  "source" TEXT,
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "created_by_user_id" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Recipe_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Recipe_home_id_name_idx" ON "Recipe"("home_id", "name");

CREATE TABLE IF NOT EXISTS "RecipeIngredient" (
  "id" TEXT NOT NULL,
  "recipe_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION,
  "unit" TEXT NOT NULL DEFAULT 'UD',
  "pantry" BOOLEAN NOT NULL DEFAULT false,
  "item_id" TEXT,
  CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecipeIngredient_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecipeIngredient_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RecipeIngredient_recipe_id_position_idx" ON "RecipeIngredient"("recipe_id", "position");
CREATE INDEX IF NOT EXISTS "RecipeIngredient_item_id_idx" ON "RecipeIngredient"("item_id");

CREATE TABLE IF NOT EXISTS "PlannedDish" (
  "id" TEXT NOT NULL,
  "home_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "meal_type_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "kind" TEXT NOT NULL DEFAULT 'FREE',
  "title" TEXT NOT NULL,
  "time" TEXT,
  "notes" TEXT,
  "recipe_id" TEXT,
  "recipe_snapshot" JSONB,
  "guests" INTEGER NOT NULL DEFAULT 0,
  "extra_servings" INTEGER NOT NULL DEFAULT 0,
  "leftover_of_id" TEXT,
  "added_to_list_at" TIMESTAMP(3),
  "added_to_list_id" TEXT,
  "legacy_menu_meal_id" TEXT,
  "created_by_user_id" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlannedDish_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlannedDish_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlannedDish_meal_type_id_fkey" FOREIGN KEY ("meal_type_id") REFERENCES "MealType"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "PlannedDish_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlannedDish_leftover_of_id_fkey" FOREIGN KEY ("leftover_of_id") REFERENCES "PlannedDish"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlannedDish_legacy_menu_meal_id_key" ON "PlannedDish"("legacy_menu_meal_id");
CREATE INDEX IF NOT EXISTS "PlannedDish_home_id_date_idx" ON "PlannedDish"("home_id", "date");
CREATE INDEX IF NOT EXISTS "PlannedDish_meal_type_id_idx" ON "PlannedDish"("meal_type_id");
CREATE INDEX IF NOT EXISTS "PlannedDish_recipe_id_idx" ON "PlannedDish"("recipe_id");
CREATE INDEX IF NOT EXISTS "PlannedDish_leftover_of_id_idx" ON "PlannedDish"("leftover_of_id");

CREATE TABLE IF NOT EXISTS "PlannedDishDiner" (
  "id" TEXT NOT NULL,
  "dish_id" TEXT NOT NULL,
  "user_id" TEXT,
  "diner_id" TEXT,
  CONSTRAINT "PlannedDishDiner_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlannedDishDiner_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "PlannedDish"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlannedDishDiner_diner_id_fkey" FOREIGN KEY ("diner_id") REFERENCES "Diner"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PlannedDishDiner_diner_id_idx" ON "PlannedDishDiner"("diner_id");
CREATE UNIQUE INDEX IF NOT EXISTS "PlannedDishDiner_dish_id_user_id_key" ON "PlannedDishDiner"("dish_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "PlannedDishDiner_dish_id_diner_id_key" ON "PlannedDishDiner"("dish_id", "diner_id");

COMMIT;

-- Para deshacer (solo si todavía no se ha usado el módulo nuevo; borra lo creado aquí):
-- BEGIN;
-- DROP TABLE IF EXISTS "PlannedDishDiner", "PlannedDish", "RecipeIngredient", "Recipe", "Diner", "DinerGroup", "MealType";
-- ALTER TABLE "ItemList" DROP COLUMN IF EXISTS "detail";
-- ALTER TABLE "Home" DROP COLUMN IF EXISTS "menu_v2_ready_at";
-- COMMIT;
