-- Rename the original demo destination only; preserve identities and API mappings.
UPDATE "branches"
SET "name" = 'PT. MMI'
WHERE "id" = 'branch-jakarta'
  AND "name" IN ('Jakarta', 'Jakarta · Cabang Utama');
