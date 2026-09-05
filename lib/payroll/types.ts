/* ============================================================
   Payroll — one method per employment act.

   The interface is small on purpose, and each method is a thing an
   employer must actually do to lawfully employ somebody in
   Australia: create the employee, lodge their TFN declaration
   through STP, record their super choice, hand them the two
   statements. Not "sync employees" or "push data" — those are
   shapes that let a connector do three of the four and still report
   success, and the one it skipped is a legal obligation.

   WE DO NOT BUILD PAYROLL. Never. This layer exists so that the
   twenty minutes a venue spends typing somebody into Xero becomes a
   worker tapping Accept, and so that what was typed can be shown to
   have come from a verified pack rather than from a form.

   Three rules every implementation is held to:

   • Connectors receive decrypted payloads only inside provision(),
     never persist them, and every call is logged as a release on
     the engagement.
   • Idempotent. findEmployee() before createEmployee(), and
     re-running a provision must be safe — a retry after a timeout
     must not create a second employee with the same TFN.
   • One connector per pilot. Do not build three at once.
   ============================================================ */

import type { DID, ISODate } from "@/lib/idara/types";
import type { EmploymentType } from "@/lib/awards";
import type { Level } from "@/lib/awards/rates";

/**
 * The payrolls we can talk to.
 *
 * `mock` is a first-class member rather than a test double smuggled in: a
 * venue with no payroll connected still has to be able to walk the whole flow
 * in a demo, and the alternative — a real connector id pointed at a fake — is
 * how a screen comes to say "connected to Xero" when nothing is.
 */
export type PayrollConnectorId =
  | "mock"
  | "xero"
  | "keypay"
  | "employment_hero"
  | "myob"
  | "connecteam_payroll";

export const PAYROLL_CONNECTORS: Record<PayrollConnectorId, { label: string; note: string }> = {
  mock: { label: "Demo payroll", note: "Records every call. Sends nothing anywhere." },
  xero: { label: "Xero Payroll", note: "OAuth 2.0, tenant-scoped." },
  keypay: { label: "KeyPay / Employment Hero Payroll", note: "Business-scoped API key." },
  employment_hero: { label: "Employment Hero", note: "OAuth 2.0." },
  myob: { label: "MYOB", note: "OAuth 2.0, company file scoped." },
  connecteam_payroll: { label: "Connecteam Payroll", note: "Where the time clock already is." },
};

export interface OAuthGrant {
  accessToken: string;
  refreshToken?: string;
  /** epoch seconds. */
  expiresAt: number;
  scopes: string[];
}

/**
 * What a payroll needs to create an employee.
 *
 * Assembled inside provision() from a released pack, which is why every field
 * here has a pack item behind it. Nothing on this shape is typed by a venue.
 */
export interface NewEmployee {
  /** the worker's DID, so a second engagement can find them again. */
  did: DID;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: ISODate;
  address?: {
    line1: string;
    suburb: string;
    state: string;
    postcode: string;
    country: string;
  };
  startDate: ISODate;
  employmentType: EmploymentType;
  classification: { level: Level; stream: string };
  bank: { bsb: string; accountNumber: string; accountName: string };
  emergencyContact?: { name: string; relationship: string; phone: string };
}

/**
 * The ATO declaration, as the employee answered it.
 *
 * `claimsTaxFreeThreshold` is not the worker's preference at the moment of
 * lodging — it is the engagement's decision, made against the one employer
 * they nominated as primary. See claimsThresholdWith() in lib/idara/pack.ts.
 */
export interface TfnDeclaration {
  tfn: string;
  claimsTaxFreeThreshold: boolean;
  residencyStatus: "resident" | "foreign_resident" | "working_holiday_maker";
  hasStudyAndTrainingLoan: boolean;
}

/**
 * Where super goes.
 *
 * "stapled" is a real answer and the common one for a casual: the employer
 * asks the ATO for the fund already attached to the person rather than
 * defaulting them into a new account, which is what the stapling rules exist
 * to stop.
 */
export type SuperChoice =
  | { kind: "chosen_fund"; fundName: string; usi: string; memberNumber: string }
  | { kind: "stapled" };

export type StatementId = "fwis" | "ceis";

export interface ConnectorCall {
  method: string;
  at: string;
  externalId?: string;
}

export interface PayrollConnector {
  id: PayrollConnectorId;
  /** Establish the connection for one employer's payroll tenant. */
  connect(tenantRef: string, oauth: OAuthGrant): Promise<void>;
  /**
   * The idempotency hinge. Called before createEmployee every time, so a
   * retried provision finds the employee it already made instead of making a
   * second one — which in a payroll is not a duplicate row, it is a second
   * person with the same TFN and two sets of payments.
   */
  findEmployee(query: { did?: DID; email?: string }): Promise<{ externalId: string } | null>;
  createEmployee(input: NewEmployee): Promise<{ externalId: string }>;
  /** Lodged with the ATO through Single Touch Payroll by the payroll itself. */
  lodgeTfnDeclaration(externalId: string, decl: TfnDeclaration): Promise<void>;
  recordSuperChoice(externalId: string, choice: SuperChoice): Promise<void>;
  deliverStatements(externalId: string, docs: StatementId[]): Promise<void>;
}

/**
 * The time clock half.
 *
 * Separate interface because it is a separate obligation: payroll is what the
 * law requires, the clock is what the venue's floor requires, and a venue can
 * be perfectly employed-and-paid with no clock at all. Connecteam is the one
 * this app already talks to (lib/integrations/connecteam.ts).
 */
export interface TimeClockConnector {
  id: "connecteam";
  findUser(query: { did?: DID; email?: string }): Promise<{ userId: string } | null>;
  createUser(input: { did: DID; firstName: string; lastName: string; email: string; phone?: string }): Promise<{ userId: string }>;
  assignShift(input: {
    userId: string;
    shiftId: string;
    siteId: string;
    startsAt: number;
    endsAt: number;
    role: string;
  }): Promise<void>;
}
