-- AlterTable
ALTER TABLE "Vessel" ADD COLUMN     "hullValueUsd" DOUBLE PRECISION NOT NULL DEFAULT 25000000;

-- AlterTable
ALTER TABLE "Voyage" ADD COLUMN     "insurance" JSONB;
