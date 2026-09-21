import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";

export type Fields = Record<string, unknown>;

/** Anything a probe can write an event to: a log, or a tracker wrapping one. */
export interface EventWriter {
  write(type: string, fields?: Fields): void;
}

/** One JSONL file per client or probe. Each line gets `t`, the UTC time, from `at` when the event carries one. */
export class JsonlLog implements EventWriter {
  readonly file: string;
  private readonly who: string;
  private readonly stream: WriteStream;

  constructor(file: string, who: string) {
    this.file = file;
    this.who = who;
    this.stream = createWriteStream(file, { flags: "a" });
  }

  write(type: string, fields: Fields = {}): void {
    const { at, ...rest } = fields;
    const time = typeof at === "number" ? at : Date.now();
    this.stream.write(`${JSON.stringify({ t: new Date(time).toISOString(), who: this.who, type, ...rest })}\n`);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}

export class RunDir {
  readonly dir: string;
  private readonly logs: JsonlLog[] = [];

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  log(who: string): JsonlLog {
    const log = new JsonlLog(join(this.dir, `${who}.jsonl`), who);
    this.logs.push(log);
    return log;
  }

  path(name: string): string {
    return join(this.dir, name);
  }

  async close(): Promise<void> {
    await Promise.all(this.logs.map((log) => log.close()));
  }
}
