import type { Prisma } from "@prisma/client";
import {
  repriceBunker,
  repriceBunkerPlan,
  repriceJit,
  type BunkerCalc,
  type BunkerPlan,
  type JitCalc,
  type SettingsDTO,
} from "@maritime/shared";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { syncBunkerDrafts } from "../services/bunkerDrafts.js";

const SETTINGS_ID = 1;

// Defaults for columns added after the first Settings migration (mirrors schema.prisma).
const BUNKER_DEFAULTS = {
  usdEurRate: 0.92,
  bunkerPortHours: 8,
  bunkerPortFeeEur: 5000,
  bunkerDefaultQtyT: 800,
  bunkerPumpRateTPerH: 250,
  bunkerSlackToleranceMin: 30,
};

type SettingsRow = {
  fuelPriceEurPerT: number;
  co2Factor: number;
  usdEurRate?: number;
  bunkerPortHours?: number;
  bunkerPortFeeEur?: number;
  bunkerDefaultQtyT?: number;
  bunkerPumpRateTPerH?: number;
  bunkerSlackToleranceMin?: number;
  updatedAt: Date;
};

function toDTO(s: SettingsRow): SettingsDTO {
  return {
    fuelPriceEurPerT: s.fuelPriceEurPerT,
    co2Factor: s.co2Factor,
    usdEurRate: s.usdEurRate ?? BUNKER_DEFAULTS.usdEurRate,
    bunkerPortHours: s.bunkerPortHours ?? BUNKER_DEFAULTS.bunkerPortHours,
    bunkerPortFeeEur: s.bunkerPortFeeEur ?? BUNKER_DEFAULTS.bunkerPortFeeEur,
    bunkerDefaultQtyT: s.bunkerDefaultQtyT ?? BUNKER_DEFAULTS.bunkerDefaultQtyT,
    bunkerPumpRateTPerH: s.bunkerPumpRateTPerH ?? BUNKER_DEFAULTS.bunkerPumpRateTPerH,
    bunkerSlackToleranceMin: s.bunkerSlackToleranceMin ?? BUNKER_DEFAULTS.bunkerSlackToleranceMin,
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** App settings. The row is created from env defaults on first read. */
export async function getSettings(): Promise<SettingsDTO> {
  const row = await prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID, fuelPriceEurPerT: env.fuelPriceEurPerT, co2Factor: env.co2Factor },
  });
  return toDTO(row);
}

export interface PriceSettingsUpdate {
  fuelPriceEurPerT?: number;
  usdEurRate?: number;
}

/**
 * Change the fuel price and/or the USD→EUR rate. PENDING recommendations are
 * re-priced so the operator decides with current numbers; APPROVED/REJECTED
 * keep the prices they were decided at, so the savings record stays truthful.
 */
export async function updatePriceSettings(
  update: PriceSettingsUpdate
): Promise<{ settings: SettingsDTO; repricedRecommendations: number }> {
  const before = await getSettings();
  const fuelPriceEurPerT = update.fuelPriceEurPerT ?? before.fuelPriceEurPerT;
  const usdEurRate = update.usdEurRate ?? before.usdEurRate;
  const fuelChanged = fuelPriceEurPerT !== before.fuelPriceEurPerT;
  const rateChanged = usdEurRate !== before.usdEurRate;

  return prisma.$transaction(async (tx) => {
    const data: PriceSettingsUpdate = {};
    if (update.fuelPriceEurPerT !== undefined) data.fuelPriceEurPerT = fuelPriceEurPerT;
    if (update.usdEurRate !== undefined) data.usdEurRate = usdEurRate;
    const row = await tx.settings.update({ where: { id: SETTINGS_ID }, data });

    let repriced = 0;
    if (fuelChanged || rateChanged) {
      const pending = await tx.recommendation.findMany({ where: { status: "PENDING" } });
      for (const rec of pending) {
        const storedPlan = rec.bunkerPlan as unknown as BunkerPlan | null | undefined;
        if (rec.actionType === "BUNKER_DETOUR" && storedPlan && storedPlan.options.length > 0) {
          // Re-price every option; the best one may change, and so may the counter-offer price.
          const plan = repriceBunkerPlan(storedPlan, fuelPriceEurPerT, usdEurRate);
          const best = plan.options[0].calc;
          await tx.recommendation.update({
            where: { id: rec.id },
            data: {
              recommendedSpeedKn: best.speedBunkerKn,
              fuelSavedT: -best.extraFuelT,
              costSavedEur: best.netEur,
              co2SavedT: -best.extraCo2T,
              calc: best as unknown as Prisma.InputJsonValue,
              bunkerPlan: plan as unknown as Prisma.InputJsonValue,
            },
          });
          await syncBunkerDrafts(tx, rec.id, plan);
        } else if (rec.actionType === "BUNKER_DETOUR") {
          const calc = repriceBunker(rec.calc as unknown as BunkerCalc, fuelPriceEurPerT, usdEurRate);
          await tx.recommendation.update({
            where: { id: rec.id },
            data: { costSavedEur: calc.netEur, calc: calc as unknown as Prisma.InputJsonValue },
          });
        } else {
          if (!fuelChanged) continue; // speed recommendations don't depend on the exchange rate
          const calc = repriceJit(rec.calc as unknown as JitCalc, fuelPriceEurPerT);
          await tx.recommendation.update({
            where: { id: rec.id },
            data: { costSavedEur: calc.costSavedEur, calc: calc as unknown as Prisma.InputJsonValue },
          });
        }
        repriced++;
      }
      await tx.auditLog.create({
        data: {
          entity: "settings",
          entityId: String(SETTINGS_ID),
          action: fuelChanged ? "FUEL_PRICE_CHANGED" : "USD_EUR_RATE_CHANGED",
          payload: {
            previousFuelPriceEurPerT: before.fuelPriceEurPerT,
            fuelPriceEurPerT,
            previousUsdEurRate: before.usdEurRate,
            usdEurRate,
            repricedRecommendations: repriced,
          },
        },
      });
    }

    return { settings: toDTO(row), repricedRecommendations: repriced };
  });
}

/** Change only the fuel price (kept for callers that predate the exchange rate). */
export function updateFuelPrice(fuelPriceEurPerT: number) {
  return updatePriceSettings({ fuelPriceEurPerT });
}
