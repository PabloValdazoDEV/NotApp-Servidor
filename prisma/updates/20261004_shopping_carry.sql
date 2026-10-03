-- Non-destructive update for an existing NotApp database. Apply after a DB backup.
-- Existing lists, products, results and quantities are retained unchanged.
BEGIN;
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
COMMIT;
