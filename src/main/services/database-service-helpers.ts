type TableColumnInfoLike = {
  name?: string | null;
};

export const DATABASE_SETUP_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS "devices" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "host" TEXT NOT NULL,
      "port" INTEGER NOT NULL DEFAULT 22,
      "connectionType" TEXT NOT NULL DEFAULT 'SSH',
      "description" TEXT,
      "enabled" INTEGER NOT NULL DEFAULT 1,
      "online" INTEGER NOT NULL DEFAULT 0,
      "lastConnected" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "nat_rules" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "deviceId" TEXT NOT NULL,
      "ruleName" TEXT NOT NULL,
      "protocol" TEXT NOT NULL,
      "globalIp" TEXT NOT NULL,
      "globalPort" TEXT NOT NULL,
      "insideIp" TEXT NOT NULL,
      "insidePort" TEXT NOT NULL,
      "enabled" INTEGER NOT NULL DEFAULT 1,
      "description" TEXT,
      "noReverse" INTEGER NOT NULL DEFAULT 0,
      "unrRoute" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE,
      UNIQUE("deviceId", "ruleName")
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "logs" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "level" TEXT NOT NULL,
      "operation" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "details" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "configs" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "key" TEXT NOT NULL UNIQUE,
      "value" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "credential_refs" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "deviceId" TEXT NOT NULL UNIQUE,
      "authType" TEXT NOT NULL,
      "username" TEXT,
      "secretRef" TEXT,
      "privateKey" TEXT,
      "certificate" TEXT,
      "mfaType" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS "idx_nat_rules_deviceId" ON "nat_rules"("deviceId")
  `,
  `
    CREATE INDEX IF NOT EXISTS "idx_logs_createdAt" ON "logs"("createdAt")
  `,
  `
    CREATE INDEX IF NOT EXISTS "idx_logs_level" ON "logs"("level")
  `,
] as const;

// Adds the option columns a NAT rule needs; existing rows default to "off".
export const buildNatRuleMigrationStatements = (
  tableInfo: readonly TableColumnInfoLike[]
): string[] =>
  ['noReverse', 'unrRoute']
    .filter((column) => !tableInfo.some((info) => info.name === column))
    .map((column) => `ALTER TABLE "nat_rules" ADD COLUMN "${column}" INTEGER NOT NULL DEFAULT 0`)
    // A column left by an older version may allow NULL, which the client cannot read.
    .concat(
      tableInfo.some((info) => info.name === 'unrRoute')
        ? ['UPDATE "nat_rules" SET "unrRoute" = 0 WHERE "unrRoute" IS NULL']
        : []
    );

export const REQUIRED_NAT_RULE_COLUMNS = ['noReverse', 'unrRoute'];
