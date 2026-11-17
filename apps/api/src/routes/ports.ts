import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const portsRouter = Router();

portsRouter.get("/", async (_req, res, next) => {
  try {
    const ports = await prisma.port.findMany({ orderBy: { name: "asc" } });
    res.json(ports);
  } catch (err) {
    next(err);
  }
});
