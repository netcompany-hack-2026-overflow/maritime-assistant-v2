import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { routeBetweenPorts } from "../services/seaRoute.js";
import { calculateVoyageCII } from "../services/cii.js";
import { charterPartyRouter } from "./charter-parties.js";

export const voyagesRouter = Router();

voyagesRouter.use("/:voyageId/charter-party", charterPartyRouter);

const include = { vessel: true, originPort: true, destPort: true, charterParty: { select: { id: true, sourceName: true } } } as const;

type VoyageWithRelations = Prisma.VoyageGetPayload<{ include: typeof include }>;

function serializeVoyage(v: VoyageWithRelations) {
  return {
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
    routeNm: v.routeNm,
    charterParty: v.charterParty,
    status: v.status,
    ciiAttained: v.ciiAttained,
    ciiRating: v.ciiRating,
    createdAt: v.createdAt.toISOString(),
  };
}

voyagesRouter.get("/", async (_req, res, next) => {
  try {
    const voyages = await prisma.voyage.findMany({
      orderBy: { createdAt: "desc" },
      include,
    });
    res.json(voyages.map(serializeVoyage));
  } catch (err) {
    next(err);
  }
});

voyagesRouter.post(
  "/",
  body("vesselId").isString().trim().notEmpty(),
  body("originPortId").isString().trim().notEmpty(),
  body("destPortId").isString().trim().notEmpty(),
  body("speedKn").optional().isFloat({ gt: 0 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: "Μη έγκυρο αίτημα", details: errors.array() });
      }
      const vesselId = req.body?.vesselId as string;
      const originPortId = req.body?.originPortId as string;
      const destPortId = req.body?.destPortId as string;

      if (originPortId === destPortId) {
        return res.status(400).json({ error: "Τα λιμάνια αναχώρησης και προορισμού πρέπει να διαφέρουν." });
      }

      const [vessel, originPort, destPort] = await Promise.all([
        prisma.vessel.findUnique({ where: { id: vesselId } }),
        prisma.port.findUnique({ where: { id: originPortId } }),
        prisma.port.findUnique({ where: { id: destPortId } }),
      ]);
      if (!vessel) return res.status(404).json({ error: "Το πλοίο δεν βρέθηκε" });
      if (!originPort || !destPort) return res.status(404).json({ error: "Το λιμάνι δεν βρέθηκε" });

      const activeVoyage = await prisma.voyage.findFirst({
        where: { vesselId, status: { in: ["UNDERWAY", "PLANNED"] } },
      });
      if (activeVoyage) {
        return res.status(400).json({ error: `Το ${vessel.name} έχει ήδη ενεργό ταξίδι.` });
      }

      const speedKn = req.body?.speedKn ? Number(req.body.speedKn) : vessel.designSpeedKn;
      const departedAt = new Date();
      // ETA is based on the sea route, not the straight line between ports.
      const route = routeBetweenPorts(originPort, destPort);
      const plannedEta = new Date(departedAt.getTime() + (route.lengthNm / speedKn) * 3_600_000);

      const cii = calculateVoyageCII({
        dwt: vessel.dwt,
        distanceNm: route.lengthNm,
        speedKn,
        designSpeedKn: vessel.designSpeedKn,
        fuelTPerDayAtDesign: vessel.fuelTPerDayAtDesign,
        auxFuelTPerDay: vessel.auxFuelTPerDay,
        vesselType: vessel.type,
        });



      const voyage = await prisma.voyage.create({
        data: {
          vesselId,
          originPortId,
          destPortId,
          departedAt,
          speedKn,
          sailedNmAtRebase: 0,
          rebasedAt: departedAt,
          plannedEta,
          routeCoords: route.coords as unknown as Prisma.InputJsonValue,
          routeNm: route.lengthNm,
          status: "UNDERWAY",
          ciiAttained: cii.attained,
          ciiRating: cii.rating,
        },
        include,
      });

      res.status(201).json(serializeVoyage(voyage));
    } catch (err) {
      next(err);
    }
  }
);

voyagesRouter.patch(
  "/:id/cancel",
  param("id").isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const id = req.params?.id;
      if (!id) return res.status(400).json({ error: "Μη έγκυρο αίτημα" });

      const voyage = await prisma.voyage.findUnique({ where: { id } });
      if (!voyage) return res.status(404).json({ error: "Το ταξίδι δεν βρέθηκε" });
      if (voyage.status !== "UNDERWAY" && voyage.status !== "PLANNED") {
        return res.status(400).json({ error: "Ακυρώνονται μόνο ταξίδια σε εξέλιξη ή προγραμματισμένα." });
      }

      const updated = await prisma.voyage.update({
        where: { id },
        data: { status: "CANCELLED" },
        include,
      });
      res.json(serializeVoyage(updated));
    } catch (err) {
      next(err);
    }
  }
);
