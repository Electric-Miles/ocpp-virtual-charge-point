import type { VCP } from "../vcp";

// OCPP 1.6 Smart Charging types (mirror _json_schema/v16/SetChargingProfile.json)
export type ChargingRateUnit = "A" | "W";
export type ProfilePurpose =
  | "ChargePointMaxProfile"
  | "TxDefaultProfile"
  | "TxProfile";
export type ProfileKind = "Absolute" | "Recurring" | "Relative";
export type RecurrencyKind = "Daily" | "Weekly";

export interface ChargingSchedulePeriod {
  startPeriod: number;
  limit: number;
  numberPhases?: number;
}

export interface ChargingSchedule {
  duration?: number;
  startSchedule?: string;
  chargingRateUnit: ChargingRateUnit;
  chargingSchedulePeriod: ChargingSchedulePeriod[];
  minChargingRate?: number;
}

export interface CsChargingProfile {
  chargingProfileId: number;
  transactionId?: number;
  stackLevel: number;
  chargingProfilePurpose: ProfilePurpose;
  chargingProfileKind: ProfileKind;
  recurrencyKind?: RecurrencyKind;
  validFrom?: string;
  validTo?: string;
  chargingSchedule: ChargingSchedule;
}

export interface StoredProfile {
  connectorId: number;
  profile: CsChargingProfile;
  receivedAt: Date;
}

export interface EffectiveLimit {
  // when true, no profile applies and callers should use their legacy behavior
  unlimited: boolean;
  limitAmps: number;
  limitWatts: number;
  numberPhases: number;
  source?: {
    chargingProfileId: number;
    purpose: ProfilePurpose;
    stackLevel: number;
    unit: ChargingRateUnit;
    rawLimit: number;
  };
}

export interface ResolveOpts {
  transactionId?: number;
  transactionStartedAt?: Date;
}

export interface ClearFilter {
  id?: number;
  connectorId?: number;
  chargingProfilePurpose?: ProfilePurpose;
  stackLevel?: number;
}

// Nominal line-to-neutral voltage used for A<->W conversion. Kept close to the
// ~245-249V the Charge-M8 DLB reports so a tester computing W = V * A on the
// reported MeterValues sees consistent numbers.
export const NOMINAL_VOLTAGE_V = 245;

/**
 * Default number of phases for a VCP when a schedule period does not specify one.
 * Single-phase chargers (<= 7.4kW) draw on one phase; larger units are 3-phase.
 */
function defaultPhases(vcp: VCP): number {
  if (vcp.numberOfPhases === 1 || vcp.numberOfPhases === 3) {
    return vcp.numberOfPhases;
  }
  return vcp.power > 7.4 ? 3 : 1;
}

/**
 * Store an incoming charging profile, applying OCPP 1.6 replacement semantics:
 * a new profile replaces any existing one with the same chargingProfileId, the
 * same transactionId (a DLM sends a series of TxProfiles that overwrite each
 * other within a session), or the same (connectorId, purpose, stackLevel) slot.
 */
export function upsertChargingProfile(
  vcp: VCP,
  connectorId: number,
  profile: CsChargingProfile,
): "Accepted" | "Rejected" {
  // ChargePointMaxProfile only makes sense on connector 0 (the whole station)
  if (
    profile.chargingProfilePurpose === "ChargePointMaxProfile" &&
    connectorId !== 0
  ) {
    return "Rejected";
  }

  vcp.chargingProfiles = vcp.chargingProfiles.filter((sp) => {
    const p = sp.profile;
    const sameId = p.chargingProfileId === profile.chargingProfileId;
    const sameTx =
      profile.transactionId !== undefined &&
      p.transactionId === profile.transactionId;
    const sameSlot =
      sp.connectorId === connectorId &&
      p.chargingProfilePurpose === profile.chargingProfilePurpose &&
      p.stackLevel === profile.stackLevel;
    return !(sameId || sameTx || sameSlot);
  });

  vcp.chargingProfiles.push({ connectorId, profile, receivedAt: new Date() });
  return "Accepted";
}

/**
 * Remove stored profiles matching the (optional) filter. With no filter, clears
 * all profiles. Returns true if at least one profile was removed.
 */
export function clearChargingProfiles(vcp: VCP, filter: ClearFilter): boolean {
  const before = vcp.chargingProfiles.length;
  const hasFilter =
    filter.id !== undefined ||
    filter.connectorId !== undefined ||
    filter.chargingProfilePurpose !== undefined ||
    filter.stackLevel !== undefined;

  if (!hasFilter) {
    vcp.chargingProfiles = [];
    return before > 0;
  }

  vcp.chargingProfiles = vcp.chargingProfiles.filter((sp) => {
    const p = sp.profile;
    // keep (return true) if any provided filter field does NOT match
    if (filter.id !== undefined && p.chargingProfileId !== filter.id) return true;
    if (filter.connectorId !== undefined && sp.connectorId !== filter.connectorId)
      return true;
    if (
      filter.chargingProfilePurpose !== undefined &&
      p.chargingProfilePurpose !== filter.chargingProfilePurpose
    )
      return true;
    if (filter.stackLevel !== undefined && p.stackLevel !== filter.stackLevel)
      return true;
    // all provided filters matched -> remove
    return false;
  });

  return vcp.chargingProfiles.length < before;
}

function isValidNow(profile: CsChargingProfile, now: Date): boolean {
  if (profile.validFrom && now.getTime() < new Date(profile.validFrom).getTime())
    return false;
  if (profile.validTo && now.getTime() > new Date(profile.validTo).getTime())
    return false;
  return true;
}

/**
 * Seconds elapsed within the profile's schedule at `now`, or null if the
 * profile is not currently active (not started yet, or past its duration).
 */
function elapsedSeconds(
  profile: CsChargingProfile,
  now: Date,
  txStartedAt?: Date,
): number | null {
  const sched = profile.chargingSchedule;

  if (profile.chargingProfileKind === "Recurring") {
    // Simplification: anchor Daily to start-of-day and Weekly to start-of-week
    // (Monday 00:00) in UTC, ignoring startSchedule offset.
    const secOfDay =
      now.getUTCHours() * 3600 +
      now.getUTCMinutes() * 60 +
      now.getUTCSeconds();
    if (profile.recurrencyKind === "Weekly") {
      const dayOfWeek = (now.getUTCDay() + 6) % 7; // Monday = 0
      return dayOfWeek * 86400 + secOfDay;
    }
    return secOfDay;
  }

  let startMs: number;
  if (profile.chargingProfileKind === "Relative") {
    startMs = (txStartedAt ?? now).getTime();
  } else if (sched.startSchedule) {
    startMs = new Date(sched.startSchedule).getTime();
  } else if (profile.validFrom) {
    startMs = new Date(profile.validFrom).getTime();
  } else {
    startMs = (txStartedAt ?? now).getTime();
  }

  const elapsed = (now.getTime() - startMs) / 1000;
  if (elapsed < 0) return null; // schedule hasn't started yet
  if (sched.duration !== undefined && elapsed > sched.duration) return null; // expired
  return elapsed;
}

/** The last period whose startPeriod is <= elapsed (periods are cumulative). */
function activePeriod(
  profile: CsChargingProfile,
  elapsed: number,
): ChargingSchedulePeriod | null {
  let chosen: ChargingSchedulePeriod | null = null;
  for (const period of profile.chargingSchedule.chargingSchedulePeriod) {
    if (period.startPeriod <= elapsed) {
      if (!chosen || period.startPeriod >= chosen.startPeriod) {
        chosen = period;
      }
    }
  }
  return chosen;
}

function periodToWatts(
  period: ChargingSchedulePeriod,
  unit: ChargingRateUnit,
  vcp: VCP,
): { watts: number; phases: number } {
  const phases = period.numberPhases ?? defaultPhases(vcp);
  if (unit === "W") {
    return { watts: period.limit, phases };
  }
  // unit === "A"
  return { watts: period.limit * NOMINAL_VOLTAGE_V * phases, phases };
}

interface EvaluatedProfile {
  sp: StoredProfile;
  watts: number;
  phases: number;
  period: ChargingSchedulePeriod;
}

function evaluate(
  sp: StoredProfile,
  vcp: VCP,
  now: Date,
  txStartedAt?: Date,
): EvaluatedProfile | null {
  const p = sp.profile;
  if (!isValidNow(p, now)) return null;
  const elapsed = elapsedSeconds(p, now, txStartedAt);
  if (elapsed === null) return null;
  const period = activePeriod(p, elapsed);
  if (!period) return null;
  const { watts, phases } = periodToWatts(
    period,
    p.chargingSchedule.chargingRateUnit,
    vcp,
  );
  return { sp, watts, phases, period };
}

/** Highest stackLevel wins (ties broken by most recently received). */
function pickBest(
  candidates: StoredProfile[],
  vcp: VCP,
  now: Date,
  txStartedAt?: Date,
): EvaluatedProfile | null {
  const sorted = [...candidates].sort((a, b) => {
    if (b.profile.stackLevel !== a.profile.stackLevel) {
      return b.profile.stackLevel - a.profile.stackLevel;
    }
    return b.receivedAt.getTime() - a.receivedAt.getTime();
  });
  for (const sp of sorted) {
    const ev = evaluate(sp, vcp, now, txStartedAt);
    if (ev) return ev;
  }
  return null;
}

/**
 * Resolve the current effective charging limit for a connector at `now`.
 * Precedence (matching real DLM usage): a TxProfile (or, failing that, a
 * TxDefaultProfile) drives the limit, further capped by any ChargePointMaxProfile
 * on connector 0. When nothing applies, `unlimited` is true.
 */
export function resolveEffectiveLimit(
  vcp: VCP,
  connectorId: number,
  now: Date,
  opts: ResolveOpts = {},
): EffectiveLimit {
  const { transactionId, transactionStartedAt } = opts;

  // TxProfiles are transaction-scoped: they only apply while a transaction is
  // active on the connector. A profile with no transactionId applies to whatever
  // transaction is running; one with a transactionId must match it.
  const txProfiles =
    transactionId === undefined
      ? []
      : vcp.chargingProfiles.filter(
          (sp) =>
            sp.profile.chargingProfilePurpose === "TxProfile" &&
            sp.connectorId === connectorId &&
            (sp.profile.transactionId === undefined ||
              sp.profile.transactionId === transactionId),
        );
  const txDefaultProfiles = vcp.chargingProfiles.filter(
    (sp) =>
      sp.profile.chargingProfilePurpose === "TxDefaultProfile" &&
      (sp.connectorId === connectorId || sp.connectorId === 0),
  );
  const cpMaxProfiles = vcp.chargingProfiles.filter(
    (sp) =>
      sp.profile.chargingProfilePurpose === "ChargePointMaxProfile" &&
      sp.connectorId === 0,
  );

  const tx =
    pickBest(txProfiles, vcp, now, transactionStartedAt) ??
    pickBest(txDefaultProfiles, vcp, now, transactionStartedAt);
  const cpMax = pickBest(cpMaxProfiles, vcp, now, transactionStartedAt);

  const physicalMaxWatts = vcp.power * 1000;

  if (!tx && !cpMax) {
    return {
      unlimited: true,
      limitAmps: 0,
      limitWatts: 0,
      numberPhases: defaultPhases(vcp),
    };
  }

  // effective = min(tx, cpMax) where present; remember which one is binding
  let chosen: EvaluatedProfile = (tx ?? cpMax)!;
  let effWatts = chosen.watts;
  if (tx && cpMax) {
    if (cpMax.watts < tx.watts) {
      chosen = cpMax;
      effWatts = cpMax.watts;
    } else {
      chosen = tx;
      effWatts = tx.watts;
    }
  }

  effWatts = Math.min(effWatts, physicalMaxWatts);
  const phases = chosen.phases;
  const limitAmps = effWatts / (NOMINAL_VOLTAGE_V * phases);

  return {
    unlimited: false,
    limitWatts: effWatts,
    limitAmps,
    numberPhases: phases,
    source: {
      chargingProfileId: chosen.sp.profile.chargingProfileId,
      purpose: chosen.sp.profile.chargingProfilePurpose,
      stackLevel: chosen.sp.profile.stackLevel,
      unit: chosen.sp.profile.chargingSchedule.chargingRateUnit,
      rawLimit: chosen.period.limit,
    },
  };
}

/**
 * Build a composite charging schedule for GetCompositeSchedule by sampling the
 * resolver over now..now+duration and coalescing consecutive equal limits.
 */
export function buildCompositeSchedule(
  vcp: VCP,
  connectorId: number,
  duration: number,
  unit: ChargingRateUnit,
  opts: ResolveOpts & { now?: Date } = {},
): ChargingSchedule {
  const now = opts.now ?? new Date();
  const step = 60; // seconds
  const physicalMaxWatts = vcp.power * 1000;
  const periods: ChargingSchedulePeriod[] = [];
  let lastLimit: number | null = null;

  for (let t = 0; t <= duration; t += step) {
    const at = new Date(now.getTime() + t * 1000);
    const eff = resolveEffectiveLimit(vcp, connectorId, at, opts);
    const phases = eff.numberPhases || defaultPhases(vcp);

    let limitVal: number;
    if (unit === "A") {
      limitVal = eff.unlimited
        ? physicalMaxWatts / (NOMINAL_VOLTAGE_V * phases)
        : eff.limitAmps;
    } else {
      limitVal = eff.unlimited ? physicalMaxWatts : eff.limitWatts;
    }
    limitVal = Math.round(limitVal * 10) / 10;

    if (lastLimit === null || limitVal !== lastLimit) {
      periods.push({ startPeriod: t, limit: limitVal });
      lastLimit = limitVal;
    }
  }

  return {
    duration,
    startSchedule: now.toISOString(),
    chargingRateUnit: unit,
    chargingSchedulePeriod: periods,
  };
}
