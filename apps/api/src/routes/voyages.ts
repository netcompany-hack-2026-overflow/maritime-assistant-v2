import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import type { Prisma } from "@prisma/client";
import { haversineNm } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";

export const voyagesRouter = Router();

const include = { vessel: true, originPort: true, destPort: true } as const;

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
    status: v.status,
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
        return res.status(400).json({ error: "Invalid request", details: errors.array() });
      }
      const vesselId = req.body?.vesselId as string;
      const originPortId = req.body?.originPortId as string;
      const destPortId = req.body?.destPortId as string;

      if (originPortId === destPortId) {
        return res.status(400).json({ error: "Origin and destination ports must be different." });
      }

      const [vessel, originPort, destPort] = await Promise.all([
        prisma.vessel.findUnique({ where: { id: vesselId } }),
        prisma.port.findUnique({ where: { id: originPortId } }),
        prisma.port.findUnique({ where: { id: destPortId } }),
      ]);
      if (!vessel) return res.status(404).json({ error: "Vessel not found" });
      if (!originPort || !destPort) return res.status(404).json({ error: "Port not found" });

      const activeVoyage = await prisma.voyage.findFirst({
        where: { vesselId, status: { in: ["UNDERWAY", "PLANNED"] } },
      });
      if (activeVoyage) {
        return res.status(400).json({ error: `${vessel.name} already has an active voyage.` });
      }

      const speedKn = req.body?.speedKn ? Number(req.body.speedKn) : vessel.designSpeedKn;
      const departedAt = new Date();
      const distanceNm = haversineNm(
        { lat: originPort.lat, lon: originPort.lon },
        { lat: destPort.lat, lon: destPort.lon }
      );
      const plannedEta = new Date(departedAt.getTime() + (distanceNm / speedKn) * 3_600_000);

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
          status: "UNDERWAY",
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
      if (!id) return res.status(400).json({ error: "Invalid request" });

      const voyage = await prisma.voyage.findUnique({ where: { id } });
      if (!voyage) return res.status(404).json({ error: "Voyage not found" });
      if (voyage.status !== "UNDERWAY" && voyage.status !== "PLANNED") {
        return res.status(400).json({ error: "Only underway or planned voyages can be cancelled." });
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
