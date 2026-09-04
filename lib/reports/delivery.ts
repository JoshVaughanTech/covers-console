/* ============================================================
   Getting a report to payroll.

   A report that exists is not a report payroll has. Until now
   someone had to open the console, pick the week and click Export —
   which works right up to the week nobody remembers.

   Delivery is behind an interface because the target will change.
   Today it is a directory, which is a real answer rather than a
   stub: pointed at a synced or shared folder it lands where payroll
   already looks, and it can be verified end to end without standing
   up a mail service. An email sender implements the same interface
   when there is a transport to send through.
   ============================================================ */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { sha256Hex } from "@/lib/idara/hash";

export interface Delivery {
  /** where it went, in whatever terms the sink uses */
  target: string;
  /** sha-256 of exactly what was delivered */
  contentHash: string;
  bytes: number;
  /** false when the identical report was already there */
  written: boolean;
}

export interface ReportSink {
  /** Human-readable description of where this sink delivers. */
  describe(): string;
  deliver(filename: string, body: string): Promise<Delivery>;
}

/**
 * Write the report into a directory.
 *
 * The filename is derived from the report, never from a request, and the
 * resolved path is checked to be inside the configured directory — a run
 * trigger that could be persuaded to write elsewhere would be a much worse
 * problem than a missing report.
 */
export class FileSink implements ReportSink {
  constructor(private readonly dir: string) {}

  describe(): string {
    return this.dir;
  }

  async deliver(filename: string, body: string): Promise<Delivery> {
    const root = resolve(this.dir);
    const path = resolve(root, filename);
    // resolve() collapses any traversal; if the result escaped, refuse
    if (path !== root && !path.startsWith(root + sep)) {
      throw new Error(`refusing to write outside ${root}`);
    }

    const contentHash = sha256Hex(body);
    const bytes = Buffer.byteLength(body, "utf8");

    /* Re-running a week must not produce a second file or a second delivery
       record. Identical content is treated as already delivered. */
    if (existsSync(path)) {
      const existing = await import("node:fs").then((fs) => fs.readFileSync(path, "utf8"));
      if (sha256Hex(existing) === contentHash) {
        return { target: path, contentHash, bytes, written: false };
      }
    }

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, "utf8");
    return { target: path, contentHash, bytes, written: true };
  }
}

/** Keeps a delivery in memory. For tests, and for a dry run. */
export class MemorySink implements ReportSink {
  readonly delivered = new Map<string, string>();

  describe(): string {
    return "memory";
  }

  async deliver(filename: string, body: string): Promise<Delivery> {
    const already = this.delivered.get(filename);
    const contentHash = sha256Hex(body);
    this.delivered.set(filename, body);
    return {
      target: `memory:${filename}`,
      contentHash,
      bytes: Buffer.byteLength(body, "utf8"),
      written: already !== body,
    };
  }
}
