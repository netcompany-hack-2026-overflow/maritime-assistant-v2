import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const portEventsRouter = Router();

portEventsRouter.get("/", async (_req, res, next) => {
  try {
    const events = await prisma.portEvent.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        email: true,
        port: true,
        voyage: { include: { vessel: true, originPort: true, destPort: true } },
      },
    });
    res.json(events);
  } catch (err) {
    next(err);
  }
});
