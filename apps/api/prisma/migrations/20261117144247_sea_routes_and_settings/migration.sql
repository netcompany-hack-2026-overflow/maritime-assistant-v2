-- AlterTable
ALTER TABLE "Voyage" ADD COLUMN     "routeCoords" JSONB,
ADD COLUMN     "routeNm" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "fuelPriceEurPerT" DOUBLE PRECISION NOT NULL,
    "co2Factor" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);
