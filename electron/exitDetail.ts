/* A Go crash dump is hundreds of lines and its cause is the first one, long gone from the tail. */
export const CRASH_START = /^(panic:|fatal error:|unexpected fault address|unexpected signal|runtime error:)/;

/** The line that best says why a process died: its crash, else the last one naming a failure, else the last. */
export function exitDetail(tail: readonly string[], crash: string | undefined): string | undefined {
  const telling = crash ?? [...tail].reverse().find((l) => /error|failed|fatal|panic|denied|refused|address already|EADDR|ENOENT/i.test(l));
  return telling ?? tail[tail.length - 1];
}
