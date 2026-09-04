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
  describe(): string;
  deliver(input: { did: string; name: string; code: string; link: string; expiresAt: number }): Promise<Delivery>;
}

/** Writes the code where server access is needed to read it. */
export class FileSink implements CodeSink {
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
  describe(): string {
    return "returned in the response (no delivery channel configured)";
  }

  async deliver(input: { code: string }): Promise<Delivery> {
    return { target: "inline", code: input.code, outOfBand: false };
  }
}

/** Reserved for the day there is a transport. */
export class EmailSink implements CodeSink {
  describe(): string {
    return "email (not configured)";
  }

  async deliver(): Promise<Delivery> {
    throw new Error("no mail transport is configured");
  }
}

/**
 * The sink this deployment should use.
 *
 * Ordered so that configuring a real channel is what turns the insecure one
 * off — nobody has to remember to disable anything.
 */
export function sinkFromEnv(): CodeSink {
  const dir = process.env.AUTH_CODES_DIR;
  if (dir) return new FileSink(dir);
  return new InlineSink();
}
