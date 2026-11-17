import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { computeVesselPositions } from "../sim/positions.js";

export const vesselsRouter = Router();

vesselsRouter.get("/", async (_req, res, next) => {
  try {
    const vessels = await prisma.vessel.findMany({
      orderBy: { name: "asc" },
      include: {
        voyages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { destPort: true, originPort: true },
        },
      },
    });

    res.json(
      vessels.map((v) => {
        const voyage = v.voyages[0] ?? null;
        return {
          id: v.id,
          imo: v.imo,
          name: v.name,
          type: v.type,
          dwt: v.dwt,
          designSpeedKn: v.designSpeedKn,
          minSpeedKn: v.minSpeedKn,
          fuelTPerDayAtDesign: v.fuelTPerDayAtDesign,
          auxFuelTPerDay: v.auxFuelTPerDay,
          status: voyage?.status ?? "IDLE",
          speedKn: voyage?.speedKn ?? null,
          destPort: voyage?.destPort.name ?? null,
          originPort: voyage?.originPort.name ?? null,
          voyageId: voyage?.id ?? null,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

vesselsRouter.get("/positions", async (_req, res, next) => {
  try {
    const positions = await computeVesselPositions(env.simSpeed);
    res.json(positions);
  } catch (err) {
    next(err);
  }
});
