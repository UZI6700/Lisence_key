-- Offline license files, authoritative subscription start, grace configuration and audit trail.

ALTER TABLE "licenses"
  ADD COLUMN "firstActivatedAt" TIMESTAMP(3),
  ADD COLUMN "durationDays" INTEGER NOT NULL DEFAULT 365,
  ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'standard';

CREATE TABLE "system_settings" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "description" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "license_validations" (
  "id" TEXT NOT NULL,
  "licenseId" TEXT NOT NULL,
  "deviceFingerprint" TEXT,
  "result" TEXT NOT NULL,
  "reason" TEXT,
  "clientTime" TIMESTAMP(3),
  "serverTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "license_validations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "license_validations_licenseId_createdAt_idx" ON "license_validations"("licenseId", "createdAt");

ALTER TABLE "license_validations"
  ADD CONSTRAINT "license_validations_licenseId_fkey"
  FOREIGN KEY ("licenseId") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
