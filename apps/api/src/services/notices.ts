import type { Scenario, ScenarioSet } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { getLlmProvider, type NoticeFacts } from "../llm/index.js";
import { mockDraftNotice } from "../llm/charterParty.js";
import { parseTerms, voyageInclude } from "./scenarios.js";
import { savingsVsBaseline } from "@maritime/shared";

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

function emailIn(text: string | null | undefined): string | null {
  return text?.match(EMAIL_RE)?.[0] ?? null;
}

/**
 * Draft the notice to charterers (To) and the port agent (Cc) right after an
 * approval: new ETA, why, and the charter-party terms that apply. It is a
 * DRAFT; nothing is sent without the operator.
 */
export async function draftNoticeForApproval(args: {
  recommendationId: string;
  set: ScenarioSet;
  scenario: Scenario;
  previousEta: Date;
  previousSpeedKn: number;
  /** The speed actually set on approval (re-solved from where the ship is then). */
  newSpeedKn: number;
  newEta: Date;
}) {
  const rec = await prisma.recommendation.findUniqueOrThrow({
    where: { id: args.recommendationId },
    include: { voyage: { include: voyageInclude }, portEvent: { include: { email: true } } },
  });
  const { voyage, portEvent } = rec;
  const terms = voyage.charterParty ? parseTerms(voyage.charterParty.terms) : null;
  const { scenario, set } = args;
  const delta = savingsVsBaseline(set, scenario.id);
  const laytime = scenario.contract.laytime;

  const agentFromNotice = emailIn(portEvent.email?.fromAddr);
  const reportedBy = portEvent.email
    ? portEvent.email.fromAddr.startsWith("Uploaded document")
      ? "The port notice"
      : portEvent.email.fromAddr
    : null;

  const facts: NoticeFacts = {
    vesselName: voyage.vessel.name,
    imo: voyage.vessel.imo,
    originPortName: voyage.originPort.name,
    destPortName: voyage.destPort.name,
    portEventType: portEvent.eventType,
    delayHours: portEvent.delayHours,
    reportedBy,
    previousEtaUtc: args.previousEta.toISOString(),
    newEtaUtc: args.newEta.toISOString(),
    berthTimeUtc: set.berthTime,
    scenarioLabel: `${scenario.id} (${scenario.label})`,
    scenarioDescription: scenario.description,
    newSpeedKn: args.newSpeedKn,
    previousSpeedKn: args.previousSpeedKn,
    fuelSavedT: delta.fuelT,
    co2SavedT: delta.co2T,
    weather: scenario.weather.description,
    cp: terms
      ? {
          reference: terms.reference,
          chartererName: terms.chartererName,
          laytimeHours: terms.laytimeHours,
          laytimeBasis: terms.laytimeBasis,
          norNoticeHours: terms.norNoticeHours,
          waitingTimeCounts: terms.waitingTimeCounts,
          demurrageRatePerDay: terms.demurrageRatePerDay,
          currency: terms.currency,
          jitClauseName: terms.jitClause.present ? terms.jitClause.name : null,
          jitCoverage: scenario.contract.jit.note,
          jitStatus: scenario.contract.jit.status,
          laytimeUsedHours: laytime?.usedHours ?? null,
          withinLaytime: laytime?.withinLaytime ?? null,
          demurrageAvoided: delta.demurrageAvoided,
        }
      : null,
  };

  let draft;
  try {
    draft = await getLlmProvider().draftNotice(facts);
  } catch {
    draft = await mockDraftNotice(facts);
  }

  const to = terms?.chartererEmail ?? "";
  const cc = [terms?.agentEmail, agentFromNotice]
    .filter((e): e is string => !!e)
    .filter((e, i, arr) => arr.indexOf(e) === i && e !== to)
    .join(", ");

  return prisma.outboundEmail.create({
    data: {
      recommendationId: rec.id,
      toAddrs: to,
      ccAddrs: cc,
      subject: draft.subject,
      body: draft.body,
      status: "DRAFT",
    },
  });
}

const fmtUtc = (d: Date) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;

/**
 * An approval was undone after its notice had gone out: draft the correction,
 * to the same people, so they are not left with an ETA that no longer holds.
 * A DRAFT, like every notice; written from a template, no model call.
 */
export async function draftCorrectionNotice(args: {
  recommendationId: string;
  sent: { toAddrs: string; ccAddrs: string; subject: string; sentAt: Date | null };
  vesselName: string;
  imo: string;
  destPortName: string;
  restoredSpeedKn: number;
  restoredEta: Date;
}) {
  const { sent } = args;
  const sentOn = sent.sentAt ? ` of ${fmtUtc(sent.sentAt)}` : "";
  const body = [
    "Dear Charterers,",
    "",
    `Re: ${args.vesselName} (IMO ${args.imo}) — ${args.destPortName}`,
    "",
    `Please disregard our notice${sentOn} ("${sent.subject}"). The speed change it announced has been cancelled.`,
    "",
    `The vessel continues at ${args.restoredSpeedKn.toFixed(1)} kn. ETA ${args.destPortName}: ${fmtUtc(args.restoredEta)}.`,
    "",
    "We will advise if this changes.",
    "",
    "Operations",
  ].join("\n");
  return prisma.outboundEmail.create({
    data: {
      recommendationId: args.recommendationId,
      toAddrs: sent.toAddrs,
      ccAddrs: sent.ccAddrs,
      subject: `Correction – ${sent.subject.replace(/^Correction – /, "")}`,
      body,
      status: "DRAFT",
    },
  });
}
