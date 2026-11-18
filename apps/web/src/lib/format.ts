export const eur = (n: number) => `€${Math.round(n).toLocaleString("en-US")}`;

export const money = (n: number, currency: string | null | undefined) =>
  `${currency ?? "USD"} ${Math.round(n).toLocaleString("en-US")}`;

export const fixed = (n: number, digits = 1) => n.toFixed(digits);

/** "Sat 21 Nov, 16:08 UTC" — shipping talks UTC. */
export function utc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) +
    ", " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) +
    " UTC"
  );
}

export const signed = (n: number, digits = 1) => `${n > 0 ? "−" : n < 0 ? "+" : ""}${Math.abs(n).toFixed(digits)}`;
