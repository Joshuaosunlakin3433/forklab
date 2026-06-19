// Mirrors the existing /api/research and /api/merge routes. Do not change the
// shapes — these match what graph.ts and merge.ts already return.

export type BranchPath =
  | "hypothesis/pro"
  | "hypothesis/con"
  | "critique/pro"
  | "critique/con";

export interface ResearchResponse {
  question: string;
  runId: string;
  branches: Record<BranchPath, string[]>;
}

export interface Verdict {
  accepted: string[];
  rejected: string[];
  netPosition: string;
}

export interface MergeResponse {
  runId: string;
  verdict: Verdict;
  mainBefore: string[];
  mainAfter: string[] | null;
  committed: boolean;
  commitError?: string;
}

// UI-only state machine for /app
export type RunPhase =
  | "idle"
  | "researching"
  | "diverged"
  | "cooldown"
  | "mergeReady"
  | "merging"
  | "done"
  | "error";

export type EdgeState = "dormant" | "committing" | "committed";
export type Stance = "pro" | "con";
