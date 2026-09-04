/**
 * Whether this socket has already done something (GRYT-758). One caller:
 * publishing the DM key, which has to happen on both routes into a server and
 * exactly once, since the server rate-limits it while `server:details` arrives
 * again whenever anything changes.
 *
 * **Out here rather than inside the handler so it can be checked** — that file
 * imports React and a Vite alias, none of which loads in Node, which is how the
 * bug this fixes went out.
 *
 * Keyed on the socket, which socket.io reuses across reconnects: once per run
 * per server rather than once per wifi blink, and nothing to clean up.
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
