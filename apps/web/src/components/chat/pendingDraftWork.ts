// Count per draft so overlapping pastes cannot release each other and strand chips.
class PendingDraftWork {
  private readonly counts = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  revision(draftKey: string): number {
    return this.revisions.get(draftKey) ?? 0;
  }

  markEdited(draftKey: string): void {
    this.revisions.set(draftKey, this.revision(draftKey) + 1);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  begin(draftKey: string): void {
    this.counts.set(draftKey, (this.counts.get(draftKey) ?? 0) + 1);
    this.markEdited(draftKey);
  }

  end(draftKey: string): void {
    const remaining = (this.counts.get(draftKey) ?? 0) - 1;
    if (remaining > 0) this.counts.set(draftKey, remaining);
    else this.counts.delete(draftKey);
    this.notify();
  }

  has(draftKey: string): boolean {
    return (this.counts.get(draftKey) ?? 0) > 0;
  }
}

// Keep claims across composer remounts.
export const pendingDraftWork = new PendingDraftWork();
