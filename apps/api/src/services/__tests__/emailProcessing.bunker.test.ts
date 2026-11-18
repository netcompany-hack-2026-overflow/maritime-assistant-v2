import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BunkerCalc, BunkerPlan, OfferTerms } from "@maritime/shared";
import { routeBetweenPorts } from "../seaRoute.js";

// In-memory stand-in for the Prisma calls processEmail makes for a bunker offer.
const db = vi.hoisted(() => ({
  emails: [] as Array<{ id: string; fromAddr: string; subject: string; body: string; processed: boolean; receivedAt: Date }>,
  ports: [] as Array<{ id: string; unlocode: string; name: string; lat: number; lon: number }>,
  voyages: [] as Array<Record<string, unknown>>,
  latestBerthEvent: null as null | { newBerthTime: Date },
  /** Congestion/closure reports the bunker port lookup finds. */
  portConditions: [] as Array<{ portId: string; eventType: string; delayHours: number }>,
  portEvents: [] as Array<Record<string, unknown>>,
  recs: [] as Array<Record<string, unknown>>,
  drafts: [] as Array<Record<string, unknown>>,
  llmCalls: 0,
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
      // Only used to find congestion/closure at the bunker port.
      findMany: async ({ where }: { where: { portId: string } }) => db.portConditions.filter((c) => c.portId === where.portId),
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
    emailDraft: {
      findMany: async ({ where }: { where: { recommendationId: string } }) =>
        db.drafts.filter((d) => d.recommendationId === where.recommendationId),
      deleteMany: async ({ where }: { where: { recommendationId: string } }) => {
        db.drafts = db.drafts.filter((d) => !(d.recommendationId === where.recommendationId && d.status === "DRAFT" && !d.edited));
      },
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const d of data) db.drafts.push({ ...d, status: "DRAFT", edited: false });
      },
    },
    settings: {
      upsert: async () => ({ fuelPriceEurPerT: 600, co2Factor: 3.114, updatedAt: new Date() }),
    },
  };
  return { prisma: client };
});

vi.mock("../../llm/index.js", async () => {
  const mock = await import("../../llm/mock.js");
  return {
    getLlmProvider: () => ({
      extractEmail: mock.mockExtractEmail,
      explainRecommendation: async (facts: Parameters<typeof mock.mockExplainRecommendation>[0]) => {
        db.llmCalls++;
        return mock.mockExplainRecommendation(facts);
      },
    }),
  };
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
    vessel: { name: "MV Aegean Star", imo: "9000001", designSpeedKn: 14, minSpeedKn: 9, fuelTPerDayAtDesign: 40, auxFuelTPerDay: 3 },
    originPort: { name: "Piraeus", ...PIRAEUS },
    destPort: ROTTERDAM,
  };
}

const offer = (port: string, code: string, price: number, qty: string, vessel = "For MV Aegean Star, bound for Rotterdam, ", extra = "") => ({
  id: `e-${port}`,
  fromAddr: "trading@test-bunkers.example",
  processed: false,
  receivedAt: new Date("2026-11-20T10:00:00Z"),
  subject: `Bunker offer - VLSFO at ${port}`,
  body: `Dear Sirs,\n\n${vessel}we are pleased to offer VLSFO delivered at ${port} (${code}) at USD ${price}/mt, ${qty}.${extra}\n\nBest regards,\nTest Bunkers`,
});

const calcOf = (rec: Record<string, unknown>) => rec.calc as BunkerCalc;
const planOf = (rec: Record<string, unknown>) => rec.bunkerPlan as BunkerPlan;
const draftKinds = () => db.drafts.map((d) => `${d.kind}:${d.optionKey ?? ""}`);
const giveSlack = (hours = 24) => {
  db.latestBerthEvent = { newBerthTime: new Date((db.voyages[0].plannedEta as Date).getTime() + hours * 3_600_000) };
};

beforeEach(() => {
  db.ports = [ROTTERDAM, ALGECIRAS, GENOA];
  db.voyages = [aegeanStar()];
  db.latestBerthEvent = null;
  db.portConditions = [];
  db.portEvents = [];
  db.recs = [];
  db.drafts = [];
  db.llmCalls = 0;
  db.emails = [
    offer("Algeciras", "ESALG", 540, "800-1,200 mt"),
    offer("Genoa", "ITGOA", 520, "500 mt"),
    { ...offer("Genoa", "ITGOA", 520, "500 mt", ""), id: "e-Genoa-unnamed" },
    { ...offer("Algeciras", "ESALG", 540, "800-1,200 mt", ""), id: "e-Algeciras-unnamed" },
    { ...offer("Algeciras", "ESALG", 540, "800-1,200 mt", "For IMO 9000001 ", " Barge alongside within 6 hours of arrival. Firm 30 mins"), id: "e-Algeciras-imo" },
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
    giveSlack();
    const { recommendation } = await processEmail("e-Algeciras");
    const rec = recommendation as Record<string, unknown>;
    expect(rec.status).toBe("PENDING");
    expect(calcOf(rec).verdict).toBe("WORTH_IT");
    expect(rec.costSavedEur).toBeGreaterThan(50_000);
    expect(rec.costSavedEur).toBe(calcOf(rec).netEur);
    expect(rec.fuelSavedT).toBe(-calcOf(rec).extraFuelT); // the detour burns extra fuel
  });

  it("a far-off offer for a named ship is priced and flagged as losing money", async () => {
    giveSlack();
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

describe("processEmail: bunker options and reply drafts", () => {
  it("with slack: stores ECO and KEEP_SPEED options, the reshaped route, and one reply per choice", async () => {
    giveSlack();
    const { recommendation } = await processEmail("e-Algeciras");
    const rec = recommendation as Record<string, unknown>;
    const plan = planOf(rec);
    expect(plan.screen.passed).toBe(true);
    expect(plan.options.map((o) => o.key)).toEqual(["ECO", "KEEP_SPEED"]);
    expect(rec.calc).toEqual(plan.options[0].calc); // the card shows the best option
    expect(plan.options[0].calc.qtyT).toBe(800); // the stem, inside the offered 800-1,200 t
    expect(plan.route.before.length).toBeGreaterThan(1);
    expect(plan.route.after.at(-1)).toEqual({ lat: ROTTERDAM.lat, lon: ROTTERDAM.lon });
    expect(plan.context).toMatchObject({ supplierAddr: "trading@test-bunkers.example", vesselImo: "9000001", portUnlocode: "ESALG" });
    expect(draftKinds()).toEqual(["ACCEPT:ECO", "ACCEPT:KEEP_SPEED", "DECLINE:"]);
    expect(db.llmCalls).toBe(1);
  });

  it("without slack: stops at the time check, no model call, only a decline", async () => {
    const { recommendation } = await processEmail("e-Algeciras");
    const rec = recommendation as Record<string, unknown>;
    expect(planOf(rec).screen).toMatchObject({ passed: false, stoppedBecause: "TIME" });
    expect(planOf(rec).options).toEqual([]);
    expect(rec.rationale).toMatch(/^Not analysed further: calling at Algeciras needs about/);
    expect(db.llmCalls).toBe(0);
    expect(draftKinds()).toEqual(["DECLINE:"]);
  });

  it("finds the ship by IMO number, counts the supplier's barge window and starts the quote clock", async () => {
    giveSlack();
    const { matchedVoyage, recommendation } = await processEmail("e-Algeciras-imo");
    expect(matchedVoyage?.id).toBe("v1");
    const terms = db.portEvents[0].offerTerms as OfferTerms;
    expect(terms).toMatchObject({ vesselImo: "9000001", deliveryDelayHours: 6, quoteValidityMinutes: 30 });
    expect(terms.quoteFirmUntil).toBe("2026-11-20T10:30:00.000Z");
    expect(planOf(recommendation as Record<string, unknown>).screen.delayHours).toBe(6);
  });

  it("congestion reported at the bunker port counts as a likely delay", async () => {
    giveSlack();
    db.portConditions = [{ portId: "pALG", eventType: "CONGESTION", delayHours: 10 }];
    const { recommendation } = await processEmail("e-Algeciras");
    const plan = planOf(recommendation as Record<string, unknown>);
    expect(plan.input.delays).toEqual([{ source: "PORT_CONGESTION", hours: 10, note: "Algeciras congestion reported: +10 h" }]);
    expect(plan.screen.delayHours).toBe(10);
  });
});

describe("the four demo supplier quotes, end to end (parser → ship → plan → comparison)", async () => {
  const { readFileSync } = await import("node:fs");
  const { compareOffers, explainComparison, DEFAULT_TCO } = await import("@maritime/shared");
  const demo = JSON.parse(readFileSync(new URL("../../../prisma/mock_demo_data.json", import.meta.url), "utf-8")) as {
    emails: Array<{ id: string; fromAddr: string; subject: string; body: string }>;
  };
  const GIBRALTAR = { id: "pGIB", unlocode: "GIGIB", name: "Gibraltar", lat: 36.1408, lon: -5.3536 };
  const CEUTA = { id: "pCEU", unlocode: "ESCEU", name: "Ceuta", lat: 35.8894, lon: -5.3166 };
  const reliability: Record<string, number> = {
    "Rock Marine Fuels": 5,
    "Strait Bunkering Ltd": 9,
    "Ceuta Oil Trading": 7,
    "Med Bunker Brokers": 8,
  };

  async function runDemo() {
    db.ports = [ROTTERDAM, ALGECIRAS, GENOA, GIBRALTAR, CEUTA];
    db.emails = demo.emails.map((e) => ({ ...e, processed: false, receivedAt: new Date() }));
    giveSlack(24);
    for (const e of demo.emails) await processEmail(e.id);
    return db.recs.map((rec, i) => {
      const ev = db.portEvents[i];
      const plan = rec.bunkerPlan as BunkerPlan;
      return {
        id: demo.emails[i].id,
        supplier: ev.supplier as string,
        portName: (ev.port as { name: string }).name,
        reliabilityScore: reliability[ev.supplier as string],
        reliabilityKnown: true,
        terms: ev.offerTerms as OfferTerms,
        planInput: plan.input,
        plan,
      };
    });
  }

  it("every quote is matched to MV Aegean Star, a few miles off its route, and analysed", async () => {
    const offers = await runDemo();
    expect(offers).toHaveLength(4);
    for (const o of offers) {
      expect(o.plan.input.offRouteNm).toBeLessThan(25);
      expect(o.plan.screen.passed).toBe(true);
    }
    expect(db.portEvents.every((ev) => ev.voyageId === "v1")).toBe(true);
  });

  it("the cheapest quote on paper ranks last; the all-in prompt one wins", async () => {
    const offers = await runDemo();
    const rows = compareOffers(offers, { ...DEFAULT_TCO, stemQtyT: 800, charterUsdPerDay: 18_000 });
    expect(rows[0].offer.id).toBe("balanced");
    expect(rows.at(-1)!.offer.id).toBe("trap-lowball");
    expect(explainComparison(rows).headline).toMatch(
      /^Strait Bunkering Ltd \(Algeciras\) is \$5\.00\/t dearer on paper than Rock Marine Fuels \(Gibraltar\), but \$[\d,]+ cheaper overall/
    );
  });

  it("the messy email keeps its LSMGO line apart from the VLSFO it is compared on", async () => {
    const offers = await runDemo();
    const messy = offers.find((o) => o.id === "messy-two-grades")!;
    expect(messy.planInput.offer.priceUsdPerT).toBe(529);
    expect(messy.terms.lines.map((l) => l.fuelGrade)).toEqual(["VLSFO", "LSMGO"]);
  });
});
