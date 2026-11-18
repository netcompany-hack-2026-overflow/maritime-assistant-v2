import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BunkerCalc } from "@maritime/shared";
import { routeBetweenPorts } from "../seaRoute.js";

// In-memory stand-in for the Prisma calls processEmail makes for a bunker offer.
const db = vi.hoisted(() => ({
  emails: [] as Array<{ id: string; subject: string; body: string; processed: boolean }>,
  ports: [] as Array<{ id: string; unlocode: string; name: string; lat: number; lon: number }>,
  voyages: [] as Array<Record<string, unknown>>,
  latestBerthEvent: null as null | { newBerthTime: Date },
  portEvents: [] as Array<Record<string, unknown>>,
  recs: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../lib/prisma.js", () => {
  const client = {
    email: {
      findUnique: async ({ where }: { where: { id: string } }) => db.emails.find((e) => e.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: object }) =>
        Object.assign(db.emails.find((e) => e.id === where.id)!, data),
    },
    port: {
      findUnique: async ({ where }: { where: { unlocode: string } }) =>
        db.ports.find((p) => p.unlocode === where.unlocode) ?? null,
      findFirst: async () => null,
    },
    voyage: { findMany: async () => db.voyages },
    portEvent: {
      // Only used to find the latest reported berth time for the voyage.
      findFirst: async () => db.latestBerthEvent,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const ev = { ...data, id: `ev${db.portEvents.length + 1}`, port: db.ports.find((p) => p.id === data.portId) ?? null };
        db.portEvents.push(ev);
        return ev;
      },
    },
    recommendation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const rec = { ...data, id: `r${db.recs.length + 1}` };
        db.recs.push(rec);
        return rec;
      },
    },
    settings: {
      upsert: async () => ({ fuelPriceEurPerT: 600, co2Factor: 3.114, updatedAt: new Date() }),
    },
  };
  return { prisma: client };
});

const { processEmail } = await import("../emailProcessing.js");

const PIRAEUS = { lat: 37.9475, lon: 23.6367 };
const ROTTERDAM = { id: "pRTM", unlocode: "NLRTM", name: "Rotterdam", lat: 51.9496, lon: 4.1453 };
const ALGECIRAS = { id: "pALG", unlocode: "ESALG", name: "Algeciras", lat: 36.1246, lon: -5.4418 };
const GENOA = { id: "pGOA", unlocode: "ITGOA", name: "Genoa", lat: 44.4056, lon: 8.9463 };
const route = routeBetweenPorts(PIRAEUS, ROTTERDAM);

/** MV Aegean Star as seeded: 1,700 nm from Rotterdam at its top speed, ~320 nm east of Gibraltar. */
function aegeanStar() {
  return {
    id: "v1",
    speedKn: 14,
    plannedEta: new Date(Date.now() + (1700 / 14) * 3_600_000),
    berthTime: null,
    routeCoords: route.coords,
    vessel: { name: "MV Aegean Star", designSpeedKn: 14, minSpeedKn: 9, fuelTPerDayAtDesign: 40, auxFuelTPerDay: 3 },
    originPort: { name: "Piraeus", ...PIRAEUS },
    destPort: ROTTERDAM,
  };
}

const offer = (port: string, code: string, price: number, qty: string, vessel = "For MV Aegean Star, bound for Rotterdam, ") => ({
  id: `e-${port}`,
  processed: false,
  subject: `Bunker offer - VLSFO at ${port}`,
  body: `Dear Sirs,\n\n${vessel}we are pleased to offer VLSFO delivered at ${port} (${code}) at USD ${price}/mt, ${qty}.\n\nBest regards,\nTest Bunkers`,
});

const calcOf = (rec: Record<string, unknown>) => rec.calc as BunkerCalc;

beforeEach(() => {
  db.ports = [ROTTERDAM, ALGECIRAS, GENOA];
  db.voyages = [aegeanStar()];
  db.latestBerthEvent = null;
  db.portEvents = [];
  db.recs = [];
  db.emails = [
    offer("Algeciras", "ESALG", 540, "800-1,200 mt"),
    offer("Genoa", "ITGOA", 520, "500 mt"),
    { ...offer("Genoa", "ITGOA", 520, "500 mt", ""), id: "e-Genoa-unnamed" },
    { ...offer("Algeciras", "ESALG", 540, "800-1,200 mt", ""), id: "e-Algeciras-unnamed" },
  ];
});

describe("processEmail: bunker offers", () => {
  it("stores the offer fields on the port event", async () => {
    await processEmail("e-Algeciras");
    expect(db.portEvents[0]).toMatchObject({
      eventType: "BUNKER_OFFER",
      portId: "pALG",
      voyageId: "v1",
      fuelGrade: "VLSFO",
      priceUsdPerT: 540,
      qtyMinT: 800,
      qtyMaxT: 1200,
    });
  });

  it("an offer the ship can't fit in stays pending, flagged not worth it (late)", async () => {
    const { recommendation } = await processEmail("e-Algeciras");
    const rec = recommendation as Record<string, unknown>;
    expect(rec).toMatchObject({ actionType: "BUNKER_DETOUR", status: "PENDING" });
    expect(rec.rejectReason ?? null).toBeNull();
    expect(calcOf(rec).verdict).toBe("NOT_WORTH_IT");
    expect(calcOf(rec).reasons).toEqual(["LATE"]);
    expect(calcOf(rec).offRouteNm).toBeLessThan(20); // Algeciras is right by the route
  });

  it("a reported berth delay gives the ship slack, so the same offer becomes worth it", async () => {
    db.latestBerthEvent = { newBerthTime: new Date((db.voyages[0].plannedEta as Date).getTime() + 24 * 3_600_000) };
    const { recommendation } = await processEmail("e-Algeciras");
    const rec = recommendation as Record<string, unknown>;
    expect(rec.status).toBe("PENDING");
    expect(calcOf(rec).verdict).toBe("WORTH_IT");
    expect(rec.costSavedEur).toBeGreaterThan(80_000);
    expect(rec.costSavedEur).toBe(calcOf(rec).netEur);
    expect(rec.fuelSavedT).toBe(-calcOf(rec).extraFuelT); // the detour burns extra fuel
  });

  it("a far-off offer for a named ship is priced and flagged as losing money", async () => {
    db.latestBerthEvent = { newBerthTime: new Date((db.voyages[0].plannedEta as Date).getTime() + 24 * 3_600_000) };
    const { recommendation } = await processEmail("e-Genoa");
    const c = calcOf(recommendation as Record<string, unknown>);
    expect((recommendation as Record<string, unknown>).status).toBe("PENDING");
    expect(c.offRouteNm).toBeGreaterThan(400); // measured over water, not across the Alps
    expect(c.reasons).toContain("NEGATIVE_NET");
  });

  it("an unnamed offer is matched to a ship passing nearby", async () => {
    const { matchedVoyage } = await processEmail("e-Algeciras-unnamed");
    expect(matchedVoyage?.id).toBe("v1");
  });

  it("an unnamed offer nowhere near any ship's route matches nothing", async () => {
    const { matchedVoyage, recommendation } = await processEmail("e-Genoa-unnamed");
    expect(matchedVoyage).toBeNull();
    expect(recommendation).toBeNull();
    expect(db.portEvents[0]).toMatchObject({ eventType: "BUNKER_OFFER", voyageId: null });
  });
});
