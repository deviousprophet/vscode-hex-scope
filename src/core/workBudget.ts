export interface WorkBudgetOptions {
    timeBudgetMs?: number;
    now?: () => number;
    yieldControl?: () => Promise<void>;
}

export interface WorkBudgetRuntime {
    now: () => number;
    yieldControl: () => Promise<void>;
    budget: number;
}

const DEFAULT_WORK_BUDGET_MS = 24;

function defaultNow(): number { return performance.now(); }

function defaultYield(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

export function workBudgetRuntime(options: WorkBudgetOptions): WorkBudgetRuntime {
    return {
        now: options.now ?? defaultNow,
        yieldControl: options.yieldControl ?? defaultYield,
        budget: options.timeBudgetMs ?? DEFAULT_WORK_BUDGET_MS,
    };
}

export async function yieldWhenDue(runtime: WorkBudgetRuntime, deadline: number): Promise<number> {
    if (runtime.now() < deadline) { return deadline; }
    await runtime.yieldControl();
    return runtime.now() + runtime.budget;
}
