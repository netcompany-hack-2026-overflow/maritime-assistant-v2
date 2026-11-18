-- CreateEnum
CREATE TYPE "EmailDraftKind" AS ENUM ('ACCEPT', 'COUNTER', 'DECLINE');

-- CreateEnum
CREATE TYPE "EmailDraftStatus" AS ENUM ('DRAFT', 'SENT', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "Vessel" ADD COLUMN     "charterRateUsdPerDay" DOUBLE PRECISION NOT NULL DEFAULT 15000;

-- AlterTable
ALTER TABLE "PortEvent" ADD COLUMN     "offerTerms" JSONB;

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "bunkerPlan" JSONB,
ADD COLUMN     "chosenOption" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "bunkerPumpRateTPerH" DOUBLE PRECISION NOT NULL DEFAULT 250,
ADD COLUMN     "bunkerSlackToleranceMin" DOUBLE PRECISION NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "kind" "EmailDraftKind" NOT NULL,
    "optionKey" TEXT,
    "toAddr" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "EmailDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emailDomain" TEXT NOT NULL,
    "reliabilityScore" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailDraft_recommendationId_idx" ON "EmailDraft"("recommendationId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_emailDomain_key" ON "Supplier"("emailDomain");

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

