/**
 * Whether this socket has already done something (GRYT-758).
 *
 * One thing uses it: saying what DM key to encrypt to us. That has to happen on
 * both routes into a server — a first join and a session restore — and exactly
 * once, because the server rate-limits it to five a minute while
 * `server:details` arrives again whenever anything about the server changes.
 *
 * Out here rather than inside the handler so it can be checked. The handler
 * imports React, a toast library and `@/common` through a Vite alias, and none
 * of that loads in Node — which is how the bug this fixes went out in the first
 * place.
 *
 * A `WeakSet` keyed on the socket, because socket.io reuses one `Socket` object
 * across reconnects. That makes the scope once per run per server rather than
 * once per wifi blink, and nothing has to be cleaned up: the entry goes when the
 * socket does.
 */
const done = new WeakMap<object, Set<string>>();

/**
 * True the first time it is asked about a socket and a task, false after.
 *
 * Records as it answers. A caller that checks and then decides not to act has
 * used up its turn, which is why there is no separate `mark`.
 */
export function firstTimeOnThisSocket(socket: object, task: string): boolean {
  const tasks = done.get(socket);

  if (!tasks) {
    done.set(socket, new Set([task]));
    return true;
  }

  if (tasks.has(task)) return false;
  tasks.add(task);
  return true;
}
