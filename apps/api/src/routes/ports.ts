import { Router } from "express";
import type { SeaRouteDTO } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { routeBetweenPorts } from "../services/seaRoute.js";

export const portsRouter = Router();

portsRouter.get("/", async (_req, res, next) => {
  try {
    const ports = await prisma.port.findMany({ orderBy: { name: "asc" } });
    res.json(ports);
  } catch (err) {
    next(err);
  }
});

/** Sea route between two ports by UN/LOCODE: GET /api/ports/route?from=GRPIR&to=NLRTM */
portsRouter.get("/route", async (req, res, next) => {
  try {
    const from = String(req.query.from ?? "").trim().toUpperCase();
    const to = String(req.query.to ?? "").trim().toUpperCase();
    if (!from || !to) return res.status(400).json({ error: "Χρειάζονται τα from και to" });
    if (from === to) return res.status(400).json({ error: "Τα from και to πρέπει να διαφέρουν" });

    const [origin, dest] = await Promise.all([
      prisma.port.findUnique({ where: { unlocode: from } }),
      prisma.port.findUnique({ where: { unlocode: to } }),
    ]);
    if (!origin || !dest) return res.status(404).json({ error: "Το λιμάνι δεν βρέθηκε" });

    const route = routeBetweenPorts(origin, dest);
    const dto: SeaRouteDTO = { from, to, coords: route.coords, distanceNm: route.lengthNm };
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
