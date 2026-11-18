export type CiiGrade = "A" | "B" | "C" | "D" | "E";

export function calculateVoyageCII(params: {
  dwt: number;
  distanceNm: number;
  speedKn: number;
  designSpeedKn: number;
  fuelTPerDayAtDesign: number;
  auxFuelTPerDay: number;
  vesselType: string;
  co2Factor?: number;
}): { attained: number; rating: CiiGrade } {
  const co2Factor = params.co2Factor ?? 3.114;
  const days = params.distanceNm / (params.speedKn * 24);
  const speedRatio = params.speedKn / params.designSpeedKn;
  const mainFuelT = params.fuelTPerDayAtDesign * Math.pow(speedRatio, 3) * days;
  const totalFuelT = mainFuelT + params.auxFuelTPerDay * days;

  const co2Grams = totalFuelT * co2Factor * 1_000_000;
  const attained = co2Grams / (params.dwt * params.distanceNm);

  const baselineByType: Record<string, number> = {
    "Bulk Carrier": 5.2,
    "Tanker": 5.8,
    "Container": 8.5,
    "General Cargo": 7.5,
  };
  const required = baselineByType[params.vesselType] ?? 6.5;
  const ratio = attained / required;

  let rating: CiiGrade = "C";
  if (ratio <= 0.83) rating = "A";
  else if (ratio <= 0.94) rating = "B";
  else if (ratio <= 1.07) rating = "C";
  else if (ratio <= 1.19) rating = "D";
  else rating = "E";

  return { attained: Number(attained.toFixed(2)), rating };
}