"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { runResearch, runMerge, RateLimitError } from "@/lib/api";
import type {
  MergeResponse,
  ResearchResponse,
  RunPhase,
} from "@/lib/types";
import BranchDAG from "./BranchDAG";
import DiffPanel from "./DiffPanel";
import { useStagedLoading } from "./useStagedLoading";

const COOLDOWN_S = 60; // the real rate-limit window between research and merge

export default function AppPage() {
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [question, setQuestion] = useState("");
  const [research, setResearch] = useState<ResearchResponse | null>(null);
  const [merge, setMerge] = useState<MergeResponse | null>(null);
  const [resolved, setResolved] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const researchDoneAt = useRef<number>(0);
  const diffRef = useRef<HTMLDivElement>(null);

  const running = phase === "researching" || phase === "merging";

  // staged narration: fakes activity during the wait; the real fetch (resolved)
  // is the only clock that commits cards.
  const { statusLine, edgeStates, seedActive } = useStagedLoading(
    phase === "researching",
    resolved
  );

  async function onRun() {
    if (!question.trim() || running) return;
    setErr(null);
    setMerge(null);
    setResolved(false);
    setPhase("researching");
    const t0 = performance.now();
    try {
      const r = await runResearch(question.trim());
      console.log(
        `[forklab] research resolved in ${Math.round(performance.now() - t0)}ms`
      );
      setResearch(r);
      setResolved(true);
      researchDoneAt.current = Date.now();
      setCooldown(COOLDOWN_S);
      setPhase("cooldown");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Run failed.");
      setPhase("error");
    }
  }

  // honest countdown — informs why we wait (rate-limit window clearing)
  useEffect(() => {
    if (phase !== "cooldown") return;
    const id = setInterval(() => {
      const left = Math.max(
        0,
        COOLDOWN_S - Math.floor((Date.now() - researchDoneAt.current) / 1000)
      );
      setCooldown(left);
      if (left === 0) {
        clearInterval(id);
        setPhase("mergeReady");
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  async function onMerge() {
    if (!research || running) return;
    setErr(null);
    setPhase("merging");
    try {
      const m = await runMerge(research.runId);
      setMerge(m);
      setPhase("done");
    } catch (e) {
      if (e instanceof RateLimitError) {
        // informed override faceplant → re-arm countdown, speak to it
        researchDoneAt.current = Date.now();
        setCooldown(COOLDOWN_S);
        setErr("Rate-limit window still open. It clears below — retry then.");
        setPhase("cooldown");
      } else {
        setErr(e instanceof Error ? e.message : "Merge failed.");
        setPhase("error");
      }
    }
  }

  const canMergeEarly = phase === "cooldown"; // override allowed, with warning
  const showMerge = ["cooldown", "mergeReady", "merging", "done", "error"].includes(
    phase
  ) && !!research;

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8 sm:px-12">
      <header className="mb-8 flex items-center justify-between">
        <span className="font-mono text-lg font-medium tracking-tight text-bone">
          fork<span className="text-glow">lab</span>
        </span>
        {research && (
          <span className="font-mono text-[11px] text-bone-dim">
            runId {research.runId.slice(0, 8)}…
          </span>
        )}
      </header>

      {/* QuestionBar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onRun()}
          placeholder="ask a researchable question…"
          disabled={running}
          className="app-input flex-1 rounded-sm border border-graphite bg-ink-shelf px-4 py-3 text-[15px] text-bone placeholder:text-bone-dim focus:border-glow"
        />
        <button
          onClick={onRun}
          disabled={running || !question.trim()}
          className="rounded-sm border border-glow bg-glow-soft px-5 py-3 text-[15px] font-medium text-bone transition-colors hover:bg-[rgba(201,165,106,0.18)] disabled:opacity-40"
        >
          {phase === "researching" ? "Forking main…" : "Run divergence →"}
        </button>
      </div>

      {phase === "researching" && statusLine && (
        <p className="mt-3 font-mono text-xs text-bone-dim">{statusLine}</p>
      )}
      {err && (
        <p className="mt-3 rounded-sm border border-graphite bg-ink-shelf px-4 py-2 text-sm text-bone">
          {err}
        </p>
      )}

      {/* DAG */}
      {(research || running) && (
        <div className="mt-10">
          <BranchDAG
            research={research}
            edgeStates={edgeStates}
            seedActive={seedActive}
            mainAfterShown={phase === "done" && merge?.committed === true}
          />
        </div>
      )}

      {/* MergePanel — informed override */}
      {showMerge && (
        <div className="mt-8">
          <button
            onClick={onMerge}
            disabled={phase === "merging"}
            className="rounded-sm border border-glow bg-glow-soft px-5 py-3 text-[15px] font-medium text-bone transition-colors hover:bg-[rgba(201,165,106,0.18)] disabled:opacity-40"
          >
            {phase === "merging"
              ? "Reconciling…"
              : canMergeEarly
                ? `Merge anyway →`
                : "Merge →"}
          </button>
          {phase === "cooldown" && (
            <p className="mt-2 font-mono text-xs text-bone-dim">
              rate-limit window clearing · {cooldown}s · merging now may 429
            </p>
          )}
        </div>
      )}

      {/* DiffPanel — the climax */}
      {phase === "done" && merge && (
        <>
          <div ref={diffRef}>
            <DiffPanel merge={merge} />
          </div>
          <ScrollCue targetRef={diffRef} />
        </>
      )}
    </div>
  );
}

/**
 * Small, scarce-glow scroll cue that surfaces the verdict when it lands below the
 * fold. "verdict ready ↓" bobs at bottom-center and scrolls to the DiffPanel;
 * once the panel is in view it flips to "back to top ↑". Hidden when there's
 * nothing to point at (verdict already in view at the top). Reduced motion drops
 * the bob and the smooth behavior, but the cue still appears and still scrolls.
 */
function ScrollCue({
  targetRef,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>;
}) {
  const reduce = useReducedMotion();
  const [inView, setInView] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.2 }
    );
    io.observe(el);
    const onScroll = () => setScrolled(window.scrollY > 240);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [targetRef]);

  const showDown = !inView;
  const showUp = inView && scrolled;
  if (!showDown && !showUp) return null;

  const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
  const onClick = () => {
    if (showDown) {
      targetRef.current?.scrollIntoView({ behavior, block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior });
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 z-20 -translate-x-1/2">
      <motion.button
        onClick={onClick}
        aria-label={showDown ? "Scroll to verdict" : "Back to top"}
        animate={reduce ? undefined : { y: [0, 6, 0] }}
        transition={
          reduce ? undefined : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
        }
        className="rounded-full border border-glow bg-glow-soft px-4 py-2 font-mono text-[11px] text-glow backdrop-blur-sm transition-colors hover:bg-[rgba(201,165,106,0.18)]"
      >
        {showDown ? "verdict ready ↓" : "back to top ↑"}
      </motion.button>
    </div>
  );
}
