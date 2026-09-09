/* ============================================================
   Provisioning — the twenty minutes that stop happening.

   This is the only place in the product where a pack payload is
   decrypted. Everything above it deals in hashes and kinds;
   everything below it is a payroll's own API. The rule from §10 of
   the design lives here or nowhere:

     decrypt inside provision(), never log, never persist, never
     analytics, and record every release on the engagement.

   The shape is: find, then create. Every call is preceded by a
   lookup, because a retried provision — a timeout, a dropped
   connection, a queue redelivering — must land on the employee it
   already made. In a payroll a duplicate is not a stray row; it is
   the same person twice with the same TFN, two sets of payments and
   an STP lodgement that disagrees with itself.

   A second engagement with the same employer skips all of it. The
   employee exists, the declaration is lodged, the fund recorded, the
   statements delivered — so the only thing owed is a line on the
   time clock. That skip is the argument for holding employment once
   rather than per booking, and it is why plannedReleases() returns
   an empty list rather than the same five items again.
   ============================================================ */

import {
  isFullySigned,
  plannedReleases,
  recordProvisioned,
  type Engagement,
} from "@/lib/idara/engagement";
import { itemOf, type PackItemKind, type WorkerPack } from "@/lib/idara/pack";
import type { PackVault } from "@/lib/idara/vault";
import type { ISODate } from "@/lib/idara/types";
import type {
  NewEmployee,
  PayrollConnector,
  StatementId,
  SuperChoice,
  TfnDeclaration,
  TimeClockConnector,
} from "./types";

export interface ProvisionInput {
  engagement: Engagement;
  pack: WorkerPack;
  connector: PayrollConnector;
  vault: PackVault;
  timeClock?: TimeClockConnector;
  /** casual, part-time or full-time — the employer's position, from the posting. */
  employmentType: NewEmployee["employmentType"];
  at: string;
}

export interface ProvisionResult {
  engagement: Engagement;
  externalId: string;
  /** what actually left the vault this run. Empty on a repeat engagement. */
  released: PackItemKind[];
  /** false when the employee already existed — the idempotent path. */
  createdEmployee: boolean;
  timeClockUserId?: string;
}

export class ProvisionError extends Error {
  constructor(
    readonly code: "not_signed" | "missing_item" | "connector_failed",
    message: string,
  ) {
    super(message);
  }
}

/** Decrypt one required item, or fail the whole provision. */
function release(
  input: ProvisionInput,
  kind: PackItemKind,
  released: PackItemKind[],
): Record<string, unknown> {
  const item = itemOf(input.pack, kind);
  if (!item?.payloadRef) {
    throw new ProvisionError(
      "missing_item",
      `${kind} is not in this pack, so it cannot be released to ${input.connector.id}.`,
    );
  }
  const payload = input.vault.release(item.payloadRef, {
    engagementId: input.engagement.id,
    toConnector: input.connector.id,
  });
  released.push(kind);
  return payload;
}

const str = (payload: Record<string, unknown>, key: string): string =>
  typeof payload[key] === "string" ? (payload[key] as string) : "";

/**
 * Put the worker into the employer's payroll and time clock.
 *
 * Throws on a refusal rather than returning one. Every failure here leaves an
 * engagement short of `provisioned`, and `provisioned` is the state that says
 * payroll holds what the law requires — a soft failure that let the status
 * advance anyway would be the system asserting something it had not done.
 */
export async function provisionEngagement(input: ProvisionInput): Promise<ProvisionResult> {
  const { engagement, connector, at } = input;

  if (!isFullySigned(engagement)) {
    throw new ProvisionError(
      "not_signed",
      "Both sides must sign before anything is released to a payroll.",
    );
  }

  /* Already done. Not an error and not a second run: a provisioned engagement
     asked to provision again is a retry that arrived after the first
     succeeded, and the honest answer is the result of the first. */
  if (engagement.status !== "proposed" && engagement.status !== "accepted") {
    const existing = await connector.findEmployee({ did: engagement.workerDid });
    return {
      engagement,
      externalId: existing?.externalId ?? "",
      released: [],
      createdEmployee: false,
    };
  }

  const released: PackItemKind[] = [];

  /* One decryption per item per run.
     Two steps need the identity payload — the payroll's employee record and
     the time clock's user — and decrypting it twice would put two rows in the
     worker's release log for one disclosure. The log is what somebody reads to
     see where their details went; it should count releases, not calls. */
  const taken = new Map<PackItemKind, Record<string, unknown>>();
  const take = (kind: PackItemKind): Record<string, unknown> => {
    const already = taken.get(kind);
    if (already) return already;
    const payload = release(input, kind, released);
    taken.set(kind, payload);
    return payload;
  };

  const found = await connector.findEmployee({ did: engagement.workerDid });
  let externalId = found?.externalId ?? "";
  let createdEmployee = false;

  /* The employment acts of a first engagement.

     Guarded on the engagement's own flag, and the employee creation guarded
     again on the lookup: the flag says what this deal is, the lookup says what
     the payroll actually holds, and where they disagree the payroll is right —
     it is the system that would end up with two employees.

     The lodgement, the fund and the statements sit OUTSIDE that inner guard on
     purpose. A provision that created the employee and then timed out before
     lodging the declaration must, on retry, find the employee and still lodge
     it. Skipping them because the employee now exists would leave a person
     employed with no TFN declaration on file and the run reporting success. */
  if (plannedReleases(engagement).length > 0) {
    if (!found) {
      const identity = take("identity");
      const bank = take("bank_account");
      const emergency = take("emergency_contact");

      const employee: NewEmployee = {
        did: engagement.workerDid,
        firstName: str(identity, "firstName"),
        lastName: str(identity, "lastName"),
        email: str(identity, "email"),
        ...(identity.phone ? { phone: str(identity, "phone") } : {}),
        ...(identity.dateOfBirth ? { dateOfBirth: str(identity, "dateOfBirth") as ISODate } : {}),
        ...(identity.address ? { address: identity.address as NewEmployee["address"] } : {}),
        startDate: engagement.shift.date,
        employmentType: input.employmentType,
        classification: engagement.pay.classification,
        bank: {
          bsb: str(bank, "bsb"),
          accountNumber: str(bank, "accountNumber"),
          accountName: str(bank, "accountName"),
        },
        emergencyContact: {
          name: str(emergency, "name"),
          relationship: str(emergency, "relationship"),
          phone: str(emergency, "phone"),
        },
      };

      ({ externalId } = await connector.createEmployee(employee));
      createdEmployee = true;
    }

    /* The TFN, on its own call. Separated from createEmployee so that the one
       call carrying the number is the one call an auditor has to read. */
    const tfnPayload = take("tfn_declaration");
    const declaration: TfnDeclaration = {
      tfn: str(tfnPayload, "tfn"),
      /* From the ENGAGEMENT, not from the pack.

         Whether the threshold is claimed is a per-employer answer, decided
         against the one employer the worker nominated as primary. A pack
         field would carry the same answer to every employer, which is the
         precise mistake — claiming it twice — that this whole path exists to
         stop somebody making. */
      claimsTaxFreeThreshold: engagement.employment.claimsTaxFreeThreshold,
      residencyStatus:
        (tfnPayload.residencyStatus as TfnDeclaration["residencyStatus"]) ?? "resident",
      hasStudyAndTrainingLoan: Boolean(tfnPayload.hasStudyAndTrainingLoan),
    };
    await connector.lodgeTfnDeclaration(externalId, declaration);

    await connector.recordSuperChoice(externalId, take("super_choice") as unknown as SuperChoice);

    /* Delivery, not acknowledgement. The worker acknowledged both statements
       when their pack was built; what the employer owes on top of that is
       having handed them over, and this is the record that it did. */
    const statements: StatementId[] = ["fwis", "ceis"];
    await connector.deliverStatements(externalId, statements);
  }

  let timeClockUserId: string | undefined;
  if (input.timeClock) {
    const clock = input.timeClock;
    const existing = await clock.findUser({ did: engagement.workerDid });
    if (existing) {
      timeClockUserId = existing.userId;
    } else {
      /* The clock gets a name and an email and nothing else. It is a roster
         tool: it has no use for a TFN or a bank account, so it is never sent
         one, and the release log shows that it wasn't. */
      const identity = take("identity");
      ({ userId: timeClockUserId } = await clock.createUser({
        did: engagement.workerDid,
        firstName: str(identity, "firstName"),
        lastName: str(identity, "lastName"),
        email: str(identity, "email"),
      }));
    }

    await clock.assignShift({
      userId: timeClockUserId,
      shiftId: engagement.id,
      siteId: engagement.shift.siteId,
      startsAt: engagement.shift.startsAt,
      endsAt: engagement.shift.endsAt,
      role: engagement.shift.role,
    });
  }

  return {
    engagement: recordProvisioned(engagement, { connector: connector.id, released, at }),
    externalId,
    released,
    createdEmployee,
    ...(timeClockUserId ? { timeClockUserId } : {}),
  };
}
