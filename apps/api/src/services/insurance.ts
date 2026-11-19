import type { Prisma } from "@prisma/client";
import {
  assessWarRisk,
  compareWarRisk,
  DEFAULT_PORT_OPS_HOURS,
  IBF_LIST,
  JWC_CIRCULAR,
  polylineLengthNm,
  type CharterPartyTerms,
  type InsuranceNoticeDTO,
  type LatLon,
  type VoyageInsuranceDTO,
  type VoyageInsuranceSummary,
  type WarRiskAssessment,
  type WarRiskChange,
} from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { activeLlmProviderName, getLlmProvider, type WarRiskFacts } from "../llm/index.js";
import { remainingDistanceNm } from "../sim/positions.js";
import { isAtSea, NOT_AT_SEA_MESSAGE } from "./atSea.js";
import { MailerError, sendMail } from "./mailer.js";
import { parseTerms } from "./scenarios.js";
import { parseStoredRoute, routeBetweenPorts } from "./seaRoute.js";

/**
 * War-risk insurance of a voyage. The policy issued at departure is kept; the
 * current picture is recomputed on every read from the voyage as it stands
 * (speed, berth time, position, broker quotes), so a slower passage or a berth
 * delay inside a listed area shows up as extra 7-day periods. The model writes
 * the summary and the notice to the war underwriters; it never decides the
 * numbers. Nothing is sent without a person pressing Send.
 */

/** Where the notice goes until the operator types the broker's address. Test mode redirects it anyway. */
export const DEFAULT_WAR_UNDERWRITERS_EMAIL = "war-risks@marine-broker.example";

export const insuranceInclude = { vessel: true, originPort: true, destPort: true, charterParty: true } as const;
export type VoyageForInsurance = Prisma.VoyageGetPayload<{ include: typeof insuranceInclude }>;

interface StoredNotice extends InsuranceNoticeDTO {
  /** The material terms (areas, periods, rates) the notice was written for. */
  noticeKey: string;
  messageId: string | null;
}

interface StoredInsurance {
  atDeparture: WarRiskAssessment | null;
  quotes: Record<string, number>;
  analysis: {
    summary: string;
    source: "llm" | "template";
    provider: string;
    generatedAt: string;
    factsKey: string;
    notice: { subject: string; body: string };
  } | null;
  notice: StoredNotice | null;
  sentNotices: Array<{ subject: string; sentAt: string; deliveredTo: string | null }>;
}

export function readStoredInsurance(value: unknown): StoredInsurance {
  const v = (value && typeof value === "object" ? value : {}) as Partial<StoredInsurance>;
  return {
    atDeparture: v.atDeparture ?? null,
    quotes: v.quotes && typeof v.quotes === "object" ? v.quotes : {},
    analysis: v.analysis ?? null,
    notice: v.notice ?? null,
    sentNotices: Array.isArray(v.sentNotices) ? v.sentNotices : [],
  };
}

type VoyageGeometry = Pick<VoyageForInsurance, "routeNm" | "speedKn" | "plannedEta" | "berthTime" | "status" | "departedAt"> & {
  /** Stored Voyage.routeCoords JSON, or the coords of a route being created. */
  routeCoords: unknown;
  vessel: VoyageForInsurance["vessel"];
  originPort: { lat: number; lon: number; country: string };
  destPort: { lat: number; lon: number; country: string };
  charterParty: { terms: unknown; expectedOpsHours: number | null } | null;
};

function routeOf(v: VoyageGeometry): LatLon[] {
  return parseStoredRoute(v.routeCoords) ?? routeBetweenPorts(v.originPort, v.destPort).coords;
}

/** Waiting for the berth plus cargo operations at the destination, hours. */
export function destPortStayHours(v: VoyageGeometry): number {
  const waiting = v.berthTime ? Math.max(0, (v.berthTime.getTime() - v.plannedEta.getTime()) / 3_600_000) : 0;
  const terms = v.charterParty ? parseTerms(v.charterParty.terms) : null;
  const ops =
    v.charterParty?.expectedOpsHours ??
    (terms?.laytimeHours != null ? terms.laytimeHours * 0.8 : null) ??
    DEFAULT_PORT_OPS_HOURS;
  return waiting + ops;
}

/** The voyage's exposure as it stands at `now`. */
export function assessVoyage(v: VoyageGeometry, quotes: Record<string, number>, now = new Date()): WarRiskAssessment {
  const route = routeOf(v);
  const routeNm = v.routeNm ?? polylineLengthNm(route);
  const sailedNm =
    v.status === "ARRIVED" ? routeNm : Math.max(0, routeNm - remainingDistanceNm({ ...v, vessel: v.vessel }, now));
  return assessWarRisk({
    route,
    speedKn: v.speedKn,
    sailedNm,
    now,
    hullValueUsd: v.vessel.hullValueUsd,
    originCountry: v.originPort.country,
    destCountry: v.destPort.country,
    destPortStayHours: destPortStayHours(v),
    quotedPct: quotes,
  });
}

/** The policy as issued when the voyage starts: nothing sailed yet, market rates. */
export function assessAtDeparture(v: VoyageGeometry): WarRiskAssessment {
  return assessWarRisk({
    route: routeOf(v),
    speedKn: v.speedKn,
    sailedNm: 0,
    now: v.departedAt,
    hullValueUsd: v.vessel.hullValueUsd,
    originCountry: v.originPort.country,
    destCountry: v.destPort.country,
    destPortStayHours: destPortStayHours(v),
  });
}

/** Stored value for a voyage that is being created. */
export function initialInsurance(v: VoyageGeometry): Prisma.InputJsonValue {
  const stored: StoredInsurance = { atDeparture: assessAtDeparture(v), quotes: {}, analysis: null, notice: null, sentNotices: [] };
  return stored as unknown as Prisma.InputJsonValue;
}

const fmtPos = (p: LatLon) =>
  `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? "N" : "S"} ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? "E" : "W"}`;

function warClauseName(terms: CharterPartyTerms | null): string | null {
  const w = terms?.warRisksClause;
  return w?.present ? (w.name ?? "war risks clause") : null;
}

export function warRiskFacts(
  v: VoyageForInsurance,
  current: WarRiskAssessment,
  change: WarRiskChange,
  terms: CharterPartyTerms | null
): WarRiskFacts {
  return {
    vesselName: v.vessel.name,
    imo: v.vessel.imo,
    vesselType: v.vessel.type,
    originPortName: v.originPort.name,
    destPortName: v.destPort.name,
    nowUtc: current.computedAt,
    speedKn: current.speedKn,
    hullValueUsd: current.hullValueUsd,
    circular: `${JWC_CIRCULAR.ref} of ${JWC_CIRCULAR.date}`,
    ibfList: `${IBF_LIST.ref}, agreed ${IBF_LIST.agreed}, extended to ${IBF_LIST.extendedTo}`,
    insideNow: current.insideNow,
    currentArea: current.currentAreaLabel,
    notifyByUtc: current.notifyBy,
    exposures: current.exposures.map((e) => ({
      area: e.label,
      areaEn: e.labelEn,
      jwcName: e.jwcName,
      status: e.status,
      enterUtc: e.enterAt,
      exitUtc: e.exitAt,
      enterPosition: fmtPos(e.enterPosition),
      sailingDays: e.sailingDays,
      portStayDays: e.portStayDays,
      daysInArea: e.daysInArea,
      periods: e.periods,
      coveredDays: e.coveredDays,
      ratePct: e.ratePct,
      riskiestPart: e.rateZoneLabel,
      parts: e.zones.map((z) => `${z.label}: ${z.days} days`),
      rateSource: e.quoted ? "broker quote" : e.rateBasis.source,
      rateIsAssumption: !e.quoted && e.rateBasis.assumption,
      quotedByBroker: e.quoted,
      premiumUsd: e.premiumUsd,
      threats: e.threats,
      kidnapRisk: e.kidnapRisk,
      reporting: e.reporting,
    })),
    crew: current.crew.map((c) => ({
      zone: c.label,
      category: c.category,
      status: c.status,
      days: c.days,
      bonusDays: c.bonusDays,
      bonusUsd: c.bonusUsd,
    })),
    kidnapAndRansomAdvised: current.kidnapAndRansomAdvised,
    totals: { premiumUsd: current.totals.premiumUsd, crewBonusUsd: current.totals.crewBonusUsd, totalUsd: current.totals.totalUsd },
    changeSinceDeparture: change.lines,
    charterParty: v.charterParty
      ? {
          reference: terms?.reference ?? null,
          chartererName: terms?.chartererName ?? null,
          warClause: warClauseName(terms),
          additionalPremiumForCharterers: terms?.warRisksClause.additionalPremiumForCharterers ?? null,
          crewBonusForCharterers: terms?.warRisksClause.crewBonusForCharterers ?? null,
        }
      : null,
  };
}

/** Everything the analysis says depends on: a change here means the text is out of date. */
function analysisKey(f: WarRiskFacts): string {
  return JSON.stringify([
    f.speedKn,
    f.hullValueUsd,
    f.insideNow,
    f.exposures.map((e) => [e.areaEn, e.status, e.periods, e.ratePct, e.premiumUsd, Math.round(e.daysInArea)]),
    f.crew.map((c) => [c.zone, c.status, c.bonusDays]),
    f.charterParty,
    f.changeSinceDeparture,
  ]);
}

/** The terms the underwriters are told: a sent notice is only superseded when these change. */
function noticeKey(a: WarRiskAssessment): string {
  return JSON.stringify(a.exposures.map((e) => [e.areaId, e.periods, e.ratePct]));
}

export class InsuranceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function loadVoyage(voyageId: string): Promise<VoyageForInsurance> {
  const v = await prisma.voyage.findUnique({ where: { id: voyageId }, include: insuranceInclude });
  if (!v) throw new InsuranceError(404, "Το ταξίδι δεν βρέθηκε");
  return v;
}

async function save(voyageId: string, stored: StoredInsurance) {
  await prisma.voyage.update({ where: { id: voyageId }, data: { insurance: stored as unknown as Prisma.InputJsonValue } });
}

/**
 * The voyage's insurance as it stands now. Writes the AI analysis (and a fresh
 * notice draft) only when the facts behind them changed, or when asked to.
 */
export async function getVoyageInsurance(voyageId: string, opts: { regenerate?: boolean; now?: Date } = {}): Promise<VoyageInsuranceDTO> {
  const v = await loadVoyage(voyageId);
  const now = opts.now ?? new Date();
  const stored = readStoredInsurance(v.insurance);
  let dirty = false;

  if (!stored.atDeparture) {
    // Voyages created before insurance existed: issue the departure policy now.
    stored.atDeparture = assessAtDeparture(v);
    dirty = true;
  }
  const current = assessVoyage(v, stored.quotes, now);
  const change = compareWarRisk(stored.atDeparture, current);
  const terms = v.charterParty ? parseTerms(v.charterParty.terms) : null;
  const facts = warRiskFacts(v, current, change, terms);
  const key = analysisKey(facts);

  let regenerated = false;
  if (opts.regenerate || !stored.analysis || stored.analysis.factsKey !== key) {
    const a = await getLlmProvider().analyseWarRisk(facts);
    stored.analysis = {
      summary: a.summary,
      source: a.source,
      provider: a.source === "llm" ? activeLlmProviderName() : "template",
      generatedAt: now.toISOString(),
      factsKey: key,
      notice: a.notice,
    };
    regenerated = true;
    dirty = true;
  }

  if (!current.needsEndorsement) {
    if (stored.notice?.status === "DRAFT") {
      stored.notice = null;
      dirty = true;
    }
  } else {
    const nKey = noticeKey(current);
    const n = stored.notice;
    const fresh = (prefix = ""): StoredNotice => ({
      to: n?.to ?? DEFAULT_WAR_UNDERWRITERS_EMAIL,
      subject: prefix + stored.analysis!.notice.subject,
      body: stored.analysis!.notice.body,
      status: "DRAFT",
      edited: false,
      sentAt: null,
      deliveredTo: null,
      lastError: null,
      messageId: null,
      noticeKey: nKey,
    });
    if (!n) {
      stored.notice = fresh();
      dirty = true;
    } else if (n.status === "DRAFT" && !n.edited && (regenerated || n.noticeKey !== nKey)) {
      stored.notice = fresh();
      dirty = true;
    } else if (n.status === "SENT" && n.noticeKey !== nKey) {
      // The underwriters were told different terms (more days, another area, a new rate): draft an update.
      stored.notice = fresh("Update – ");
      dirty = true;
    }
  }

  if (dirty) await save(v.id, stored);
  return toDTO(v, stored, current, change, terms, now);
}

function toDTO(
  v: VoyageForInsurance,
  stored: StoredInsurance,
  current: WarRiskAssessment,
  change: WarRiskChange,
  terms: CharterPartyTerms | null,
  now: Date
): VoyageInsuranceDTO {
  const atSea = isAtSea(v, now);
  const n = stored.notice;
  return {
    voyageId: v.id,
    vesselName: v.vessel.name,
    imo: v.vessel.imo,
    vesselType: v.vessel.type,
    originPortName: v.originPort.name,
    destPortName: v.destPort.name,
    status: v.status,
    departedAt: v.departedAt.toISOString(),
    hullValueUsd: v.vessel.hullValueUsd,
    current,
    atDeparture: stored.atDeparture!,
    change,
    charterParty: v.charterParty
      ? {
          reference: terms?.reference ?? null,
          chartererName: terms?.chartererName ?? null,
          warRisksClause: terms?.warRisksClause ?? {
            present: false,
            name: null,
            text: null,
            additionalPremiumForCharterers: null,
            crewBonusForCharterers: null,
          },
        }
      : null,
    analysis: {
      summary: stored.analysis!.summary,
      source: stored.analysis!.source,
      provider: stored.analysis!.provider,
      generatedAt: stored.analysis!.generatedAt,
    },
    notice: n
      ? {
          to: n.to,
          subject: n.subject,
          body: n.body,
          status: n.status,
          edited: n.edited,
          sentAt: n.sentAt,
          deliveredTo: n.deliveredTo,
          lastError: n.lastError,
        }
      : null,
    sentNotices: stored.sentNotices,
    quotes: stored.quotes,
    canSend: atSea && current.needsEndorsement,
    cannotSendReason: !atSea ? NOT_AT_SEA_MESSAGE : !current.needsEndorsement ? "Η διαδρομή δεν περνά από περιοχή της λίστας JWC." : null,
  };
}

/** The broker's rate for one zone (% per 7 days), or null to go back to the market figure. */
export async function setInsuranceQuote(voyageId: string, zoneId: string, pct: number | null): Promise<VoyageInsuranceDTO> {
  const v = await loadVoyage(voyageId);
  const stored = readStoredInsurance(v.insurance);
  if (!stored.atDeparture) stored.atDeparture = assessAtDeparture(v);
  const known = new Set(assessVoyage(v, {}).exposures.flatMap((e) => [e.rateZoneId, ...e.zones.map((z) => z.zoneId)]));
  if (!known.has(zoneId)) throw new InsuranceError(400, "Η ζώνη δεν είναι στη διαδρομή αυτού του ταξιδιού.");
  if (pct === null) delete stored.quotes[zoneId];
  else stored.quotes[zoneId] = pct;
  await save(v.id, stored);
  await prisma.auditLog.create({
    data: { entity: "voyage", entityId: v.id, action: "WAR_RISK_QUOTE_SET", payload: { zoneId, pct } },
  });
  return getVoyageInsurance(voyageId);
}

/** A person's edits to the notice; edited drafts are never rewritten by the agent. */
export async function updateInsuranceNotice(
  voyageId: string,
  edit: { to: string; subject: string; body: string }
): Promise<VoyageInsuranceDTO> {
  const v = await loadVoyage(voyageId);
  const stored = readStoredInsurance(v.insurance);
  if (!stored.notice) throw new InsuranceError(404, "Δεν υπάρχει δήλωση προς τους ασφαλιστές για αυτό το ταξίδι.");
  if (stored.notice.status === "SENT") throw new InsuranceError(409, "Η δήλωση έχει ήδη σταλεί.");
  stored.notice = { ...stored.notice, ...edit, edited: true };
  await save(v.id, stored);
  return getVoyageInsurance(voyageId);
}

/** Send the notice to the war underwriters (only for a ship at sea, only on a person's click). */
export async function sendInsuranceNotice(voyageId: string): Promise<VoyageInsuranceDTO> {
  const v = await loadVoyage(voyageId);
  if (!isAtSea(v)) throw new InsuranceError(409, NOT_AT_SEA_MESSAGE);
  const stored = readStoredInsurance(v.insurance);
  const n = stored.notice;
  if (!n) throw new InsuranceError(404, "Δεν υπάρχει δήλωση προς τους ασφαλιστές για αυτό το ταξίδι.");
  if (n.status === "SENT") throw new InsuranceError(409, "Η δήλωση έχει ήδη σταλεί.");
  try {
    const { messageId, deliveredTo } = await sendMail({ to: n.to, subject: n.subject, text: n.body });
    const sentAt = new Date().toISOString();
    stored.notice = { ...n, status: "SENT", sentAt, deliveredTo, messageId, lastError: null };
    stored.sentNotices = [{ subject: n.subject, sentAt, deliveredTo }, ...stored.sentNotices];
    await save(v.id, stored);
    await prisma.auditLog.create({
      data: { entity: "voyage", entityId: v.id, action: "WAR_RISK_NOTICE_SENT", payload: { to: n.to, deliveredTo, subject: n.subject } },
    });
  } catch (err) {
    if (err instanceof MailerError) {
      stored.notice = { ...n, lastError: err.message };
      await save(v.id, stored);
      throw new InsuranceError(err.status, err.message);
    }
    throw err;
  }
  return getVoyageInsurance(voyageId);
}

/** The line in the voyages table: computed live, no model call. */
export function insuranceSummary(v: VoyageGeometry & { insurance: unknown }, now = new Date()): VoyageInsuranceSummary {
  const stored = readStoredInsurance(v.insurance);
  const current = assessVoyage(v, stored.quotes, now);
  const change = stored.atDeparture ? compareWarRisk(stored.atDeparture, current) : null;
  return {
    listed: current.needsEndorsement,
    areas: current.exposures.map((e) => e.label),
    insideNow: current.insideNow,
    premiumUsd: current.totals.premiumUsd,
    periods: current.totals.periods,
    extraPeriods: change?.extraPeriods ?? 0,
    noticeStatus: stored.notice?.status ?? null,
  };
}
