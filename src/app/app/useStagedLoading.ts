import { useEffect, useRef, useState } from "react";
import type { BranchPath, EdgeState } from "@/lib/types";

/**
 * Staged research loading — honest simulated pacing.
 *
 * Two clocks: this hook fakes the APPEARANCE OF ACTIVITY (which step we narrate,
 * which card lights up), while the real /api/research promise (`resolved`) is the
 * ONLY thing that says "done". Stages mirror the true pipeline order; only timing
 * is estimated. Cards reach `committing` and stay there (still pulsing) — we never
 * claim a card is committed until the real fetch resolves and snaps them all.
 */

export type Stage = "seed" | "readerPro" | "readerCon" | "criticPro" | "criticCon";

const STAGE_ORDER: Stage[] = [
  "seed",
  "readerPro",
  "readerCon",
  "criticPro",
  "criticCon",
];

// estimated per-stage durations (ms). Sequence is true, timing is faked.
// Tune these after observing the real research duration logged on each run.
export const STAGE_TIMING: Record<Stage, number> = {
  seed: 5000,
  readerPro: 20000,
  readerCon: 20000,
  criticPro: 20000,
  criticCon: 20000,
}; // ~85s + gaps ≈ ~90s; fine if the real fetch over/undershoots

const THROTTLE_GAP = 1200; // brief gap narrated between stages (MemWal 30/min cap)

const STAGE_COPY: Record<Stage, string> = {
  seed: "seeding research/main from corpus…",
  readerPro: "forking hypothesis/pro · committing claims…",
  readerCon: "forking hypothesis/con · committing claims…",
  criticPro: "critique/pro rebutting…",
  criticCon: "critique/con rebutting…",
};
const GAP_COPY = "throttling — MemWal 30/min";
const HOLD_COPY = "still working — finalizing commits…";

// the four branch cards, in pipeline order — they map to STAGE_ORDER[1..4]
const BRANCH_ORDER: BranchPath[] = [
  "hypothesis/pro",
  "hypothesis/con",
  "critique/pro",
  "critique/con",
];

const ALL_COMMITTED: Record<BranchPath, EdgeState> = {
  "hypothesis/pro": "committed",
  "hypothesis/con": "committed",
  "critique/pro": "committed",
  "critique/con": "committed",
};

export interface StagedLoading {
  statusLine: string;
  edgeStates: Record<BranchPath, EdgeState>;
  seedActive: boolean;
}

export function useStagedLoading(
  running: boolean,
  resolved: boolean
): StagedLoading {
  const [stageIndex, setStageIndex] = useState(-1);
  const [inGap, setInGap] = useState(false);
  const [holding, setHolding] = useState(false);

  // mirror `resolved` so the async scheduler reads the latest value without
  // re-firing the effect (and thus restarting the sequence).
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  useEffect(() => {
    if (!running) {
      // leaving "researching" (done OR error) — clear narration state
      setStageIndex(-1);
      setInGap(false);
      setHolding(false);
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const sleep = (ms: number) =>
      new Promise<void>((res) => {
        timers.push(setTimeout(res, ms));
      });

    (async () => {
      setHolding(false);
      for (let i = 0; i < STAGE_ORDER.length; i++) {
        if (cancelled || resolvedRef.current) return;
        setStageIndex(i);
        setInGap(false);
        await sleep(STAGE_TIMING[STAGE_ORDER[i]]);
        // the in-flight sleep completing here = the current stage finished its
        // beat; the reactive `committed` snap (below) handles arrival.
        if (cancelled || resolvedRef.current) return;
        if (i < STAGE_ORDER.length - 1) {
          setInGap(true);
          await sleep(THROTTLE_GAP);
          if (cancelled || resolvedRef.current) return;
        }
      }
      if (cancelled || resolvedRef.current) return;
      // ran out of estimated time before the real fetch landed — hold the last
      // stage in a live "still working" pulse until data actually arrives.
      setInGap(false);
      setHolding(true);
    })();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [running]);

  // --- derivations -------------------------------------------------------
  // edge states: only the real resolution can commit a card.
  let edgeStates: Record<BranchPath, EdgeState>;
  if (resolved) {
    edgeStates = ALL_COMMITTED;
  } else {
    edgeStates = {
      "hypothesis/pro": "dormant",
      "hypothesis/con": "dormant",
      "critique/pro": "dormant",
      "critique/con": "dormant",
    };
    BRANCH_ORDER.forEach((branch, i) => {
      // branch i corresponds to STAGE_ORDER index i+1 (seed is index 0)
      if (stageIndex >= i + 1) edgeStates[branch] = "committing";
    });
  }

  const seedActive = !resolved && stageIndex === 0;

  let statusLine = "";
  if (running && !resolved) {
    if (holding) statusLine = HOLD_COPY;
    else if (inGap) statusLine = GAP_COPY;
    else if (stageIndex >= 0) statusLine = STAGE_COPY[STAGE_ORDER[stageIndex]];
  }

  return { statusLine, edgeStates, seedActive };
}
