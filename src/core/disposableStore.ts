interface DisposableLike {
    dispose(): void;
}

type Cleanup = DisposableLike | (() => void);

export class DisposableStore implements DisposableLike {
    private cleanups: Cleanup[] = [];
    private disposed = false;

    public get isDisposed(): boolean { return this.disposed; }

    public add<T extends Cleanup>(cleanup: T): T {
        if (this.disposed) {
            runCleanup(cleanup);
        } else {
            this.cleanups.push(cleanup);
        }
        return cleanup;
    }

    public dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;
        const cleanups = this.cleanups;
        this.cleanups = [];
        throwCleanupErrors(drainCleanups(cleanups));
    }
}

function runCleanup(cleanup: Cleanup): void {
    if (typeof cleanup === 'function') {
        cleanup();
    } else {
        cleanup.dispose();
    }
}

function drainCleanups(cleanups: Cleanup[]): unknown[] {
    const errors: unknown[] = [];
    for (let i = cleanups.length - 1; i >= 0; i--) {
        try {
            runCleanup(cleanups[i]);
        } catch (error) {
            errors.push(error);
        }
    }
    return errors;
}

function throwCleanupErrors(errors: unknown[]): void {
    if (errors.length === 1) { throw errors[0]; }
    if (errors.length > 1) { throw new AggregateError(errors, 'Multiple disposal failures'); }
}
