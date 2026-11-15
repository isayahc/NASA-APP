/**
 * NASA-APP's first executable lunar-foundry process domain.
 *
 * This module imports the *actual* Mapped-Assembly/OpenIndustries job scheduler,
 * conservation ledger, transaction executor, SQLite authority and event history.
 * The UI is a consumer of committed state: it is not a clock or a controller.
 *
 * Process scope: finite regolith delivery -> metering -> energy-accounted preheat.
 * This is explicitly NOT an electrolysis, oxygen or lunar geology simulator.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { SqliteAuthority } from "../../vendor/openindustries/server/simulation/sqlite-authority.mjs";
import { SqliteEventHistory } from "../../vendor/openindustries/server/simulation/events.mjs";
import { executeTransactionalCommand, canonicalCommand } from "../../vendor/openindustries/server/simulation/commands.mjs";
import {
  createResourceBalances,
  settleResourceBalances,
  validateResourceBalances,
} from "../../vendor/openindustries/server/simulation/resource-balances.mjs";
import {
  createJobSchedule,
  enqueueJob,
  advanceJobSchedule,
  controlJob,
  validateJobSchedule,
} from "../../vendor/openindustries/server/simulation/jobs.ts";

import type { DomainPin, JsonObject, SimulationCommand } from "../../vendor/openindustries/server/simulation/contracts.ts";
import type { JobPolicy, JobSchedule, JobStepContext, SimulationJob } from "../../vendor/openindustries/server/simulation/job-contracts.ts";
import type { BalanceAccount, ResourceBalanceLedger } from "../../vendor/openindustries/server/simulation/event-runtime-contracts.ts";
import type { ResourceAllocation } from "../../vendor/openindustries/server/simulation/resource-contracts.ts";

export const RULE: DomainPin = {
  module_id: "nasa-lunar-foundry",
  module_version: "transfer-and-preheat-v1",
  schema_version: 1,
};
export const SCHEMA_VERSION = 1;
export const JOBS = {
  delivery: "regolith-delivery",
  feeding: "hopper-to-preheater",
  heating: "preheat-regolith",
} as const;
export type Phase = "IDLE" | "RESERVED" | "RUNNING" | "COMPLETED" | "BLOCKED" | "FAILED";
type Account = "site" | "transit" | "hopper" | "preheater" | "energy" | "energy-spent";
type Resource = "regolith" | "electricity";
type LotId = string;

export interface Scenario {
  /** Exact versioned source that defines all experimental operating assumptions. */
  format: "nasa.foundry-first-transfer";
  version: 1;
  site: string;
  scene_id: string;
  machine_ids: { excavator: string; hopper: string; preheater: string };
  lot: {
    id: string;
    provenance: string;
    composition: {
      source: string;
      oxygen_bearing_oxide_mass_fraction: number;
      remainder: string;
    };
  };
  opening: { source_regolith_g: number; hopper_regolith_g?: number; available_energy_mJ: number };
  constraints: {
    delivery_g: number;
    hopper_capacity_g: number;
    preheater_capacity_g: number;
    delivery_ticks: number;
    feed_ticks: number;
    heating_ticks: number;
    tick_ms: number;
    power_limit_w: number;
    heater_requested_w: number;
    ambient_temperature_mK: number;
    initial_temperature_mK: number;
    target_temperature_mK: number;
    heat_capacity_J_kg_K: number;
    heat_loss_W_K: number;
  };
}

export interface RegolithLot {
  /** Stable material identity, inherited from the scenario through all accounts. */
  lot_id: string;
  provenance: string;
  composition_source: string;
  oxygen_bearing_oxide_mass_fraction: number;
}

export interface MachineTask {
  /** Actual OI scheduler's durable state. */
  id: string;
  machine_id: string;
  status: SimulationJob["state"];
  reason: string | null;
  completed_steps: number;
  phase_work_ms: number;
}
export interface MaterialTransfer {
  /** One physical OI ledger posting; mass never comes from a render event. */
  lot_id: string;
  source: Account;
  destination: Account;
  mass_g: number;
  job_id: string;
  at_ms: number;
}
export interface PowerAllocation {
  /** Requested/delivered electrical load, in integer watts. */
  requested_w: number;
  available_w: number;
  actually_supplied_w: number;
  consumed_mJ: number;
}
export interface ThermalState {
  /** Millikelvin allows integer-only reproducible integration. */
  temperature_mK: number;
  ambient_temperature_mK: number;
  target_temperature_mK: number;
  input_energy_mJ: number;
  lost_energy_mJ: number;
  last_applied_power_w: number;
  output_ready: boolean;
}
export interface MachineObservation {
  /** Modeled instrument reading, never a real lunar measurement. */
  id: string;
  source_id: string;
  source_revision: string;
  at_ms: number;
  origin: "simulated";
  validity: "modeled";
  task_id: string;
  value: {
    regolith_site_g: number;
    regolith_transit_g: number;
    hopper_g: number;
    preheater_g: number;
    energy_remaining_mJ: number;
    temperature_mK: number;
    heater_power_w: number;
  };
}

interface DomainState {
  resources: ResourceBalanceLedger;
  thermal: ThermalState;
  power_limit_w: number;
  feed_blocked: boolean;
  transfer_log: MaterialTransfer[];
  observations: MachineObservation[];
}
export interface FoundryState {
  contract_version: 1;
  instance_id: string;
  owner_id: string;
  revision: number;
  simulation_time_ms: number;
  scene_id: string;
  model_sha256: string;
  scenario: Scenario;
  schedule: JobSchedule;
}
export interface FoundrySnapshot {
  version: 1;
  instance_id: string;
  revision: number;
  simulation_time_ms: number;
  scene_id: string;
  model_sha256: string;
  inventory_g: Record<"site" | "transit" | "hopper" | "preheater", number>;
  energy_mJ: { available: number; spent: number; opening: number };
  thermal: ThermalState;
  last_transfers: MaterialTransfer[];
  observations: MachineObservation[];
  machines: MachineTask[];
  provenance: { origin: "simulated"; validity: "modeled"; source: string };
  mass_conserved: boolean;
  energy_conserved: boolean;
}
interface CommandResult {
  command_id: string;
  snapshot: FoundrySnapshot;
}

const MAX_QUANTUM = 60000;
const DB_VERSION = 121;
const MAX_OBSERVATIONS = 160;

function ensure(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error("INVALID_FOUNDRY: " + reason);
}

function whole(value: unknown, label: string, min = 0): number {
  ensure(Number.isSafeInteger(value) && Number(value) >= min, label);
  return Number(value);
}

/** Validate a user-supplied scenario before creating any persistent resources. */
export function validateScenario(input: unknown): Scenario {
  ensure(input !== null && typeof input === "object" && !Array.isArray(input), "scenario object");
  const s = input as Scenario;
  ensure(s.format === "nasa.foundry-first-transfer" && s.version === 1, "scenario version");
  ensure(typeof s.site === "string" && s.site.length > 0, "site");
  ensure(typeof s.scene_id === "string" && s.scene_id.length > 0, "scene ID");
  ensure(s.machine_ids?.excavator === "foundry-machine-01" &&
    s.machine_ids?.hopper === "foundry-machine-02" &&
    s.machine_ids?.preheater === "foundry-machine-03", "scene machine binding");
  ensure(typeof s.lot?.id === "string" && /^[a-zA-Z0-9_-]+$/.test(s.lot.id), "lot ID");
  ensure(typeof s.lot.provenance === "string" && s.lot.provenance.length > 0, "provenance");
  ensure(typeof s.lot.composition?.source === "string" &&
    s.lot.composition.source.includes("assumption"), "composition source must say assumed");
  ensure(typeof s.lot.composition.oxygen_bearing_oxide_mass_fraction === "number" &&
    s.lot.composition.oxygen_bearing_oxide_mass_fraction >= 0 &&
    s.lot.composition.oxygen_bearing_oxide_mass_fraction <= 1, "oxide fraction");
  const c = s.constraints;
  ensure(c && typeof c === "object", "constraints");
  whole(s.opening?.source_regolith_g, "finite regolith");
  whole(s.opening.hopper_regolith_g ?? 0, "opening hopper regolith");
  whole(s.opening?.available_energy_mJ, "finite energy");
  whole(c.delivery_g, "delivery", 1);
  whole(c.hopper_capacity_g, "hopper capacity", 1);
  whole(c.preheater_capacity_g, "preheater capacity", 1);
  whole(c.delivery_ticks, "delivery ticks", 1);
  whole(c.feed_ticks, "feed ticks", 1);
  whole(c.heating_ticks, "heating ticks", 1);
  whole(c.tick_ms, "quantum", 1);
  ensure(c.tick_ms <= MAX_QUANTUM &&
    c.tick_ms === 1000, "one-second controlled demonstration quantum");
  whole(c.power_limit_w, "power supply");
  whole(c.heater_requested_w, "heater requested W");
  whole(c.ambient_temperature_mK, "ambient temperature", 1);
  whole(c.initial_temperature_mK, "initial temperature", 1);
  whole(c.target_temperature_mK, "target temperature", 1);
  whole(c.heat_capacity_J_kg_K, "heat capacity", 1);
  whole(c.heat_loss_W_K, "loss coefficient");
  ensure(c.initial_temperature_mK >= c.ambient_temperature_mK, "initial ambient relationship");
  ensure(c.target_temperature_mK > c.initial_temperature_mK, "target > starting temperature");
  ensure((s.opening.hopper_regolith_g ?? 0) <= c.hopper_capacity_g, "initial hopper overflow");
  ensure(c.delivery_g <= c.preheater_capacity_g && c.delivery_g <= c.hopper_capacity_g,
    "initial transfer exceeds physical capacity");
  ensure(c.delivery_g % c.feed_ticks === 0, "feed step must be exact integer grams");
  for (const tickCount of [c.delivery_ticks, c.feed_ticks, c.heating_ticks])
    ensure(tickCount * c.tick_ms <= Number.MAX_SAFE_INTEGER, "duration overflow");
  return structuredClone(s);
}

/** Return the conserved quantity in one OI resource account. */
function amount(ledger: ResourceBalanceLedger, account: Account, resource: Resource): number {
  return ledger.balances
    .filter((r) => r.account_id === account && r.resource_id === resource)
    .reduce((n, r) => n + r.quantity, 0);
}

/** Apply a physically bounded, exact conservation transfer through OI ledger v2. */
function move(
  domain: DomainState, source: Account, destination: Account, resource: Resource,
  quantity: number, jobId: string, effectId: string, atMs: number,
  lot: LotId,
): void {
  whole(quantity, "transfer quantity", 1);
  const before = validateResourceBalances(domain.resources);
  ensure(amount(before, source, resource) >= quantity, "insufficient " + source + " " + resource);
  const units = resource === "regolith" ? "g" as const : "mJ" as const;
  const next: ResourceAllocation[] = structuredClone(before.balances);
  const row = next.find((r) => r.account_id === source && r.resource_id === resource && r.lot_id === lot);
  ensure(row && row.quantity >= quantity, "lot missing at source");
  row.quantity -= quantity;
  const incoming = next.find((r) => r.account_id === destination && r.resource_id === resource && r.lot_id === lot);
  if (incoming) incoming.quantity += quantity;
  else next.push({ account_id: destination, lot_id: lot, resource_id: resource, unit: units, quantity });
  const newBalances = next.filter((r) => r.quantity > 0);
  domain.resources = settleResourceBalances(
    before,
    {
      id: effectId,
      expected_sequence: before.sequence,
      simulation_time_ms: atMs,
      actor: { kind: "worker", principal_id: null },
      job_ids: [jobId],
    },
    before.accounts,
    newBalances,
    [],
    (_old, request) =>
      request.credits.length === 0 &&
      request.context.actor.kind === "worker" &&
      request.context.job_ids.length === 1 &&
      request.context.job_ids[0] === jobId,
  );
  if (resource === "regolith") {
    domain.transfer_log.push({
      lot_id: lot, source, destination,
      mass_g: quantity, job_id: jobId, at_ms: atMs,
    });
    if (domain.transfer_log.length > 150)
      domain.transfer_log.splice(0, domain.transfer_log.length - 150);
  }
}

/** Return a read-only, scenario-bound instrument observation. */
function record(domain: DomainState, taskId: string, id: string, atMs: number, scenario: Scenario): void {
  const ledger = domain.resources;
  domain.observations.push({
    id, source_id: scenario.machine_ids.preheater,
    source_revision: "NASA-APP-transfer-and-preheat-v1",
    at_ms: atMs, origin: "simulated", validity: "modeled", task_id: taskId,
    value: {
      regolith_site_g: amount(ledger, "site", "regolith"),
      regolith_transit_g: amount(ledger, "transit", "regolith"),
      hopper_g: amount(ledger, "hopper", "regolith"),
      preheater_g: amount(ledger, "preheater", "regolith"),
      energy_remaining_mJ: amount(ledger, "energy", "electricity"),
      temperature_mK: domain.thermal.temperature_mK,
      heater_power_w: domain.thermal.last_applied_power_w,
    },
  });
  if (domain.observations.length > MAX_OBSERVATIONS)
    domain.observations.splice(0, domain.observations.length - MAX_OBSERVATIONS);
}

/** Domain-owned process rules; OI owns job ordering, retries and paid work progress. */
function jobPolicy(scenario: Scenario): JobPolicy {
  const cfg = scenario.constraints;
  const lot = scenario.lot.id;
  return {
    validate: (raw: JsonObject): void => {
      const domain = raw as unknown as DomainState;
      validateResourceBalances(domain.resources);
      const mass = ["site", "transit", "hopper", "preheater"]
        .reduce((sum, name) => sum + amount(domain.resources, name as Account, "regolith"), 0);
      ensure(mass === scenario.opening.source_regolith_g + (scenario.opening.hopper_regolith_g ?? 0), "regolith conservation");
      const energy = amount(domain.resources, "energy", "electricity") +
        amount(domain.resources, "energy-spent", "electricity");
      ensure(energy === scenario.opening.available_energy_mJ, "energy conservation");
      whole(domain.thermal.temperature_mK, "temperature in millikelvin", 1);
      whole(domain.thermal.input_energy_mJ, "cumulative heat energy");
      whole(domain.thermal.lost_energy_mJ, "cumulative thermal loss");
      whole(domain.power_limit_w, "power limit");
      ensure(domain.thermal.output_ready === false ||
        domain.thermal.temperature_mK >= cfg.target_temperature_mK, "premature ready");
      ensure(domain.observations.every((o) => o.origin === "simulated" && o.validity === "modeled"),
        "untrusted physical observation");
    },
    step: (raw: JsonObject, context: JobStepContext) => {
      const domain = raw as unknown as DomainState;
      const id = context.job.id;
      const at = context.at_ms;
      const effect = context.effect_id;
      if (id === JOBS.delivery) {
        if (context.job.completed_steps === 0) {
          if (amount(domain.resources, "site", "regolith") < cfg.delivery_g)
            return { kind: "waiting" as const, reason: "source-depleted" };
          move(domain, "site", "transit", "regolith", cfg.delivery_g, id, effect + ":pickup", at, lot);
        }
        if (context.completes_phase) {
          if (amount(domain.resources, "hopper", "regolith") + cfg.delivery_g > cfg.hopper_capacity_g)
            return { kind: "waiting" as const, reason: "hopper-full" };
          move(domain, "transit", "hopper", "regolith", cfg.delivery_g, id, effect + ":unload", at, lot);
        }
      } else if (id === JOBS.feeding) {
        const perTick = cfg.delivery_g / cfg.feed_ticks;
        if (domain.feed_blocked) return { kind: "waiting" as const, reason: "feeder-blocked" };
        if (amount(domain.resources, "hopper", "regolith") < perTick)
          return { kind: "waiting" as const, reason: "hopper-empty" };
        if (amount(domain.resources, "preheater", "regolith") + perTick > cfg.preheater_capacity_g)
          return { kind: "waiting" as const, reason: "preheater-full" };
        move(domain, "hopper", "preheater", "regolith", perTick, id, effect + ":feed", at, lot);
      } else if (id === JOBS.heating) {
        const massG = amount(domain.resources, "preheater", "regolith");
        if (massG !== cfg.delivery_g)
          return { kind: "waiting" as const, reason: "no-validated-preheater-lot" };
        const t = domain.thermal;
        const currentW = t.temperature_mK < cfg.target_temperature_mK
          ? Math.min(cfg.heater_requested_w, domain.power_limit_w) : 0;
        if (t.temperature_mK < cfg.target_temperature_mK && currentW === 0)
          return { kind: "waiting" as const, reason: "insufficient-power" };
        const requiredEnergy = currentW * cfg.tick_ms;
        if (amount(domain.resources, "energy", "electricity") < requiredEnergy)
          return { kind: "waiting" as const, reason: "energy-exhausted" };
        if (requiredEnergy > 0) {
          move(domain, "energy", "energy-spent", "electricity",
            requiredEnergy, id, effect + ":energy", at, "stored-energy");
        }
        const aboveAmbientMK = Math.max(0, t.temperature_mK - cfg.ambient_temperature_mK);
        // UA * delta(K) gives W; multiply by duration(ms) to get mJ.
        const lossW = Math.floor((cfg.heat_loss_W_K * aboveAmbientMK) / 1000);
        const lossMilliJoule = Math.min(
          cfg.tick_ms * lossW,
          Math.max(0, requiredEnergy + Math.floor(
            massG * cfg.heat_capacity_J_kg_K *
            (t.temperature_mK - cfg.ambient_temperature_mK) / 1000,
          )),
        );
        const changeMilliK = Math.floor(
          (1000 * (requiredEnergy - lossMilliJoule)) /
          (massG * cfg.heat_capacity_J_kg_K),
        );
        t.temperature_mK = Math.max(cfg.ambient_temperature_mK, t.temperature_mK + changeMilliK);
        t.input_energy_mJ += requiredEnergy;
        t.lost_energy_mJ += lossMilliJoule;
        t.last_applied_power_w = currentW;
        if (context.completes_phase && t.temperature_mK < cfg.target_temperature_mK)
          return { kind: "failed" as const, reason: "temperature-below-release-criterion" };
        if (context.completes_phase) t.output_ready = true;
      } else {
        return { kind: "failed" as const, reason: "unknown-job" };
      }
      record(domain, id, effect, at, scenario);
      return { kind: "worked" as const, domain: domain as unknown as JsonObject };
    },
    interrupt: (raw: JsonObject, job: Readonly<SimulationJob>, action, atMs: number): JsonObject => {
      const domain = raw as unknown as DomainState;
      if ((action === "cancel" || action === "fail") && job.id === JOBS.delivery) {
        const held = amount(domain.resources, "transit", "regolith");
        if (held > 0) move(domain, "transit", "site", "regolith",
          held, job.id, "interrupt:" + job.id + ":" + atMs, atMs, lot);
      }
      domain.thermal.last_applied_power_w = 0;
      return domain as unknown as JsonObject;
    },
  };
}

/** Create an authoritative OI v2 resource ledger with finite, named lots. */
function createDomain(id: string, scenario: Scenario): DomainState {
  const cfg = scenario.constraints;
  const accounts: BalanceAccount[] = [
    { id: "site", kind: "stock", owner_id: null, job_id: null, unit: "g", capacity: null },
    { id: "transit", kind: "cargo", owner_id: null, job_id: null, unit: "g", capacity: cfg.delivery_g },
    { id: "hopper", kind: "stock", owner_id: null, job_id: null, unit: "g", capacity: cfg.hopper_capacity_g },
    { id: "preheater", kind: "wip", owner_id: null, job_id: null, unit: "g", capacity: cfg.preheater_capacity_g },
    { id: "energy", kind: "stock", owner_id: null, job_id: null, unit: "mJ", capacity: null },
    { id: "energy-spent", kind: "spent", owner_id: null, job_id: null, unit: "mJ", capacity: null },
  ];
  const opening: ResourceAllocation[] = [];
  if (scenario.opening.source_regolith_g > 0)
    opening.push({ account_id: "site", resource_id: "regolith", lot_id: scenario.lot.id, unit: "g",
      quantity: scenario.opening.source_regolith_g });
  if ((scenario.opening.hopper_regolith_g ?? 0) > 0)
    opening.push({ account_id: "hopper", resource_id: "regolith", lot_id: scenario.lot.id, unit: "g",
      quantity: scenario.opening.hopper_regolith_g! });
  if (scenario.opening.available_energy_mJ > 0)
    opening.push({ account_id: "energy", resource_id: "electricity",
      lot_id: "stored-energy", unit: "mJ", quantity: scenario.opening.available_energy_mJ });
  return {
    resources: createResourceBalances(id, RULE, accounts, opening, 0),
    thermal: {
      temperature_mK: cfg.initial_temperature_mK,
      ambient_temperature_mK: cfg.ambient_temperature_mK,
      target_temperature_mK: cfg.target_temperature_mK,
      input_energy_mJ: 0,
      lost_energy_mJ: 0,
      last_applied_power_w: 0,
      output_ready: false,
    },
    power_limit_w: cfg.power_limit_w,
    feed_blocked: false,
    transfer_log: [],
    observations: [],
  };
}

/** Create deterministic scenario-bound job definitions with no background wall clock. */
function queueJobs(schedule: JobSchedule, scenario: Scenario, owner: string): JobSchedule {
  const c = scenario.constraints;
  const phase = (id: string, ticks: number) => [{
    id, duration_ms: ticks * c.tick_ms, interruptions: ["pause", "resume", "cancel"],
  }];
  let next = schedule;
  next = enqueueJob(next, {
    id: JOBS.delivery, owner_id: owner, priority: 10, dependencies: [],
    phases: phase("dig-haul-dump", c.delivery_ticks),
  });
  next = enqueueJob(next, {
    id: JOBS.feeding, owner_id: owner, priority: 9, dependencies: [JOBS.delivery],
    phases: phase("meter-regolith", c.feed_ticks),
  });
  next = enqueueJob(next, {
    id: JOBS.heating, owner_id: owner, priority: 8, dependencies: [JOBS.feeding],
    phases: phase("heat-to-release", c.heating_ticks),
  });
  return next;
}

/** Validate OI contracts plus NASA-specific mass, units, scene ID and thermal rules. */
export function validateFoundryState(s: FoundryState): void {
  ensure(s.contract_version === SCHEMA_VERSION, "factory schema version");
  ensure(s.instance_id.length > 0 && s.revision >= 1 && s.owner_id.length > 0, "factory identity");
  ensure(s.scene_id === s.scenario.scene_id, "scene binding");
  const sched = validateJobSchedule(s.schedule);
  ensure(sched.instance_id === s.instance_id, "schedule scope");
  ensure(sched.cursor_ms === s.simulation_time_ms, "simulation clock must equal schedule cursor");
  ensure(canonicalCommand(sched.rule) === canonicalCommand(RULE), "rule pin mismatch");
  ensure(s.model_sha256 === createHash("sha256")
    .update(canonicalCommand(s.scenario)).digest("hex"), "scenario hash mismatch");
  jobPolicy(s.scenario).validate(sched.domain);
}

/** Project operator-facing values from committed OI state without inventing telemetry. */
export function projectFoundry(s: FoundryState): FoundrySnapshot {
  validateFoundryState(s);
  const domain = s.schedule.domain as unknown as DomainState;
  const r = domain.resources;
  const energyAvailable = amount(r, "energy", "electricity");
  const energySpent = amount(r, "energy-spent", "electricity");
  const inventory = {
    site: amount(r, "site", "regolith"),
    transit: amount(r, "transit", "regolith"),
    hopper: amount(r, "hopper", "regolith"),
    preheater: amount(r, "preheater", "regolith"),
  };
  const byJob = new Map(s.schedule.jobs.map((job) => [job.id, job]));
  const machines = Object.entries({
    [JOBS.delivery]: s.scenario.machine_ids.excavator,
    [JOBS.feeding]: s.scenario.machine_ids.hopper,
    [JOBS.heating]: s.scenario.machine_ids.preheater,
  }).map(([id, machineId]) => {
    const job = byJob.get(id);
    return {
      id, machine_id: machineId,
      status: job?.state ?? "queued",
      reason: job?.reason ?? null,
      completed_steps: job?.completed_steps ?? 0,
      phase_work_ms: job?.phase_work_ms ?? 0,
    };
  }) as MachineTask[];
  return {
    version: 1, instance_id: s.instance_id, revision: s.revision,
    simulation_time_ms: s.simulation_time_ms,
    scene_id: s.scene_id, model_sha256: s.model_sha256,
    inventory_g: inventory,
    energy_mJ: {
      available: energyAvailable, spent: energySpent,
      opening: s.scenario.opening.available_energy_mJ,
    },
    thermal: structuredClone(domain.thermal),
    last_transfers: domain.transfer_log.slice(-10),
    observations: domain.observations.slice(-10),
    machines,
    provenance: {
      origin: "simulated", validity: "modeled",
      source: s.scenario.lot.provenance,
    },
    mass_conserved: Object.values(inventory).reduce((a,b) => a+b, 0) ===
      s.scenario.opening.source_regolith_g + (s.scenario.opening.hopper_regolith_g ?? 0),
    energy_conserved: energyAvailable + energySpent === s.scenario.opening.available_energy_mJ,
  };
}

/** Explicit controller command transition through OI job scheduling/ledger APIs. */
function transition(s: FoundryState, command: SimulationCommand): FoundryState {
  const next = structuredClone(s);
  const scenario = next.scenario;
  const policy = jobPolicy(scenario);
  if (command.action === "start") {
    ensure(Object.keys(command.payload).length === 0, "start accepts empty payload");
    ensure(next.schedule.jobs.length === 0, "already started");
    next.schedule = queueJobs(next.schedule, scenario, next.owner_id);
  } else if (command.action === "step") {
    ensure(Object.keys(command.payload).length === 0, "step accepts empty payload");
    next.schedule = advanceJobSchedule(
      next.schedule, next.simulation_time_ms + scenario.constraints.tick_ms, 1, policy,
    );
    next.simulation_time_ms = next.schedule.cursor_ms;
  } else if (command.action === "set-power") {
    ensure(Object.keys(command.payload).length === 1, "set-power requires limit_w only");
    const limit = whole(command.payload.limit_w, "limit W");
    ensure(limit <= scenario.constraints.heater_requested_w, "power limit exceeds design capacity");
    (next.schedule.domain as unknown as DomainState).power_limit_w = limit;
  } else if (command.action === "set-feeder-blocked") {
    ensure(Object.keys(command.payload).length === 1 &&
      typeof command.payload.blocked === "boolean", "feeder blocked flag");
    (next.schedule.domain as unknown as DomainState).feed_blocked = Boolean(command.payload.blocked);
  } else if (command.action === "pause" || command.action === "resume" ||
    command.action === "cancel") {
    ensure(Object.keys(command.payload).length === 1 &&
      typeof command.payload.job_id === "string", "job control requires job ID");
    next.schedule = controlJob(next.schedule, command.payload.job_id as string, next.owner_id,
      command.action, policy);
  } else {
    throw Error("UNSUPPORTED_FOUNDRY_COMMAND");
  }
  validateFoundryState(next);
  return next;
}

/**
 * File-backed, locally authenticated NASA-APP adapter for the actual OI
 * executeTransactionalCommand and SqliteEventHistory contracts.
 */
export class FoundryDatabase extends SqliteAuthority {
  readonly history: SqliteEventHistory;

  constructor(path: string) {
    super(path, { supportedVersions: [0, DB_VERSION] });
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS nasa_foundries (" +
      "id TEXT PRIMARY KEY,owner TEXT NOT NULL,state TEXT NOT NULL CHECK(json_valid(state)));" +
      "CREATE TABLE IF NOT EXISTS nasa_foundry_receipts (" +
      "principal TEXT NOT NULL,command_id TEXT NOT NULL,request TEXT NOT NULL,result TEXT NOT NULL," +
      "PRIMARY KEY(principal,command_id));",
    );
    this.history = new SqliteEventHistory(this.db, { maxEvents: 64, maxBytes: 2 * 1024 * 1024 });
    this.db.exec("PRAGMA user_version=" + DB_VERSION);
  }

  /** Create a new isolated scenario instance. Reset means creating a new ID. */
  create(token: string, id: string, input: unknown): FoundrySnapshot {
    const owner = this.identity(token);
    const scenario = validateScenario(input);
    ensure(/^[a-zA-Z0-9_.:-]{1,90}$/.test(id), "instance ID");
    return this.transaction(() => {
      ensure(!this.db.prepare("SELECT 1 FROM nasa_foundries WHERE id=?").get(id), "existing instance");
      const domain = createDomain(id, scenario);
      const schedule = createJobSchedule(id, RULE, 0, scenario.constraints.tick_ms,
        domain as unknown as JsonObject);
      const state: FoundryState = {
        contract_version: 1, instance_id: id, owner_id: owner,
        revision: 1, simulation_time_ms: 0, scene_id: scenario.scene_id,
        model_sha256: createHash("sha256").update(canonicalCommand(scenario)).digest("hex"),
        scenario, schedule,
      };
      validateFoundryState(state);
      this.db.prepare("INSERT INTO nasa_foundries VALUES(?,?,?)")
        .run(id, owner, JSON.stringify(state));
      this.history.initialize({
        instance_id: id, rule: RULE, revision: state.revision,
        simulation_time_ms: 0, state: state as unknown as JsonObject,
      });
      return projectFoundry(state);
    });
  }

  /** Read a committed, checked snapshot; never return untrusted mutable state. */
  read(token: string, id: string): FoundrySnapshot {
    const owner = this.identity(token);
    return this.transaction(() => {
      const raw = this.load(id);
      ensure(raw.owner_id === owner, "unauthorized instance");
      return projectFoundry(raw);
    });
  }

  /** Internal state read, validated on every invocation. */
  load(id: string): FoundryState {
    const row = this.db.prepare("SELECT state FROM nasa_foundries WHERE id=?").get(id);
    ensure(row && typeof row.state === "string", "instance not found");
    const state = JSON.parse(String(row.state)) as FoundryState;
    validateFoundryState(state);
    return state;
  }

  /** Issue a revision-checked, idempotent controller action using OI's executor. */
  execute(token: string, raw: unknown): CommandResult {
    let latest: FoundryState | null = null;
    const result = executeTransactionalCommand(raw, {
      transaction: (work: () => CommandResult) => this.transaction(work),
      authenticate: () => this.identity(token),
      load: (id: string) => this.load(id),
      instanceId: (s: FoundryState) => s.instance_id,
      revision: (s: FoundryState) => s.revision,
      setRevision: (s: FoundryState, revision: number) => { s.revision = revision; },
      authorized: (s: FoundryState, principal: string) => s.owner_id === principal,
      now: (s: FoundryState) => s.simulation_time_ms,
      receipt: (principal: string, commandId: string) => {
        const row = this.db.prepare(
          "SELECT request,result FROM nasa_foundry_receipts WHERE principal=? AND command_id=?",
        ).get(principal, commandId);
        return row ? {
          request: String(row.request),
          result: JSON.parse(String(row.result)) as CommandResult,
        } : undefined;
      },
      apply: (s: FoundryState, command: SimulationCommand) => {
        const updated = transition(s, command);
        latest = updated;
        return {
          state: updated,
          events: [{
            action: command.action,
            job_id: typeof command.payload.job_id === "string" ? command.payload.job_id : null,
            at_ms: updated.simulation_time_ms,
          }],
        };
      },
      validate: (s: FoundryState) => validateFoundryState(s),
      result: (s: FoundryState, cmd: SimulationCommand): CommandResult => ({
        command_id: cmd.command_id, snapshot: projectFoundry(s),
      }),
      save: (s: FoundryState) => {
        this.db.prepare("UPDATE nasa_foundries SET state=? WHERE id=?")
          .run(JSON.stringify(s), s.instance_id);
      },
      appendEvents: (id: string, commandId: string, principal: string, events: JsonObject[]) => {
        const head = this.history.head(id);
        const persisted = this.load(id);
        this.history.append({
          instance_id: id,
          expected_sequence: head.sequence,
          rule: RULE,
          simulation_time_ms: persisted.simulation_time_ms,
          revision: persisted.revision,
          source: { kind: "command", id: commandId, principal_id: principal },
          links: {
            entity_ids: [
              persisted.scenario.machine_ids.excavator,
              persisted.scenario.machine_ids.hopper,
              persisted.scenario.machine_ids.preheater,
            ],
            job_ids: persisted.schedule.jobs.map((j) => j.id),
          },
          provenance: { origin: "simulated", validity: "modeled", evidence: [] },
          units: [
            { field: "regolith", unit: "g" },
            { field: "energy", unit: "mJ" },
            { field: "work", unit: "ms" },
          ],
          payload: { changes: events, action: events[0]?.action ?? "unknown" },
          state: persisted as unknown as JsonObject,
        });
      },
      saveReceipt: (principal: string, cmd: SimulationCommand, request: string, result: CommandResult) => {
        this.db.prepare("INSERT INTO nasa_foundry_receipts VALUES(?,?,?,?)")
          .run(principal, cmd.command_id, request, JSON.stringify(result));
      },
    }) as CommandResult;
    return result;
  }

  /** Validate a persisted event-history hash chain against committed state. */
  replay(token: string, id: string): FoundrySnapshot {
    const owner = this.identity(token);
    return this.transaction(() => {
      const state = this.load(id);
      ensure(state.owner_id === owner, "unauthorized history");
      const checkpoint = this.history.replay(id);
      const replayed = checkpoint.state as unknown as FoundryState;
      validateFoundryState(replayed);
      ensure(canonicalCommand(replayed) === canonicalCommand(state), "history/state mismatch");
      return projectFoundry(replayed);
    });
  }
}
