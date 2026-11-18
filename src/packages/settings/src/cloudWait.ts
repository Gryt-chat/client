/** While Add a server waits on the browser checkout, the next invite link is the new Cloud server, not an invite to accept. */
let onArrive: ((host: string) => void) | null = null;

export const cloudWait = {
  start(fn: (host: string) => void) {
    onArrive = fn;
  },
  stop() {
    onArrive = null;
  },
  /** True when the dialog took the link. */
  take(host: string): boolean {
    if (!onArrive) return false;
    onArrive(host);
    return true;
  },
};
