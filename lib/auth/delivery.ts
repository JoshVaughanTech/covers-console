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
import { mkdirSync, appendFileSync } from "node:fs";
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

/** Writes the code where server access is needed to read it. */
export class FileSink implements CodeSink {
  readonly configured = true;
  constructor(private readonly dir: string) {}

  describe(): string {
    return this.dir;
  }

  async deliver(input: { did: string; name: string; code: string; link: string; expiresAt: number }): Promise<Delivery> {
    const dir = resolve(this.dir);
    mkdirSync(dir, { recursive: true });
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
 * Fails CLOSED in production, and that is the whole point of the ordering.
 * InlineSink returns the code in the response body, so with it as a silent
 * default a POST to /api/auth/request with a guessable did — and a did is
 * derivable from a name on the roster — hands a live sign-in code to anyone
 * who can reach the server. The sign-in screen carries a warning about this,
 * which mitigates nothing, because an attacker is running curl and there is no
 * screen involved.
 *
 * So: a real channel if one is configured, the insecure one only when somebody
 * has said so out loud or the environment says what it is, and otherwise
 * nothing. A sign-in that refuses is a bad demo; a sign-in that hands out
 * credentials to strangers is a bad product.
 *
 * The safe case is asserted positively, and that is a correction rather than a
 * style. This read `NODE_ENV !== "production"` for twenty minutes, which infers
 * "safe to expose codes" from the ABSENCE of a danger marker — and absence is
 * the default state of an unconfigured environment. Unset fell through to
 * inline. So did "staging", which is exactly where real rosters and real names
 * sit while everyone is still calling it not-production-yet, and the least
 * likely place for anyone to be checking whether an endpoint returns
 * credentials. Naming the two environments that may see a code means unset,
 * staging, preview and anything misspelled all fail closed.
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
