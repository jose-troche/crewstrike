/** Tiny external store for the React menus (the real-time HUD never goes through React). */
export class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}
  get = (): T => this.state;
  set(patch: Partial<T>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}
