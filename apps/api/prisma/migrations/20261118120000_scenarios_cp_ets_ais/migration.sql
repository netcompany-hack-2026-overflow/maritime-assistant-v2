-- CreateEnum
CREATE TYPE "OutboundEmailStatus" AS ENUM ('DRAFT', 'SENT', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Vessel" ADD COLUMN     "aisAt" TIMESTAMP(3),
ADD COLUMN     "aisCogDeg" DOUBLE PRECISION,
ADD COLUMN     "aisLat" DOUBLE PRECISION,
ADD COLUMN     "aisLon" DOUBLE PRECISION,
ADD COLUMN     "aisSogKn" DOUBLE PRECISION,
ADD COLUMN     "mmsi" TEXT,
ADD COLUMN     "ytdCo2T" DOUBLE PRECISION,
ADD COLUMN     "ytdDistanceNm" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "chosenScenario" TEXT,
ADD COLUMN     "demurrageAvoided" DOUBLE PRECISION,
ADD COLUMN     "etsSavedEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "scenarios" JSONB;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "euaPriceEurPerT" DOUBLE PRECISION NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "CharterParty" (
    "id" TEXT NOT NULL,
    "voyageId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "expectedOpsHours" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharterParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundEmail" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "toAddrs" TEXT NOT NULL,
    "ccAddrs" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "OutboundEmailStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharterParty_voyageId_key" ON "CharterParty"("voyageId");

-- CreateIndex
CREATE UNIQUE INDEX "Vessel_mmsi_key" ON "Vessel"("mmsi");

-- AddForeignKey
ALTER TABLE "CharterParty" ADD CONSTRAINT "CharterParty_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

