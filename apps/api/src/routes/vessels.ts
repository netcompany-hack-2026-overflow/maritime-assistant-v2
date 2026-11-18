import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { computeVesselPositions } from "../sim/positions.js";
import { aisTracker } from "../services/ais.js";

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
          ytdCo2T: v.ytdCo2T,
          ytdDistanceNm: v.ytdDistanceNm,
          mmsi: v.mmsi,
          aisAt: v.aisAt ? v.aisAt.toISOString() : null,
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

/** Link a vessel to live AIS by MMSI (9 digits), or unlink with null. */
vesselsRouter.put("/:id/ais", async (req, res, next) => {
  try {
    const raw = req.body?.mmsi;
    const mmsi = raw === null || raw === "" ? null : String(raw ?? "").trim();
    if (mmsi !== null && !/^\d{9}$/.test(mmsi)) {
      return res.status(400).json({ error: "An MMSI is 9 digits, e.g. 240123000." });
    }
    const vessel = await prisma.vessel.findUnique({ where: { id: req.params.id } });
    if (!vessel) return res.status(404).json({ error: "Vessel not found" });
    if (mmsi) {
      const taken = await prisma.vessel.findFirst({ where: { mmsi, id: { not: vessel.id } } });
      if (taken) return res.status(409).json({ error: `MMSI ${mmsi} is already linked to ${taken.name}.` });
    }
    const updated = await prisma.vessel.update({
      where: { id: vessel.id },
      // A new link starts without a fix; the old ship's position must not carry over.
      data: { mmsi, aisLat: null, aisLon: null, aisSogKn: null, aisCogDeg: null, aisAt: null },
    });
    await aisTracker.refresh();
    res.json({ id: updated.id, mmsi: updated.mmsi, ais: aisTracker.status() });
  } catch (err) {
    next(err);
  }
});
