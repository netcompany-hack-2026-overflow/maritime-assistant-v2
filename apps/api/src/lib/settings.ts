import type { Prisma } from "@prisma/client";
import {
  priceScenarios,
  repriceBunker,
  repriceJit,
  type BunkerCalc,
  type JitCalc,
  type SettingsDTO,
} from "@maritime/shared";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { parseScenarioSet, recommendationFields } from "../services/scenarioFields.js";

const SETTINGS_ID = 1;

// Defaults for columns added after the first Settings migration (mirrors schema.prisma).
const BUNKER_DEFAULTS = {
  usdEurRate: 0.92,
  bunkerPortHours: 8,
  bunkerPortFeeEur: 5000,
  bunkerDefaultQtyT: 800,
};

type SettingsRow = {
  fuelPriceEurPerT: number;
  euaPriceEurPerT?: number | null;
  co2Factor: number;
  usdEurRate?: number;
  bunkerPortHours?: number;
  bunkerPortFeeEur?: number;
  bunkerDefaultQtyT?: number;
  updatedAt: Date;
};

function toDTO(s: SettingsRow): SettingsDTO {
  return {
    fuelPriceEurPerT: s.fuelPriceEurPerT,
    euaPriceEurPerT: s.euaPriceEurPerT ?? env.euaPriceEurPerT,
    co2Factor: s.co2Factor,
    usdEurRate: s.usdEurRate ?? BUNKER_DEFAULTS.usdEurRate,
    bunkerPortHours: s.bunkerPortHours ?? BUNKER_DEFAULTS.bunkerPortHours,
    bunkerPortFeeEur: s.bunkerPortFeeEur ?? BUNKER_DEFAULTS.bunkerPortFeeEur,
    bunkerDefaultQtyT: s.bunkerDefaultQtyT ?? BUNKER_DEFAULTS.bunkerDefaultQtyT,
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** App settings. The row is created from env defaults on first read. */
export async function getSettings(): Promise<SettingsDTO> {
  const row = await prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: {
      id: SETTINGS_ID,
      fuelPriceEurPerT: env.fuelPriceEurPerT,
      euaPriceEurPerT: env.euaPriceEurPerT,
      co2Factor: env.co2Factor,
    },
  });
  return toDTO(row);
}

export interface PriceSettingsUpdate {
  fuelPriceEurPerT?: number;
  usdEurRate?: number;
  /** EU Allowance price, € per tonne CO₂. */
  euaPriceEurPerT?: number;
}

/**
 * Change the fuel price, the USD→EUR rate and/or the EUA price. PENDING
 * recommendations are re-priced so the operator decides with current numbers;
 * APPROVED/REJECTED keep the prices they were decided at, so the savings
 * record stays truthful.
 */
export async function updatePriceSettings(
  update: PriceSettingsUpdate
): Promise<{ settings: SettingsDTO; repricedRecommendations: number }> {
  const before = await getSettings();
  const fuelPriceEurPerT = update.fuelPriceEurPerT ?? before.fuelPriceEurPerT;
  const usdEurRate = update.usdEurRate ?? before.usdEurRate;
  const euaPriceEurPerT = update.euaPriceEurPerT ?? before.euaPriceEurPerT;
  const fuelChanged = fuelPriceEurPerT !== before.fuelPriceEurPerT;
  const rateChanged = usdEurRate !== before.usdEurRate;
  const euaChanged = euaPriceEurPerT !== before.euaPriceEurPerT;

  return prisma.$transaction(async (tx) => {
    const data: PriceSettingsUpdate = {};
    if (update.fuelPriceEurPerT !== undefined) data.fuelPriceEurPerT = fuelPriceEurPerT;
    if (update.usdEurRate !== undefined) data.usdEurRate = usdEurRate;
    if (update.euaPriceEurPerT !== undefined) data.euaPriceEurPerT = euaPriceEurPerT;
    const row = await tx.settings.update({ where: { id: SETTINGS_ID }, data });

    let repriced = 0;
    if (fuelChanged || rateChanged || euaChanged) {
      const pending = await tx.recommendation.findMany({ where: { status: "PENDING" } });
      for (const rec of pending) {
        if (rec.actionType === "BUNKER_DETOUR") {
          if (!fuelChanged && !rateChanged) continue; // bunker offers don't use the EUA price
          const calc = repriceBunker(rec.calc as unknown as BunkerCalc, fuelPriceEurPerT, usdEurRate);
          await tx.recommendation.update({
            where: { id: rec.id },
            data: { costSavedEur: calc.netEur, calc: calc as unknown as Prisma.InputJsonValue },
          });
        } else {
          // Speed recommendations don't depend on the exchange rate.
          if (!fuelChanged && !euaChanged) continue;
          const calc = repriceJit(rec.calc as unknown as JitCalc, fuelPriceEurPerT);
          const recData: Prisma.RecommendationUpdateInput = {
            costSavedEur: calc.costSavedEur,
            calc: calc as unknown as Prisma.InputJsonValue,
          };
          const set = parseScenarioSet(rec.scenarios);
          if (set) {
            const repricedSet = priceScenarios(set, { fuelPriceEurPerT, euaPriceEurPerT });
            Object.assign(recData, recommendationFields(repricedSet), {
              scenarios: repricedSet as unknown as Prisma.InputJsonValue,
            });
          }
          await tx.recommendation.update({ where: { id: rec.id }, data: recData });
        }
        repriced++;
      }
      await tx.auditLog.create({
        data: {
          entity: "settings",
          entityId: String(SETTINGS_ID),
          action: fuelChanged ? "FUEL_PRICE_CHANGED" : rateChanged ? "USD_EUR_RATE_CHANGED" : "EUA_PRICE_CHANGED",
          payload: {
            previousFuelPriceEurPerT: before.fuelPriceEurPerT,
            fuelPriceEurPerT,
            previousUsdEurRate: before.usdEurRate,
            usdEurRate,
            previousEuaPriceEurPerT: before.euaPriceEurPerT,
            euaPriceEurPerT,
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
