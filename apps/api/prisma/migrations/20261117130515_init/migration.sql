-- CreateEnum
CREATE TYPE "VoyageStatus" AS ENUM ('PLANNED', 'UNDERWAY', 'ARRIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PortEventType" AS ENUM ('BERTH_DELAY', 'CONGESTION', 'CLOSURE', 'NONE');

-- CreateEnum
CREATE TYPE "RecommendationActionType" AS ENUM ('ADJUST_SPEED');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Port" (
    "id" TEXT NOT NULL,
    "unlocode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Port_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vessel" (
    "id" TEXT NOT NULL,
    "imo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dwt" DOUBLE PRECISION NOT NULL,
    "designSpeedKn" DOUBLE PRECISION NOT NULL,
    "minSpeedKn" DOUBLE PRECISION NOT NULL,
    "fuelTPerDayAtDesign" DOUBLE PRECISION NOT NULL,
    "auxFuelTPerDay" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Vessel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voyage" (
    "id" TEXT NOT NULL,
    "vesselId" TEXT NOT NULL,
    "originPortId" TEXT NOT NULL,
    "destPortId" TEXT NOT NULL,
    "departedAt" TIMESTAMP(3) NOT NULL,
    "speedKn" DOUBLE PRECISION NOT NULL,
    "sailedNmAtRebase" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rebasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plannedEta" TIMESTAMP(3) NOT NULL,
    "berthTime" TIMESTAMP(3),
    "status" "VoyageStatus" NOT NULL DEFAULT 'UNDERWAY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voyage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "fromAddr" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "queued" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortEvent" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "portId" TEXT,
    "voyageId" TEXT,
    "eventType" "PortEventType" NOT NULL,
    "delayHours" DOUBLE PRECISION,
    "newBerthTime" TIMESTAMP(3),
    "rawExtraction" JSONB NOT NULL,
    "sourceSpans" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "voyageId" TEXT NOT NULL,
    "portEventId" TEXT NOT NULL,
    "actionType" "RecommendationActionType" NOT NULL DEFAULT 'ADJUST_SPEED',
    "currentSpeedKn" DOUBLE PRECISION NOT NULL,
    "recommendedSpeedKn" DOUBLE PRECISION NOT NULL,
    "fuelSavedT" DOUBLE PRECISION NOT NULL,
    "costSavedEur" DOUBLE PRECISION NOT NULL,
    "co2SavedT" DOUBLE PRECISION NOT NULL,
    "calc" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Port_unlocode_key" ON "Port"("unlocode");

-- CreateIndex
CREATE UNIQUE INDEX "Vessel_imo_key" ON "Vessel"("imo");

-- AddForeignKey
ALTER TABLE "Voyage" ADD CONSTRAINT "Voyage_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "Vessel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voyage" ADD CONSTRAINT "Voyage_originPortId_fkey" FOREIGN KEY ("originPortId") REFERENCES "Port"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voyage" ADD CONSTRAINT "Voyage_destPortId_fkey" FOREIGN KEY ("destPortId") REFERENCES "Port"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortEvent" ADD CONSTRAINT "PortEvent_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortEvent" ADD CONSTRAINT "PortEvent_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortEvent" ADD CONSTRAINT "PortEvent_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_portEventId_fkey" FOREIGN KEY ("portEventId") REFERENCES "PortEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
