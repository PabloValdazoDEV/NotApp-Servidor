-- Complete update from production origin/main (a230aed) to the October 2026 app.
-- Back up the actual production database before running this file.
-- Adds Google sign-in / verified registration as well as shopping carry support.
-- Existing users, lists, products, quantities and results are retained.
-- May be run again, including after 20261004_shopping_carry.sql.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(hashtext('notapp:20261004:production-update'));

-- Abort instead of guessing if this installation has an older or incompatible schema.
DO $check$
DECLARE incompatible TEXT;
BEGIN
  SELECT string_agg(expected.table_name || '.' || expected.column_name, ', ' ORDER BY expected.table_name, expected.column_name)
  INTO incompatible
  FROM (VALUES
      ('User', 'id', 'text', 'NO'),
      ('User', 'email', 'text', 'NO'),
      ('User', 'name', 'text', 'YES'),
      ('User', 'password', 'text', 'NO'),
      ('User', 'image', 'text', 'YES'),
      ('User', 'onboarding_completed_at', 'timestamp', 'YES'),
      ('User', 'onboarding_version', 'int4', 'YES'),
      ('User', 'tutorial_home_id', 'text', 'YES'),
      ('User', 'install_prompt_completed_at', 'timestamp', 'YES'),
      ('User', 'install_prompt_skipped_at', 'timestamp', 'YES'),
      ('User', 'plan', 'USER_PLAN', 'NO'),
      ('User', 'premium_home_slots', 'int4', 'NO'),
      ('User', 'premium_expires_at', 'timestamp', 'YES'),
      ('User', 'createdAt', 'timestamp', 'NO'),
      ('User', 'updatedAt', 'timestamp', 'NO'),
      ('Member', 'id', 'text', 'NO'),
      ('Member', 'user_id', 'text', 'NO'),
      ('Member', 'home_id', 'text', 'NO'),
      ('Member', 'role', 'ROLE', 'NO'),
      ('Invitation', 'id', 'text', 'NO'),
      ('Invitation', 'user_id', 'text', 'YES'),
      ('Invitation', 'email', 'text', 'YES'),
      ('Invitation', 'home_id', 'text', 'NO'),
      ('Invitation', 'createdAt', 'timestamp', 'NO'),
      ('ErrorLogin', 'id', 'text', 'NO'),
      ('ErrorLogin', 'user_id', 'text', 'NO'),
      ('ErrorLogin', 'date_try', 'timestamp', 'NO'),
      ('Home', 'id', 'text', 'NO'),
      ('Home', 'name', 'text', 'NO'),
      ('Home', 'image', 'text', 'YES'),
      ('Home', 'is_tutorial', 'bool', 'NO'),
      ('Home', 'premium_assigned_by_user_id', 'text', 'YES'),
      ('Home', 'premium_assigned_at', 'timestamp', 'YES'),
      ('Home', 'premium_locked_until', 'timestamp', 'YES'),
      ('Home', 'premium_ends_at', 'timestamp', 'YES'),
      ('Home', 'createdAt', 'timestamp', 'NO'),
      ('Home', 'updatedAt', 'timestamp', 'NO'),
      ('HomeFavorite', 'id', 'text', 'NO'),
      ('HomeFavorite', 'user_id', 'text', 'NO'),
      ('HomeFavorite', 'home_id', 'text', 'NO'),
      ('HomeFavorite', 'createdAt', 'timestamp', 'NO'),
      ('List', 'id', 'text', 'NO'),
      ('List', 'title', 'text', 'NO'),
      ('List', 'home_id', 'text', 'NO'),
      ('List', 'fav', 'bool', 'NO'),
      ('List', 'listCheck', 'bool', 'NO'),
      ('List', 'copied_from_not_found_list_id', 'text', 'YES'),
      ('List', 'createdAt', 'timestamp', 'YES'),
      ('List', 'updatedAt', 'timestamp', 'YES'),
      ('ItemList', 'id', 'text', 'NO'),
      ('ItemList', 'item_id', 'text', 'NO'),
      ('ItemList', 'list_id', 'text', 'NO'),
      ('ItemList', 'quantity', 'int4', 'NO'),
      ('ItemList', 'purchased_quantity', 'int4', 'NO'),
      ('ItemList', 'check_take', 'bool', 'NO'),
      ('ItemList', 'status', 'ITEM_LIST_STATUS', 'NO'),
      ('ItemList', 'createdAt', 'timestamp', 'YES'),
      ('ItemList', 'updatedAt', 'timestamp', 'YES'),
      ('Item', 'id', 'text', 'NO'),
      ('Item', 'name', 'text', 'NO'),
      ('Item', 'home_id', 'text', 'NO'),
      ('Item', 'image', 'text', 'YES'),
      ('Item', 'price', 'text', 'YES'),
      ('Item', 'description', 'text', 'YES'),
      ('Item', 'categories', '_CATEGORY', 'YES'),
      ('Item', 'supermarket', 'SUPERMARKET', 'NO'),
      ('Item', 'is_recurring', 'bool', 'NO'),
      ('Item', 'createdAt', 'timestamp', 'YES'),
      ('Item', 'updatedAt', 'timestamp', 'YES'),
      ('WeeklyMenu', 'id', 'text', 'NO'),
      ('WeeklyMenu', 'home_id', 'text', 'NO'),
      ('WeeklyMenu', 'week_start', 'date', 'NO'),
      ('WeeklyMenu', 'created_by_user_id', 'text', 'YES'),
      ('WeeklyMenu', 'createdAt', 'timestamp', 'NO'),
      ('WeeklyMenu', 'updatedAt', 'timestamp', 'NO'),
      ('MenuMeal', 'id', 'text', 'NO'),
      ('MenuMeal', 'weekly_menu_id', 'text', 'NO'),
      ('MenuMeal', 'day_date', 'date', 'NO'),
      ('MenuMeal', 'type', 'MENU_MEAL_TYPE', 'NO'),
      ('MenuMeal', 'title', 'text', 'YES'),
      ('MenuMeal', 'notes', 'text', 'YES'),
      ('MenuMeal', 'createdAt', 'timestamp', 'NO'),
      ('MenuMeal', 'updatedAt', 'timestamp', 'NO'),
      ('MenuPublicToken', 'id', 'text', 'NO'),
      ('MenuPublicToken', 'home_id', 'text', 'NO'),
      ('MenuPublicToken', 'token', 'text', 'YES'),
      ('MenuPublicToken', 'token_hash', 'text', 'NO'),
      ('MenuPublicToken', 'name', 'text', 'YES'),
      ('MenuPublicToken', 'revokedAt', 'timestamp', 'YES'),
      ('MenuPublicToken', 'createdAt', 'timestamp', 'NO'),
      ('MenuPublicToken', 'updatedAt', 'timestamp', 'NO'),
      ('OneTimeToken', 'id', 'text', 'NO'),
      ('OneTimeToken', 'token', 'text', 'NO'),
      ('OneTimeToken', 'purpose', 'text', 'NO'),
      ('OneTimeToken', 'user_id', 'text', 'YES'),
      ('OneTimeToken', 'used', 'bool', 'NO'),
      ('OneTimeToken', 'expiresAt', 'timestamp', 'NO'),
      ('OneTimeToken', 'createdAt', 'timestamp', 'NO')
  ) AS expected(table_name, column_name, udt_name, is_nullable)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
    AND actual.table_name = expected.table_name
    AND actual.column_name = expected.column_name
  WHERE actual.column_name IS NULL
     OR actual.udt_name <> expected.udt_name
     OR actual.is_nullable <> expected.is_nullable;
  IF incompatible IS NOT NULL THEN
    RAISE EXCEPTION 'NotApp production schema prerequisites missing or incompatible: %', incompatible;
  END IF;
END $check$;

-- No enum values changed relative to the deployed branch; check its prerequisites.
DO $check$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(expected.type_name || '.' || expected.enum_label, ', ')
  INTO missing
  FROM (VALUES
      ('ROLE', 'OWNER'),
      ('ROLE', 'ADMIN'),
      ('ROLE', 'MEMBER'),
      ('USER_PLAN', 'FREE'),
      ('USER_PLAN', 'PREMIUM'),
      ('USER_PLAN', 'APP_OWNER'),
      ('CATEGORY', 'FRUTAS_VERDURAS'),
      ('CATEGORY', 'LACTEOS'),
      ('CATEGORY', 'CARNE'),
      ('CATEGORY', 'PESCADO'),
      ('CATEGORY', 'BEBIDAS'),
      ('CATEGORY', 'PANADERIA'),
      ('CATEGORY', 'DULCES'),
      ('CATEGORY', 'CONGELADOS'),
      ('CATEGORY', 'HIGIENE'),
      ('CATEGORY', 'BELLEZA'),
      ('CATEGORY', 'LIMPIEZA'),
      ('CATEGORY', 'MASCOTAS'),
      ('CATEGORY', 'DESAYUNOS'),
      ('CATEGORY', 'CAFE_INFUSIONES'),
      ('CATEGORY', 'PASTA_ARROZ_LEGUMBRES'),
      ('CATEGORY', 'CONSERVAS'),
      ('CATEGORY', 'HUEVOS'),
      ('CATEGORY', 'ACEITES_SALSAS_CONDIMENTOS'),
      ('CATEGORY', 'CHARCUTERIA'),
      ('CATEGORY', 'APERITIVOS'),
      ('CATEGORY', 'PLATOS_PREPARADOS'),
      ('CATEGORY', 'BEBE'),
      ('CATEGORY', 'FARMACIA'),
      ('CATEGORY', 'OTROS'),
      ('ITEM_LIST_STATUS', 'PENDING'),
      ('ITEM_LIST_STATUS', 'FOUND'),
      ('ITEM_LIST_STATUS', 'NOT_FOUND'),
      ('SUPERMARKET', 'CUALQUIERA'),
      ('SUPERMARKET', 'MERCADONA'),
      ('SUPERMARKET', 'AHORRAMAS'),
      ('SUPERMARKET', 'CARREFOUR'),
      ('SUPERMARKET', 'LIDL'),
      ('SUPERMARKET', 'ALDI'),
      ('SUPERMARKET', 'DIA'),
      ('SUPERMARKET', 'ALCAMPO'),
      ('SUPERMARKET', 'EROSKI'),
      ('SUPERMARKET', 'CONSUM'),
      ('SUPERMARKET', 'OTROS'),
      ('MENU_MEAL_TYPE', 'COMIDA'),
      ('MENU_MEAL_TYPE', 'CENA')
  ) AS expected(type_name, enum_label)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = expected.type_name
      AND e.enumlabel = expected.enum_label
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'NotApp enum prerequisites missing: %', missing;
  END IF;
END $check$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "google_sub" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "password_enabled" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS "User_google_sub_key" ON "User"("google_sub");

CREATE TABLE IF NOT EXISTS "PendingRegistration" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "invite_token" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PendingRegistration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PendingRegistration_email_key" ON "PendingRegistration"("email");
CREATE INDEX IF NOT EXISTS "PendingRegistration_expiresAt_idx" ON "PendingRegistration"("expiresAt");

CREATE TABLE IF NOT EXISTS "ShoppingCarry" (
  "id" TEXT NOT NULL,
  "source_list_id" TEXT NOT NULL,
  "target_list_id" TEXT NOT NULL,
  "created_by_user_id" TEXT,
  "created_target" BOOLEAN NOT NULL DEFAULT false,
  "deltas" JSONB NOT NULL,
  "undone_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShoppingCarry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShoppingCarry_source_list_id_fkey" FOREIGN KEY ("source_list_id") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShoppingCarry_target_list_id_fkey" FOREIGN KEY ("target_list_id") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingCarry_source_list_id_key" ON "ShoppingCarry"("source_list_id");
CREATE INDEX IF NOT EXISTS "ShoppingCarry_target_list_id_idx" ON "ShoppingCarry"("target_list_id");

-- Historical resolved rows can coexist with a new pending row of the same product.
-- This changes only the index; it never removes ItemList rows or their contents.
DROP INDEX IF EXISTS "ItemList_item_id_list_id_key";
CREATE INDEX IF NOT EXISTS "ItemList_item_id_list_id_idx" ON "ItemList"("item_id", "list_id");
ALTER TABLE "ItemList" ADD COLUMN IF NOT EXISTS "created_mutation_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ItemList_list_id_created_mutation_id_key" ON "ItemList"("list_id", "created_mutation_id");

CREATE TABLE IF NOT EXISTS "ShoppingMutation" (
  "id" TEXT NOT NULL,
  "list_id" TEXT NOT NULL,
  "mutation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "item_list_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShoppingMutation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingMutation_list_id_mutation_id_key" ON "ShoppingMutation"("list_id", "mutation_id");
CREATE INDEX IF NOT EXISTS "ShoppingMutation_item_list_id_idx" ON "ShoppingMutation"("item_list_id");

-- Retain idempotency for lists previously created with the old endpoint.
INSERT INTO "ShoppingCarry" ("id", "source_list_id", "target_list_id", "created_target", "deltas", "createdAt", "updatedAt")
SELECT 'legacy-' || chosen."id", chosen."copied_from_not_found_list_id", chosen."id", false, '[]'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (l."copied_from_not_found_list_id") l."id", l."copied_from_not_found_list_id"
  FROM "List" l JOIN "List" source ON source."id" = l."copied_from_not_found_list_id"
  WHERE l."copied_from_not_found_list_id" IS NOT NULL
  ORDER BY l."copied_from_not_found_list_id", l."createdAt" ASC NULLS LAST, l."id"
) chosen
ON CONFLICT ("source_list_id") DO NOTHING;

-- Abort instead of guessing if this installation has an older or incompatible schema.
DO $check$
DECLARE incompatible TEXT;
BEGIN
  SELECT string_agg(expected.table_name || '.' || expected.column_name, ', ' ORDER BY expected.table_name, expected.column_name)
  INTO incompatible
  FROM (VALUES
      ('User', 'id', 'text', 'NO'),
      ('User', 'email', 'text', 'NO'),
      ('User', 'google_sub', 'text', 'YES'),
      ('User', 'password_enabled', 'bool', 'NO'),
      ('User', 'name', 'text', 'YES'),
      ('User', 'password', 'text', 'NO'),
      ('User', 'image', 'text', 'YES'),
      ('User', 'onboarding_completed_at', 'timestamp', 'YES'),
      ('User', 'onboarding_version', 'int4', 'YES'),
      ('User', 'tutorial_home_id', 'text', 'YES'),
      ('User', 'install_prompt_completed_at', 'timestamp', 'YES'),
      ('User', 'install_prompt_skipped_at', 'timestamp', 'YES'),
      ('User', 'plan', 'USER_PLAN', 'NO'),
      ('User', 'premium_home_slots', 'int4', 'NO'),
      ('User', 'premium_expires_at', 'timestamp', 'YES'),
      ('User', 'createdAt', 'timestamp', 'NO'),
      ('User', 'updatedAt', 'timestamp', 'NO'),
      ('Member', 'id', 'text', 'NO'),
      ('Member', 'user_id', 'text', 'NO'),
      ('Member', 'home_id', 'text', 'NO'),
      ('Member', 'role', 'ROLE', 'NO'),
      ('Invitation', 'id', 'text', 'NO'),
      ('Invitation', 'user_id', 'text', 'YES'),
      ('Invitation', 'email', 'text', 'YES'),
      ('Invitation', 'home_id', 'text', 'NO'),
      ('Invitation', 'createdAt', 'timestamp', 'NO'),
      ('ErrorLogin', 'id', 'text', 'NO'),
      ('ErrorLogin', 'user_id', 'text', 'NO'),
      ('ErrorLogin', 'date_try', 'timestamp', 'NO'),
      ('Home', 'id', 'text', 'NO'),
      ('Home', 'name', 'text', 'NO'),
      ('Home', 'image', 'text', 'YES'),
      ('Home', 'is_tutorial', 'bool', 'NO'),
      ('Home', 'premium_assigned_by_user_id', 'text', 'YES'),
      ('Home', 'premium_assigned_at', 'timestamp', 'YES'),
      ('Home', 'premium_locked_until', 'timestamp', 'YES'),
      ('Home', 'premium_ends_at', 'timestamp', 'YES'),
      ('Home', 'createdAt', 'timestamp', 'NO'),
      ('Home', 'updatedAt', 'timestamp', 'NO'),
      ('HomeFavorite', 'id', 'text', 'NO'),
      ('HomeFavorite', 'user_id', 'text', 'NO'),
      ('HomeFavorite', 'home_id', 'text', 'NO'),
      ('HomeFavorite', 'createdAt', 'timestamp', 'NO'),
      ('List', 'id', 'text', 'NO'),
      ('List', 'title', 'text', 'NO'),
      ('List', 'home_id', 'text', 'NO'),
      ('List', 'fav', 'bool', 'NO'),
      ('List', 'listCheck', 'bool', 'NO'),
      ('List', 'copied_from_not_found_list_id', 'text', 'YES'),
      ('List', 'createdAt', 'timestamp', 'YES'),
      ('List', 'updatedAt', 'timestamp', 'YES'),
      ('ItemList', 'id', 'text', 'NO'),
      ('ItemList', 'item_id', 'text', 'NO'),
      ('ItemList', 'list_id', 'text', 'NO'),
      ('ItemList', 'quantity', 'int4', 'NO'),
      ('ItemList', 'purchased_quantity', 'int4', 'NO'),
      ('ItemList', 'check_take', 'bool', 'NO'),
      ('ItemList', 'status', 'ITEM_LIST_STATUS', 'NO'),
      ('ItemList', 'created_mutation_id', 'text', 'YES'),
      ('ItemList', 'createdAt', 'timestamp', 'YES'),
      ('ItemList', 'updatedAt', 'timestamp', 'YES'),
      ('Item', 'id', 'text', 'NO'),
      ('Item', 'name', 'text', 'NO'),
      ('Item', 'home_id', 'text', 'NO'),
      ('Item', 'image', 'text', 'YES'),
      ('Item', 'price', 'text', 'YES'),
      ('Item', 'description', 'text', 'YES'),
      ('Item', 'categories', '_CATEGORY', 'YES'),
      ('Item', 'supermarket', 'SUPERMARKET', 'NO'),
      ('Item', 'is_recurring', 'bool', 'NO'),
      ('Item', 'createdAt', 'timestamp', 'YES'),
      ('Item', 'updatedAt', 'timestamp', 'YES'),
      ('WeeklyMenu', 'id', 'text', 'NO'),
      ('WeeklyMenu', 'home_id', 'text', 'NO'),
      ('WeeklyMenu', 'week_start', 'date', 'NO'),
      ('WeeklyMenu', 'created_by_user_id', 'text', 'YES'),
      ('WeeklyMenu', 'createdAt', 'timestamp', 'NO'),
      ('WeeklyMenu', 'updatedAt', 'timestamp', 'NO'),
      ('MenuMeal', 'id', 'text', 'NO'),
      ('MenuMeal', 'weekly_menu_id', 'text', 'NO'),
      ('MenuMeal', 'day_date', 'date', 'NO'),
      ('MenuMeal', 'type', 'MENU_MEAL_TYPE', 'NO'),
      ('MenuMeal', 'title', 'text', 'YES'),
      ('MenuMeal', 'notes', 'text', 'YES'),
      ('MenuMeal', 'createdAt', 'timestamp', 'NO'),
      ('MenuMeal', 'updatedAt', 'timestamp', 'NO'),
      ('MenuPublicToken', 'id', 'text', 'NO'),
      ('MenuPublicToken', 'home_id', 'text', 'NO'),
      ('MenuPublicToken', 'token', 'text', 'YES'),
      ('MenuPublicToken', 'token_hash', 'text', 'NO'),
      ('MenuPublicToken', 'name', 'text', 'YES'),
      ('MenuPublicToken', 'revokedAt', 'timestamp', 'YES'),
      ('MenuPublicToken', 'createdAt', 'timestamp', 'NO'),
      ('MenuPublicToken', 'updatedAt', 'timestamp', 'NO'),
      ('OneTimeToken', 'id', 'text', 'NO'),
      ('OneTimeToken', 'token', 'text', 'NO'),
      ('OneTimeToken', 'purpose', 'text', 'NO'),
      ('OneTimeToken', 'user_id', 'text', 'YES'),
      ('OneTimeToken', 'used', 'bool', 'NO'),
      ('OneTimeToken', 'expiresAt', 'timestamp', 'NO'),
      ('OneTimeToken', 'createdAt', 'timestamp', 'NO'),
      ('PendingRegistration', 'id', 'text', 'NO'),
      ('PendingRegistration', 'email', 'text', 'NO'),
      ('PendingRegistration', 'name', 'text', 'NO'),
      ('PendingRegistration', 'password', 'text', 'NO'),
      ('PendingRegistration', 'code_hash', 'text', 'NO'),
      ('PendingRegistration', 'invite_token', 'text', 'YES'),
      ('PendingRegistration', 'attempts', 'int4', 'NO'),
      ('PendingRegistration', 'expiresAt', 'timestamp', 'NO'),
      ('PendingRegistration', 'createdAt', 'timestamp', 'NO'),
      ('PendingRegistration', 'updatedAt', 'timestamp', 'NO'),
      ('ShoppingCarry', 'id', 'text', 'NO'),
      ('ShoppingCarry', 'source_list_id', 'text', 'NO'),
      ('ShoppingCarry', 'target_list_id', 'text', 'NO'),
      ('ShoppingCarry', 'created_by_user_id', 'text', 'YES'),
      ('ShoppingCarry', 'created_target', 'bool', 'NO'),
      ('ShoppingCarry', 'deltas', 'jsonb', 'NO'),
      ('ShoppingCarry', 'undone_at', 'timestamp', 'YES'),
      ('ShoppingCarry', 'createdAt', 'timestamp', 'NO'),
      ('ShoppingCarry', 'updatedAt', 'timestamp', 'NO'),
      ('ShoppingMutation', 'id', 'text', 'NO'),
      ('ShoppingMutation', 'list_id', 'text', 'NO'),
      ('ShoppingMutation', 'mutation_id', 'text', 'NO'),
      ('ShoppingMutation', 'user_id', 'text', 'NO'),
      ('ShoppingMutation', 'item_list_id', 'text', 'NO'),
      ('ShoppingMutation', 'operation', 'text', 'NO'),
      ('ShoppingMutation', 'createdAt', 'timestamp', 'NO')
  ) AS expected(table_name, column_name, udt_name, is_nullable)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
    AND actual.table_name = expected.table_name
    AND actual.column_name = expected.column_name
  WHERE actual.column_name IS NULL
     OR actual.udt_name <> expected.udt_name
     OR actual.is_nullable <> expected.is_nullable;
  IF incompatible IS NOT NULL THEN
    RAISE EXCEPTION 'NotApp updated schema incompatible: %', incompatible;
  END IF;
END $check$;
COMMIT;
