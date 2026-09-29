import {
  type ActiveGameState,
  type ClockDomainId,
  type CommandResponse,
  type GameId,
  isClockDomainId,
  type LiveGameCommand,
  type LiveGameRepository,
  type Seat,
} from "@chess-one/live-game";
import {
  type CommandIngress,
  type CommandOutcome,
  type GameSubscriber,
  type GameView,
  type GameWriterPort,
  GameWriterRegistry,
  type RecoveryReason,
  type RuntimeFact,
  type RuntimeLimits,
  type SyncOutcome,
} from "@chess-one/live-game-runtime";
import { actorFor, GAME_ID, START_MS } from "../../live-game/support/harness.ts";
import { ContractRepository } from "../../live-game-persistence/support/contract-repository.ts";
import { DefectLog, RecordingFacts } from "./facts.ts";
import { ControlledRepository } from "./repositories.ts";
import { ManualClock, ManualScheduler, type ManualWake } from "./time.ts";

export function domain(name: string): ClockDomainId {
  if (!isClockDomainId(name)) throw new Error(`invalid clock domain ${name}`);
  return name;
}

export const DOMAIN_A = domain("rt-boot-a");
export const DOMAIN_OLD = domain("rt-boot-old");
/** A delay no deadline wake uses, so idle wakes can be told apart. */
export const IDLE_MS = 777_777;

export interface RuntimeHarness {
  readonly clock: ManualClock;
  readonly scheduler: ManualScheduler;
  readonly facts: RecordingFacts<RuntimeFact>;
  readonly defects: DefectLog;
  /** The repository under the controlled one: the contract double or PostgreSQL. */
  readonly contract: LiveGameRepository;
  readonly repository: ControlledRepository;
  readonly registry: GameWriterRegistry;
}

export function runtimeHarness(
  limits: Partial<RuntimeLimits> = {},
  contract: LiveGameRepository = new ContractRepository(),
  domainId = DOMAIN_A,
): RuntimeHarness {
  const clock = new ManualClock(START_MS);
  const scheduler = new ManualScheduler();
  const facts = new RecordingFacts<RuntimeFact>();
  const defects = new DefectLog();
  const repository = new ControlledRepository(contract);
  const registry = new GameWriterRegistry({
    repository,
    clockDomain: { id: domainId, clock },
    scheduler,
    facts,
    reportDefect: defects.report,
    limits: { idleRetireMs: IDLE_MS, ...limits },
  });
  return { clock, scheduler, facts, defects, contract, repository, registry };
}

export async function store(
  harness: RuntimeHarness,
  state: ActiveGameState,
  clockDomainId: ClockDomainId = DOMAIN_A,
): Promise<void> {
  const created = await harness.contract.createGame(state, clockDomainId);
  if (!created.ok) throw new Error(`game not stored: ${created.error.kind}`);
}

export function writerOf(harness: RuntimeHarness, gameId: GameId = GAME_ID): GameWriterPort {
  const writer = harness.registry.acquire(gameId);
  if (writer === null) throw new Error("no writer");
  return writer;
}

export interface Submission {
  readonly ingress: CommandIngress;
  readonly outcome: Promise<CommandOutcome>;
}

/** Submits as `seat` of `state`'s game, with the actor the trusted session would give. */
export function submitAs(
  writer: GameWriterPort,
  state: ActiveGameState,
  seat: Seat,
  command: LiveGameCommand,
): Submission {
  const answer = Promise.withResolvers<CommandOutcome>();
  const ingress = writer.submitCommand(actorFor(state, seat), command, answer.resolve);
  return { ingress, outcome: answer.promise };
}

export function syncOf(writer: GameWriterPort): Promise<SyncOutcome> {
  const answer = Promise.withResolvers<SyncOutcome>();
  const ingress = writer.requestSync(answer.resolve);
  if (!ingress.accepted) throw new Error(`sync refused: ${ingress.reason}`);
  return answer.promise;
}

export async function decided(submission: Submission): Promise<CommandResponse> {
  const outcome = await submission.outcome;
  if (outcome.kind !== "decided") throw new Error(`expected a decision, got ${outcome.kind}`);
  return outcome.response;
}

export async function viewOf(writer: GameWriterPort): Promise<GameView> {
  const outcome = await syncOf(writer);
  if (outcome.kind !== "snapshot") throw new Error(`expected a snapshot, got ${outcome.reason}`);
  return outcome.view;
}

/** Pending wakes other than idle retirement: at most the one deadline wake. */
export function deadlineWakes(harness: RuntimeHarness): readonly ManualWake[] {
  return harness.scheduler.pending().filter((wake) => wake.delayMs !== IDLE_MS);
}

export async function storedState(harness: RuntimeHarness): Promise<ActiveGameState> {
  const loaded = await harness.contract.loadGame(GAME_ID);
  if (!loaded.ok) throw new Error(`load failed: ${loaded.error.kind}`);
  return loaded.value.state;
}

export class RecordingSubscriber implements GameSubscriber {
  readonly views: GameView[] = [];
  readonly recoveries: RecoveryReason[] = [];
  stopped = 0;

  onUpdate(view: GameView): void {
    this.views.push(view);
  }

  onRecoveryRequired(_gameId: GameId, reason: RecoveryReason): void {
    this.recoveries.push(reason);
  }

  onWriterStopped(): void {
    this.stopped += 1;
  }

  sequences(): number[] {
    return this.views.map((view) => view.sequence);
  }
}
