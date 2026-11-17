import { PrismaClient } from "@prisma/client";
import { haversineNm } from "@maritime/shared";

const prisma = new PrismaClient();

interface PortSeed {
  unlocode: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
}

const PORTS: PortSeed[] = [
  { unlocode: "GRPIR", name: "Piraeus", country: "Greece", lat: 37.9475, lon: 23.6367 },
  { unlocode: "NLRTM", name: "Rotterdam", country: "Netherlands", lat: 51.9496, lon: 4.1453 },
  { unlocode: "DEHAM", name: "Hamburg", country: "Germany", lat: 53.5459, lon: 9.9681 },
  { unlocode: "BEANR", name: "Antwerp", country: "Belgium", lat: 51.2605, lon: 4.4026 },
  { unlocode: "ESVLC", name: "Valencia", country: "Spain", lat: 39.4451, lon: -0.3159 },
  { unlocode: "ESALG", name: "Algeciras", country: "Spain", lat: 36.1246, lon: -5.4418 },
  { unlocode: "ITGOA", name: "Genoa", country: "Italy", lat: 44.4056, lon: 8.9463 },
  { unlocode: "SGSIN", name: "Singapore", country: "Singapore", lat: 1.2644, lon: 103.82 },
  { unlocode: "CNSHA", name: "Shanghai", country: "China", lat: 31.2304, lon: 121.4737 },
  { unlocode: "AEJEA", name: "Jebel Ali", country: "United Arab Emirates", lat: 25.0118, lon: 55.0618 },
  { unlocode: "BRSSZ", name: "Santos", country: "Brazil", lat: -23.9608, lon: -46.3339 },
  { unlocode: "USHOU", name: "Houston", country: "United States", lat: 29.7355, lon: -95.0086 },
];

interface VesselSeed {
  imo: string;
  name: string;
  type: string;
  dwt: number;
  designSpeedKn: number;
  minSpeedKn: number;
  fuelTPerDayAtDesign: number;
  auxFuelTPerDay: number;
}

const VESSELS: VesselSeed[] = [
  { imo: "9000001", name: "MV Aegean Star", type: "Container", dwt: 45000, designSpeedKn: 14, minSpeedKn: 9, fuelTPerDayAtDesign: 40, auxFuelTPerDay: 3 },
  { imo: "9000002", name: "MV Cycladic Wind", type: "Bulk Carrier", dwt: 38000, designSpeedKn: 13, minSpeedKn: 9, fuelTPerDayAtDesign: 32, auxFuelTPerDay: 2.5 },
  { imo: "9000003", name: "MV Ionian Trader", type: "Container", dwt: 52000, designSpeedKn: 15, minSpeedKn: 10, fuelTPerDayAtDesign: 45, auxFuelTPerDay: 3.5 },
  { imo: "9000004", name: "MV Hellenic Pioneer", type: "Tanker", dwt: 60000, designSpeedKn: 14.5, minSpeedKn: 9.5, fuelTPerDayAtDesign: 42, auxFuelTPerDay: 3 },
  { imo: "9000005", name: "MV Aegean Breeze", type: "Bulk Carrier", dwt: 41000, designSpeedKn: 13.5, minSpeedKn: 9, fuelTPerDayAtDesign: 35, auxFuelTPerDay: 2.8 },
  { imo: "9000006", name: "MV Poseidon Glory", type: "Container", dwt: 48000, designSpeedKn: 16, minSpeedKn: 10, fuelTPerDayAtDesign: 48, auxFuelTPerDay: 4 },
  { imo: "9000007", name: "MV Marathon Spirit", type: "General Cargo", dwt: 30000, designSpeedKn: 13, minSpeedKn: 9, fuelTPerDayAtDesign: 28, auxFuelTPerDay: 2 },
  { imo: "9000008", name: "MV Olympic Horizon", type: "Tanker", dwt: 65000, designSpeedKn: 14, minSpeedKn: 9.5, fuelTPerDayAtDesign: 44, auxFuelTPerDay: 3.2 },
];

interface VoyageSeed {
  vesselImo: string;
  originUnlocode: string;
  destUnlocode: string;
  speedKn: number;
  remainingNmAtStart: number;
}

const VOYAGES: VoyageSeed[] = [
  // Great-circle distances (haversine, ignoring coastlines): GRPIR-NLRTM ~1173nm,
  // DEHAM-SGSIN ~5480nm, ESVLC-ESALG ~314nm, ITGOA-AEJEA ~2514nm,
  // BRSSZ-USHOU ~4274nm, BEANR-CNSHA ~4848nm. remainingNmAtStart must stay
  // below the route's total distance.
  { vesselImo: "9000001", originUnlocode: "GRPIR", destUnlocode: "NLRTM", speedKn: 14, remainingNmAtStart: 1100 },
  { vesselImo: "9000002", originUnlocode: "DEHAM", destUnlocode: "SGSIN", speedKn: 13, remainingNmAtStart: 3500 },
  { vesselImo: "9000003", originUnlocode: "ESVLC", destUnlocode: "ESALG", speedKn: 15, remainingNmAtStart: 150 },
  { vesselImo: "9000004", originUnlocode: "ITGOA", destUnlocode: "AEJEA", speedKn: 14.5, remainingNmAtStart: 2300 },
  { vesselImo: "9000005", originUnlocode: "BRSSZ", destUnlocode: "USHOU", speedKn: 13.5, remainingNmAtStart: 2200 },
  { vesselImo: "9000006", originUnlocode: "BEANR", destUnlocode: "CNSHA", speedKn: 16, remainingNmAtStart: 3000 },
];

function formatUtc(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

async function main() {
  for (const p of PORTS) {
    await prisma.port.upsert({
      where: { unlocode: p.unlocode },
      update: { name: p.name, country: p.country, lat: p.lat, lon: p.lon },
      create: p,
    });
  }

  for (const v of VESSELS) {
    await prisma.vessel.upsert({
      where: { imo: v.imo },
      update: { ...v },
      create: v,
    });
  }

  const voyageCount = await prisma.voyage.count();
  if (voyageCount > 0) {
    console.log(`Skipping voyage/email seed: ${voyageCount} voyages already exist.`);
    return;
  }

  const portsByCode = Object.fromEntries(
    (await prisma.port.findMany()).map((p) => [p.unlocode, p])
  );
  const vesselsByImo = Object.fromEntries(
    (await prisma.vessel.findMany()).map((v) => [v.imo, v])
  );

  const now = new Date();
  const createdVoyages: Record<string, { id: string; plannedEta: Date }> = {};

  for (const v of VOYAGES) {
    const origin = portsByCode[v.originUnlocode];
    const dest = portsByCode[v.destUnlocode];
    const vessel = vesselsByImo[v.vesselImo];
    const totalNm = haversineNm(
      { lat: origin.lat, lon: origin.lon },
      { lat: dest.lat, lon: dest.lon }
    );
    const sailedNmAtRebase = Math.max(0, totalNm - v.remainingNmAtStart);
    const elapsedHours = sailedNmAtRebase / v.speedKn;
    const departedAt = new Date(now.getTime() - elapsedHours * 3_600_000);
    const plannedEta = new Date(departedAt.getTime() + (totalNm / v.speedKn) * 3_600_000);

    const voyage = await prisma.voyage.create({
      data: {
        vesselId: vessel.id,
        originPortId: origin.id,
        destPortId: dest.id,
        departedAt,
        speedKn: v.speedKn,
        sailedNmAtRebase,
        rebasedAt: now,
        plannedEta,
        status: "UNDERWAY",
      },
    });
    createdVoyages[v.vesselImo] = { id: voyage.id, plannedEta };
  }

  // Demo scenario: Rotterdam berth delayed 24h for MV Aegean Star.
  const aegeanEta = createdVoyages["9000001"].plannedEta;
  const aegeanNewBerth = new Date(aegeanEta.getTime() + 24 * 3_600_000);
  const emailA = {
    fromAddr: "ops@rtm-agency.example",
    subject: "Berth Delay Notice - MV Aegean Star - Port of Rotterdam",
    body: `Dear Captain,

This is to inform you that due to congestion at the container terminal, the berth allocated to MV Aegean Star at the Port of Rotterdam (NLRTM) has been delayed by 24 hours. The new berth time is now ${formatUtc(
      aegeanNewBerth
    )}.

Please adjust your ETA accordingly.

Best regards,
Rotterdam Terminal Agency`,
    queued: true,
  };

  // Secondary scenario: Singapore congestion affecting MV Cycladic Wind.
  const cycladicEta = createdVoyages["9000002"].plannedEta;
  const cycladicNewBerth = new Date(cycladicEta.getTime() + 18 * 3_600_000);
  const emailB = {
    fromAddr: "agent@sg-portservices.example",
    subject: "Congestion Alert - Port of Singapore",
    body: `Dear Owners,

Please be advised that the Port of Singapore (SGSIN) is currently experiencing severe congestion. Vessels including MV Cycladic Wind should expect a delay of 18 hours before berthing. Updated berth time: ${formatUtc(
      cycladicNewBerth
    )}.

Regards,
Singapore Port Services`,
    queued: true,
  };

  // Irrelevant email: must produce eventType = NONE.
  const emailC = {
    fromAddr: "billing@maritime-insure.example",
    subject: "Your invoice #4471 is ready",
    body: `Dear Customer,

Your monthly invoice for hull & machinery insurance coverage is now available in your account portal. Total due: EUR 12,450.00. Payment due within 30 days.

Thank you for your business,
Maritime Insure Billing`,
    queued: true,
  };

  for (const email of [emailA, emailB, emailC]) {
    await prisma.email.create({ data: email });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
