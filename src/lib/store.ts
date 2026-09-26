/**
 * Minimal external store. The detection loop writes to it at frame rate while
 * React reads it through useSyncExternalStore, so a 30 fps loop never causes
 * 30 renders per second - the controller publishes a snapshot on a timer.
 */
export interface Store<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  set(value: T): void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
  };
}
