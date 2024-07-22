export type PointerId = number;

type Event = PointerEvent | React.PointerEvent;

export class PointerStack<State> {
  private readonly pointers = new Map<PointerId, State>();

  constructor(public readonly maxLength: number) {}

  get length() {
    return this.pointers.size;
  }

  has(event: Event): boolean {
    return this.pointers.has(event.pointerId);
  }

  maybeAdd(event: Event, state: State): boolean {
    if (this.length === this.maxLength && !this.has(event)) return false;
    this.set(event, state);
    return true;
  }

  private set(event: Event, state: State): void {
    this.pointers.set(event.pointerId, state);
  }

  get(event: Event): State | undefined {
    return this.pointers.get(event.pointerId);
  }

  getAll(): State[] {
    return Array.from(this.pointers.values());
  }

  maybeUpdate(event: Event, state: State): boolean {
    if (!this.has(event)) return false;
    this.set(event, state);
    return true;
  }

  maybeRemove(event: Event): boolean {
    return this.pointers.delete(event.pointerId);
  }
}
