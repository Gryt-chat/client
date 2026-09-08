/**
 * Whether this socket has already done something. **Out here rather than inside
 * the handler so it can be checked** — keyed on the socket (GRYT-758).
 */
const done = new WeakMap<object, Set<string>>();

/**
 * True the first time it is asked about a socket and a task, false after. Records
 * as it answers, which is why there is no separate `mark`.
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
