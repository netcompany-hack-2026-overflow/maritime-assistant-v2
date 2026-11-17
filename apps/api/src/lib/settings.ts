import type { Prisma } from "@prisma/client";
import { repriceJit, type JitCalc, type SettingsDTO } from "@maritime/shared";
import { prisma } from "./prisma.js";
import { env } from "./env.js";

const SETTINGS_ID = 1;

function toDTO(s: { fuelPriceEurPerT: number; co2Factor: number; updatedAt: Date }): SettingsDTO {
  return { fuelPriceEurPerT: s.fuelPriceEurPerT, co2Factor: s.co2Factor, updatedAt: s.updatedAt.toISOString() };
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

/**
 * Change the fuel price. PENDING recommendations are re-priced so the operator
 * decides with current numbers; APPROVED/REJECTED keep the price they were
 * decided at, so the savings record stays truthful.
 */
export async function updateFuelPrice(
  fuelPriceEurPerT: number
): Promise<{ settings: SettingsDTO; repricedRecommendations: number }> {
  const before = await getSettings();

  return prisma.$transaction(async (tx) => {
    const row = await tx.settings.update({
      where: { id: SETTINGS_ID },
      data: { fuelPriceEurPerT },
    });

    let repriced = 0;
    if (before.fuelPriceEurPerT !== fuelPriceEurPerT) {
      const pending = await tx.recommendation.findMany({ where: { status: "PENDING" } });
      for (const rec of pending) {
        const calc = repriceJit(rec.calc as unknown as JitCalc, fuelPriceEurPerT);
        await tx.recommendation.update({
          where: { id: rec.id },
          data: { costSavedEur: calc.costSavedEur, calc: calc as unknown as Prisma.InputJsonValue },
        });
        repriced++;
      }
      await tx.auditLog.create({
        data: {
          entity: "settings",
          entityId: String(SETTINGS_ID),
          action: "FUEL_PRICE_CHANGED",
          payload: {
            previousFuelPriceEurPerT: before.fuelPriceEurPerT,
            fuelPriceEurPerT,
            repricedRecommendations: repriced,
          },
        },
      });
    }

    return { settings: toDTO(row), repricedRecommendations: repriced };
  });
}
