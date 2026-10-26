-- One workspace-level (master) WhatsApp connection, independent of journeys.
-- Additive only: the legacy per-journey "Connection" table is left untouched.

-- CreateTable
CREATE TABLE "WorkspaceConnection" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'master',
    "businessName" TEXT,
    "phoneNumber" TEXT,
    "phoneNumberId" TEXT,
    "wabaId" TEXT,
    "systemUserId" TEXT,
    "systemUserName" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "qualityRating" TEXT,
    "codeVerificationStatus" TEXT,
    "nameStatus" TEXT,
    "healthCheckedAt" TIMESTAMP(3),
    "accessToken" TEXT,
    "appId" TEXT,
    "appSecret" TEXT,
    "verifyToken" TEXT,
    "updatedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceConnection_key_key" ON "WorkspaceConnection"("key");

-- Seed the master from the most recently updated working per-journey
-- connection, so the number stays connected through this change.
INSERT INTO "WorkspaceConnection" (
    "id", "key", "businessName", "phoneNumber", "phoneNumberId", "wabaId",
    "systemUserId", "systemUserName", "status", "qualityRating",
    "codeVerificationStatus", "nameStatus", "healthCheckedAt",
    "accessToken", "appId", "appSecret", "verifyToken", "updatedByEmail",
    "createdAt", "updatedAt"
)
SELECT
    'master_' || "id", 'master', "businessName", "phoneNumber", "phoneNumberId", "wabaId",
    "systemUserId", "systemUserName", "status", "qualityRating",
    "codeVerificationStatus", "nameStatus", "healthCheckedAt",
    "accessToken", "appId", "appSecret", "verifyToken", 'migrated-from-journey',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Connection"
WHERE "status" = 'CONNECTED' AND "accessToken" IS NOT NULL AND "phoneNumberId" IS NOT NULL
ORDER BY "updatedAt" DESC
LIMIT 1;
