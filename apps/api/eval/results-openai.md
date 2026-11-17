# Extraction Eval Results

Provider under test: `openai` (model `gpt-5-mini`)
Run at: 2026-11-17T15:00:58.746Z

## Summary

Exact-match emails: **12 / 12** (100.0%)

| Field | Correct | Total | Accuracy |
|---|---|---|---|
| eventType | 12 | 12 | 100.0% |
| portName | 12 | 12 | 100.0% |
| portUnlocode | 12 | 12 | 100.0% |
| vesselNameMentioned | 12 | 12 | 100.0% |
| delayHours | 12 | 12 | 100.0% |
| newBerthTime | 12 | 12 | 100.0% |

## Per-email detail

### eval-01-berth-delay-basic ✅

Plain English berth delay, single port, single vessel.

- ✓ eventType: expected `BERTH_DELAY`, got `BERTH_DELAY`
- ✓ portName: expected `Rotterdam`, got `Rotterdam`
- ✓ portUnlocode: expected `NLRTM`, got `NLRTM`
- ✓ vesselNameMentioned: expected `MV Aegean Star`, got `MV Aegean Star`
- ✓ delayHours: expected `24`, got `24`
- ✓ newBerthTime: expected `2026-11-25T14:00:00.000Z`, got `2026-11-25T14:00:00.000Z`

### eval-02-congestion ✅

Congestion event with its own delay figure and berth time.

- ✓ eventType: expected `CONGESTION`, got `CONGESTION`
- ✓ portName: expected `Singapore`, got `Singapore`
- ✓ portUnlocode: expected `SGSIN`, got `SGSIN`
- ✓ vesselNameMentioned: expected `MV Cycladic Wind`, got `MV Cycladic Wind`
- ✓ delayHours: expected `18`, got `18`
- ✓ newBerthTime: expected `2026-11-26T09:30:00.000Z`, got `2026-11-26T09:30:00.000Z`

### eval-03-closure-no-date ✅

Closure event with no numeric delay or berth time mentioned.

- ✓ eventType: expected `CLOSURE`, got `CLOSURE`
- ✓ portName: expected `Antwerp`, got `Antwerp`
- ✓ portUnlocode: expected `BEANR`, got `BEANR`
- ✓ vesselNameMentioned: expected `MV Hellenic Pioneer`, got `MV Hellenic Pioneer`
- ✓ delayHours: expected `null`, got `null`
- ✓ newBerthTime: expected `null`, got `null`

### eval-04-no-event-invoice ✅

Irrelevant billing email, must be classified NONE.

- ✓ eventType: expected `NONE`, got `NONE`
- ✓ portName: expected `null`, got `null`
- ✓ portUnlocode: expected `null`, got `null`
- ✓ vesselNameMentioned: expected `null`, got `null`
- ✓ delayHours: expected `null`, got `null`
- ✓ newBerthTime: expected `null`, got `null`

### eval-05-no-event-newsletter ✅

Generic industry newsletter, no port event or vessel reference.

- ✓ eventType: expected `NONE`, got `NONE`
- ✓ portName: expected `null`, got `null`
- ✓ portUnlocode: expected `null`, got `null`
- ✓ vesselNameMentioned: expected `null`, got `null`
- ✓ delayHours: expected `null`, got `null`
- ✓ newBerthTime: expected `null`, got `null`

### eval-06-greek-delay ✅

Berth delay email written entirely in Greek.

- ✓ eventType: expected `BERTH_DELAY`, got `BERTH_DELAY`
- ✓ portName: expected `Valencia`, got `Valencia`
- ✓ portUnlocode: expected `ESVLC`, got `ESVLC`
- ✓ vesselNameMentioned: expected `MV Ionian Trader`, got `MV Ionian Trader`
- ✓ delayHours: expected `10`, got `10`
- ✓ newBerthTime: expected `2026-11-27T06:00:00.000Z`, got `2026-11-27T06:00:00.000Z`

### eval-07-greek-english-mix ✅

Mixed Greek/English wording for a congestion event.

- ✓ eventType: expected `CONGESTION`, got `CONGESTION`
- ✓ portName: expected `Shanghai`, got `Shanghai`
- ✓ portUnlocode: expected `CNSHA`, got `CNSHA`
- ✓ vesselNameMentioned: expected `MV Hellenic Pioneer`, got `MV Hellenic Pioneer`
- ✓ delayHours: expected `8`, got `8`
- ✓ newBerthTime: expected `2026-11-28T10:00:00.000Z`, got `2026-11-28T10:00:00.000Z`

### eval-08-multi-port-disambiguation ✅

Two ports mentioned; the UN/LOCODE identifies the correct (destination) port despite the origin port being named earlier in plain text.

- ✓ eventType: expected `BERTH_DELAY`, got `BERTH_DELAY`
- ✓ portName: expected `Hamburg`, got `Hamburg`
- ✓ portUnlocode: expected `DEHAM`, got `DEHAM`
- ✓ vesselNameMentioned: expected `MV Poseidon Glory`, got `MV Poseidon Glory`
- ✓ delayHours: expected `30`, got `30`
- ✓ newBerthTime: expected `2026-11-30T05:00:00.000Z`, got `2026-11-30T05:00:00.000Z`

### eval-09-closure-no-vessel-name ✅

Closure event referring only generically to 'inbound vessels', no named ship.

- ✓ eventType: expected `CLOSURE`, got `CLOSURE`
- ✓ portName: expected `Algeciras`, got `Algeciras`
- ✓ portUnlocode: expected `ESALG`, got `ESALG`
- ✓ vesselNameMentioned: expected `null`, got `null`
- ✓ delayHours: expected `20`, got `20`
- ✓ newBerthTime: expected `2026-12-01T08:00:00.000Z`, got `2026-12-01T08:00:00.000Z`

### eval-10-date-format-variant ✅

Berth time given with a T separator instead of a space.

- ✓ eventType: expected `BERTH_DELAY`, got `BERTH_DELAY`
- ✓ portName: expected `Genoa`, got `Genoa`
- ✓ portUnlocode: expected `ITGOA`, got `ITGOA`
- ✓ vesselNameMentioned: expected `MV Olympic Horizon`, got `MV Olympic Horizon`
- ✓ delayHours: expected `15`, got `15`
- ✓ newBerthTime: expected `2026-11-29T12:00:00.000Z`, got `2026-11-29T12:00:00.000Z`

### eval-11-earliest-keyword-wins ✅

Subject announces congestion; body later also mentions closure and delay wording. The earliest-mentioned event type (congestion, from the subject) should win.

- ✓ eventType: expected `CONGESTION`, got `CONGESTION`
- ✓ portName: expected `Houston`, got `Houston`
- ✓ portUnlocode: expected `USHOU`, got `USHOU`
- ✓ vesselNameMentioned: expected `MV Marathon Spirit`, got `MV Marathon Spirit`
- ✓ delayHours: expected `10`, got `10`
- ✓ newBerthTime: expected `2026-12-02T03:00:00.000Z`, got `2026-12-02T03:00:00.000Z`

### eval-12-no-event-routine-update ✅

Mentions a real port and a named vessel, but describes no delay/congestion/closure event.

- ✓ eventType: expected `NONE`, got `NONE`
- ✓ portName: expected `null`, got `null`
- ✓ portUnlocode: expected `null`, got `null`
- ✓ vesselNameMentioned: expected `null`, got `null`
- ✓ delayHours: expected `null`, got `null`
- ✓ newBerthTime: expected `null`, got `null`
