/* ============================================================
   The demo payroll.

   It stands in for the remote system, not for the connector. That
   distinction decides what it is allowed to keep: a real payroll
   holds the employee record and the TFN it lodged, because that is
   what a payroll is, so this does too. A real CONNECTOR holds
   nothing between calls, and neither does this one — there is no
   cache, no local copy, no "last synced" table.

   It exists so the whole flow can be walked end to end without a
   venue's live payroll on the other end of it, and so the tests can
   assert the two properties that matter and are otherwise invisible:

   • idempotency — provisioning twice creates one employee.
   • the release log — what was sent, and only what was sent.

   The TFN goes in and never comes back out. describe() is what the
   console renders, and there is deliberately no accessor that
   returns the number, because the moment one exists a screen will
   eventually call it.
   ============================================================ */

import type {
  ConnectorCall,
  NewEmployee,
  OAuthGrant,
  PayrollConnector,
  StatementId,
  SuperChoice,
  TfnDeclaration,
  TimeClockConnector,
} from "./types";
import type { DID } from "@/lib/idara/types";

interface MockEmployee {
  externalId: string;
  did: DID;
  name: string;
  email: string;
  startDate: string;
  classification: string;
  /** held, never returned. See describe(). */
  tfn?: string;
  claimsTaxFreeThreshold?: boolean;
  superChoice?: SuperChoice;
  statements: StatementId[];
}

/** What the console may show about an employee this payroll holds. */
export interface EmployeeSummary {
  externalId: string;
  did: DID;
  name: string;
  startDate: string;
  classification: string;
  tfnLodged: boolean;
  claimsTaxFreeThreshold: boolean;
  superRecorded: boolean;
  statements: StatementId[];
}

export class MockPayrollConnector implements PayrollConnector {
  readonly id = "mock" as const;

  private employees = new Map<string, MockEmployee>();
  private nextId = 1;
  private tenantRef: string | null = null;
  /** What the grant actually allows. A real connector shows this before a
      venue is told it is connected — half the scopes is half a connection. */
  scopes: string[] = [];
  /** every call, in order — the tape the provisioning tests read. */
  readonly calls: ConnectorCall[] = [];

  private record(method: string, externalId?: string): void {
    this.calls.push({ method, at: new Date().toISOString(), ...(externalId ? { externalId } : {}) });
  }

  async connect(tenantRef: string, oauth: OAuthGrant): Promise<void> {
    /* A grant with no token is not a connection. Checked even here, because
       the failure it prevents is the worst one this layer has: a venue shown
       as connected, an engagement provisioned against it, and nothing on the
       other end that ever received an employee. */
    if (!oauth.accessToken) throw new Error("A payroll connection needs an access token.");
    this.tenantRef = tenantRef;
    this.scopes = oauth.scopes;
    this.record("connect");
  }

  async findEmployee(query: { did?: DID; email?: string }): Promise<{ externalId: string } | null> {
    this.record("findEmployee");
    for (const e of this.employees.values()) {
      if ((query.did && e.did === query.did) || (query.email && e.email === query.email)) {
        return { externalId: e.externalId };
      }
    }
    return null;
  }

  async createEmployee(input: NewEmployee): Promise<{ externalId: string }> {
    const externalId = `emp-${String(this.nextId++).padStart(4, "0")}`;
    this.employees.set(externalId, {
      externalId,
      did: input.did,
      name: `${input.firstName} ${input.lastName}`,
      email: input.email,
      startDate: input.startDate,
      classification: `${input.classification.stream} L${String(input.classification.level)}`,
      statements: [],
    });
    this.record("createEmployee", externalId);
    return { externalId };
  }

  async lodgeTfnDeclaration(externalId: string, decl: TfnDeclaration): Promise<void> {
    const e = this.require(externalId);
    e.tfn = decl.tfn;
    e.claimsTaxFreeThreshold = decl.claimsTaxFreeThreshold;
    this.record("lodgeTfnDeclaration", externalId);
  }

  async recordSuperChoice(externalId: string, choice: SuperChoice): Promise<void> {
    this.require(externalId).superChoice = choice;
    this.record("recordSuperChoice", externalId);
  }

  async deliverStatements(externalId: string, docs: StatementId[]): Promise<void> {
    const e = this.require(externalId);
    e.statements = [...new Set([...e.statements, ...docs])];
    this.record("deliverStatements", externalId);
  }

  /**
   * Throws on an unknown employee rather than creating one.
   *
   * A payroll that invented an employee to hang a TFN declaration off would
   * lodge somebody's tax details against a person who does not exist, and the
   * provisioning would report success.
   */
  private require(externalId: string): MockEmployee {
    const e = this.employees.get(externalId);
    if (!e) throw new Error(`No employee ${externalId} in this payroll`);
    return e;
  }

  /** What the console renders. Never the number. */
  describe(externalId: string): EmployeeSummary | null {
    const e = this.employees.get(externalId);
    if (!e) return null;
    return {
      externalId: e.externalId,
      did: e.did,
      name: e.name,
      startDate: e.startDate,
      classification: e.classification,
      tfnLodged: Boolean(e.tfn),
      claimsTaxFreeThreshold: Boolean(e.claimsTaxFreeThreshold),
      superRecorded: Boolean(e.superChoice),
      statements: e.statements,
    };
  }

  get connected(): boolean {
    return this.tenantRef !== null;
  }

  get employeeCount(): number {
    return this.employees.size;
  }
}

/** The clock half, same shape and the same idempotency rule. */
export class MockTimeClock implements TimeClockConnector {
  readonly id = "connecteam" as const;

  private users = new Map<string, { userId: string; did: DID; email: string }>();
  private nextId = 1;
  readonly shifts: { userId: string; shiftId: string; siteId: string }[] = [];
  readonly calls: ConnectorCall[] = [];

  async findUser(query: { did?: DID; email?: string }): Promise<{ userId: string } | null> {
    this.calls.push({ method: "findUser", at: new Date().toISOString() });
    for (const u of this.users.values()) {
      if ((query.did && u.did === query.did) || (query.email && u.email === query.email)) {
        return { userId: u.userId };
      }
    }
    return null;
  }

  async createUser(input: { did: DID; firstName: string; lastName: string; email: string }): Promise<{ userId: string }> {
    const userId = `ct-${String(this.nextId++).padStart(4, "0")}`;
    this.users.set(userId, { userId, did: input.did, email: input.email });
    this.calls.push({ method: "createUser", at: new Date().toISOString(), externalId: userId });
    return { userId };
  }

  async assignShift(input: { userId: string; shiftId: string; siteId: string }): Promise<void> {
    // assigning the same shift twice is a no-op, not a second roster line
    if (!this.shifts.some((s) => s.userId === input.userId && s.shiftId === input.shiftId)) {
      this.shifts.push({ userId: input.userId, shiftId: input.shiftId, siteId: input.siteId });
    }
    this.calls.push({ method: "assignShift", at: new Date().toISOString(), externalId: input.userId });
  }
}

/* One connector per process for the demo, so an engagement provisioned by one
   request is found by the next — the same reason the event store and the pack
   vault are cached on globalThis. A real connector is stateless and would not
   need this; the mock is standing in for the remote system's memory. */
const KEY = Symbol.for("covers.mockPayroll");
const CLOCK_KEY = Symbol.for("covers.mockTimeClock");
type Holder = { [KEY]?: MockPayrollConnector; [CLOCK_KEY]?: MockTimeClock };

export function mockPayroll(): MockPayrollConnector {
  const g = globalThis as unknown as Holder;
  return (g[KEY] ??= new MockPayrollConnector());
}

export function mockTimeClock(): MockTimeClock {
  const g = globalThis as unknown as Holder;
  return (g[CLOCK_KEY] ??= new MockTimeClock());
}
