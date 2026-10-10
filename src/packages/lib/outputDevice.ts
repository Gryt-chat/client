export interface AudioOutput {
  setSinkId?(deviceId: string): Promise<void>;
}

interface RoutingState {
  revision: number;
  pending: Promise<void>;
}

const routes = new WeakMap<AudioOutput, RoutingState>();

// Serialize changes on each context so an older request cannot finish last.
export async function routeOutputDevice(output: AudioOutput, deviceId: string): Promise<void> {
  if (typeof output.setSinkId !== "function") return;

  let state = routes.get(output);
  if (!state) {
    state = { revision: 0, pending: Promise.resolve() };
    routes.set(output, state);
  }
  const route = state;
  const revision = ++route.revision;
  route.pending = route.pending.then(async () => {
    if (revision !== route.revision) return;
    try {
      await output.setSinkId!(deviceId);
    } catch (error) {
      console.warn("[audio] Could not select output device", error);
      if (!deviceId || revision !== route.revision) return;
      try {
        await output.setSinkId!("");
      } catch (fallbackError) {
        console.warn("[audio] Could not select default output device", fallbackError);
      }
    }
  });
  let pending;
  do {
    pending = route.pending;
    await pending;
  } while (pending !== route.pending);
}
