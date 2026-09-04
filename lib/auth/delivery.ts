/* ============================================================
   Getting the sign-in code to the person it belongs to.

   A magic link is only as good as the channel it travels down. The
   token layer beside this is transport-independent and built to a
   standard that holds; this file is where the honesty has to live,
   because there is no mail service here and a venue may never have
   one.

   Three sinks, in descending order of how much they prove:

     EmailSink   — not implemented, because there is nothing to send
                   through. The interface exists so the day there is,
                   nothing above this line changes.
     FileSink    — writes the code where only someone with server
                   access can read it. A real boundary: a stranger on
                   the venue wi-fi can ask for a code for Priya and
                   cannot see it.
     InlineSink  — returns the code in the response. No boundary at
                   all, and the default only because the alternative
                   is a demo that cannot be demonstrated. It says so
                   in its own return value, and the screen repeats it.

   The honest summary of where this leaves the product: it moves the
   trust from "anyone can be anyone" to "anyone who can open the
   console can be anyone", and closing that last step is console
   authentication, which does not exist yet. That is a smaller hole
   than the one it replaces, and it is not no hole.
   ============================================================ */
import { mkdirSync, appendFileSync, accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import { formatCode } from "./token";

export interface Delivery {
  /** where it went, in whatever terms the sink uses. */
  target: string;
  /**
   * The code, when the sink could not deliver it out of band and handed it
   * back instead. Present means the channel proved nothing about who received
   * it — callers must surface that rather than quietly showing the code.
   */
  code?: string;
  /** true when the code travelled a channel the requester does not control. */
  outOfBand: boolean;
}

export interface CodeSink {
  /** false when this sink cannot deliver at all, so callers refuse early. */
  readonly configured: boolean;
  describe(): string;
  deliver(input: { did: string; name: string; code: string; link: string; expiresAt: number }): Promise<Delivery>;
}

/**
 * Write the code where server access is needed to read it.
 *
 * `configured` means DELIVERABLE, not merely named. The difference is not
 * pedantry: callers check it before minting, and a grant is spent the moment
 * it is minted. A sink that claimed to be configured and then threw would
 * leave the worker's previous code dead, the new one written nowhere, and —
 * because the event append comes after delivery — no auth.code_issued at all,
 * so a later redemption would show a sign-in with no cause before it. One
 * mistyped path, and sign-in breaks in a way that reads as sign-in being
 * broken rather than as a bad environment variable.
 *
 * So the directory is created and probed for writability once, here, and a
 * failure fails closed at the same gate as no directory at all.
 */
export class FileSink implements CodeSink {
  readonly configured: boolean;
  private readonly reason: string | null;

  constructor(private readonly dir: string) {
    let ok = true;
    let why: string | null = null;
    try {
      mkdirSync(resolve(dir), { recursive: true });
      // creating it says the path is reachable; this says we may write in it,
      // which is the thing deliver() actually needs and the thing a read-only
      // mount or a wrong owner would take away without touching the path
      accessSync(resolve(dir), constants.W_OK);
    } catch (e) {
      ok = false;
      why = e instanceof Error ? e.message : String(e);
    }
    this.configured = ok;
    this.reason = why;
    /* Checked here, used in deliver(): a directory that becomes unwritable in
       between reverts to throwing after the mint. The window is one request
       and the failure is no worse than before this check existed, so it is
       left alone — but it stops being one request if sink construction ever
       moves out of the request path, and that is when it would need closing. */
  }

  describe(): string {
    return this.configured ? this.dir : `${this.dir} (unusable: ${this.reason})`;
  }

  async deliver(input: { did: string; name: string; code: string; link: string; expiresAt: number }): Promise<Delivery> {
    const dir = resolve(this.dir);
    const path = resolve(dir, "sign-in-codes.log");
    const line =
      `${new Date().toISOString()}  ${input.name} <${input.did}>  ` +
      `code ${formatCode(input.code)}  expires ${new Date(input.expiresAt * 1000).toISOString()}\n` +
      `  ${input.link}\n`;
    appendFileSync(path, line, "utf8");
    return { target: path, outOfBand: true };
  }
}

/**
 * Hands the code straight back to whoever asked for it.
 *
 * Which is to say: it proves nothing. Kept because a product nobody can sign
 * into is not demonstrable, and marked so the screens above cannot present it
 * as though a channel had verified anything.
 */
export class InlineSink implements CodeSink {
  readonly configured = true;
  describe(): string {
    return "returned in the response (no delivery channel configured)";
  }

  async deliver(input: { code: string }): Promise<Delivery> {
    return { target: "inline", code: input.code, outOfBand: false };
  }
}

/** Reserved for the day there is a transport. */
export class EmailSink implements CodeSink {
  readonly configured = false;
  describe(): string {
    return "email (not configured)";
  }

  async deliver(): Promise<Delivery> {
    throw new Error("no mail transport is configured");
  }
}

/** No channel at all. Refuses, so nothing can sign in. */
export class NoSink implements CodeSink {
  readonly configured = false;
  describe(): string {
    return "no delivery channel configured";
  }

  async deliver(): Promise<Delivery> {
    throw new Error(
      "no delivery channel is configured — set AUTH_CODES_DIR, or AUTH_CODES_INLINE=1 to accept that anyone who can reach this server can sign in as anyone",
    );
  }
}

/**
 * The sink this deployment should use.
 *
 * Fails CLOSED, and the ordering is the whole point. InlineSink returns the
 * code in the response body, so with it as a silent default a POST to
 * /api/auth/request with a guessable did — and a did is derivable from a name
 * on the roster — hands a live sign-in code to anyone who can reach the
 * server. The sign-in screen carries a warning about this, which mitigates
 * nothing, because an attacker is running curl and there is no screen
 * involved.
 *
 * Why an unusable AUTH_CODES_DIR refuses rather than falling back to inline,
 * recorded so it is not re-litigated from first principles:
 *
 * The two states are not the same request. An unset variable says nobody asked
 * for a file. A bad path says somebody asked and got it wrong, and falling
 * back answers the second as though it were the first, discarding the only
 * thing the operator actually told us.
 *
 * The deciding reason is visibility rather than severity. Failing closed costs
 * availability, and availability failures announce themselves — sign-in is
 * down, people ring the venue, somebody reads an error that names the bad
 * path, and it is fixed within the hour. Failing open costs confidentiality,
 * and confidentiality failures are silent by construction: nobody notices a
 * working system that is also handing out credentials. That is not a
 * hypothetical here. It is what happened twice in one morning in this file,
 * and what let it survive both times was that everything looked fine.
 *
 * So a typo taking sign-in down entirely is the good failure. A credential
 * channel that degrades to exposure when misconfigured has chosen the failure
 * nobody will find.
 */
export function sinkFromEnv(): CodeSink {
  const dir = process.env.AUTH_CODES_DIR;
  if (dir) return new FileSink(dir);
  if (process.env.AUTH_CODES_INLINE === "1") return new InlineSink();
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    return new InlineSink();
  }
  return new NoSink();
}
