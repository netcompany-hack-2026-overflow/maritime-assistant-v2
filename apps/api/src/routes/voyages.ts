import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const voyagesRouter = Router();

voyagesRouter.get("/", async (_req, res, next) => {
  try {
    const voyages = await prisma.voyage.findMany({
      orderBy: { createdAt: "desc" },
      include: { vessel: true, originPort: true, destPort: true },
    });

    res.json(
      voyages.map((v) => ({
        id: v.id,
        vesselId: v.vesselId,
        vesselName: v.vessel.name,
        vesselImo: v.vessel.imo,
        vesselType: v.vessel.type,
        originPortId: v.originPortId,
        originPortName: v.originPort.name,
        destPortId: v.destPortId,
        destPortName: v.destPort.name,
        departedAt: v.departedAt.toISOString(),
        speedKn: v.speedKn,
        sailedNmAtRebase: v.sailedNmAtRebase,
        rebasedAt: v.rebasedAt.toISOString(),
        plannedEta: v.plannedEta.toISOString(),
        berthTime: v.berthTime ? v.berthTime.toISOString() : null,
        status: v.status,
        createdAt: v.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    next(err);
  }
});
