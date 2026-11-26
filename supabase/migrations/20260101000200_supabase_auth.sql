-- Link local application users to Supabase Auth identities.
-- Existing rows are matched by email on first Supabase login and linked there.
ALTER TABLE "users" ADD COLUMN "supabaseId" TEXT;

CREATE UNIQUE INDEX "users_supabaseId_key" ON "users"("supabaseId");
