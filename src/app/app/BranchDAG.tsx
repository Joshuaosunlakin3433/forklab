"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { BranchPath, EdgeState, ResearchResponse } from "@/lib/types";

// subtle committing pulse — scarce warm glow, never a rave
const PULSE_OFF = "0 0 0px rgba(201,165,106,0)";
const PULSE_ON = "0 0 14px rgba(201,165,106,0.10)";

// weighted expo-out for the card entrance (matches the landing's feel)
const RISE_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Initial-arrival wrapper: cards fade + rise into place as a group instead of
 * popping in at full size. Lives on a SEPARATE element from each card's pulse
 * (boxShadow) animation, so the entrance never fights the committing glow that
 * runs later on the already-present inner card. Reduced motion: appear in place.
 */
function Rise({
  delay = 0,
  children,
}: {
  delay?: number;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduce ? { duration: 0 } : { duration: 0.45, ease: RISE_EASE, delay }
      }
    >
      {children}
    </motion.div>
  );
}

/**
 * The signature. Left→right DAG (Option B), divergence shown as light vs shadow
 * — pro carries the glow, con stays cold graphite. Same data, opposite warmth.
 * Edges carry real state: dormant → committing (marching dash, maps to actual
 * throttled commits) → committed. main-after appears only after merge.
 */

export default function BranchDAG({
  research,
  edgeStates,
  seedActive,
  mainAfterShown,
}: {
  research: ResearchResponse | null;
  edgeStates: Record<string, EdgeState>;
  seedActive: boolean;
  mainAfterShown: boolean;
}) {
  return (
    <div className="relative grid grid-cols-1 gap-6 md:grid-cols-[1fr_1.2fr_1.2fr_0.9fr]">
      {/* main */}
      <Column label="research/main">
        <Rise delay={0}>
          <MainNode question={research?.question} seeding={seedActive} />
        </Rise>
      </Column>

      {/* hypothesis */}
      <Column label="divergence">
        <Rise delay={0.05}>
          <BranchNode
            path="hypothesis/pro"
            claims={research?.branches["hypothesis/pro"]}
            edge={edgeStates["hypothesis/pro"] ?? "dormant"}
          />
        </Rise>
        <Rise delay={0.05}>
          <BranchNode
            path="hypothesis/con"
            claims={research?.branches["hypothesis/con"]}
            edge={edgeStates["hypothesis/con"] ?? "dormant"}
          />
        </Rise>
      </Column>

      {/* critique */}
      <Column label="critique">
        <Rise delay={0.1}>
          <BranchNode
            path="critique/pro"
            claims={research?.branches["critique/pro"]}
            edge={edgeStates["critique/pro"] ?? "dormant"}
          />
        </Rise>
        <Rise delay={0.1}>
          <BranchNode
            path="critique/con"
            claims={research?.branches["critique/con"]}
            edge={edgeStates["critique/con"] ?? "dormant"}
          />
        </Rise>
      </Column>

      {/* main-after — appears on merge */}
      <Column label="reconcile">
        {mainAfterShown ? (
          <div className="rounded-sm border border-glow bg-glow-soft p-4 motion-safe:animate-glow-in">
            <p className="font-mono text-[11px] text-bone">research/main</p>
            <p className="mt-1 font-serif text-bone">+ verdict</p>
          </div>
        ) : (
          <Rise delay={0.15}>
            <div className="rounded-sm border border-dashed border-graphite p-4 text-bone-dim">
              <p className="font-mono text-[11px]">research/main</p>
              <p className="mt-1 text-sm">awaiting merge</p>
            </div>
          </Rise>
        )}
      </Column>
    </div>
  );
}

function Column({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-bone-dim">
        {label}
      </p>
      {children}
    </div>
  );
}

function MainNode({
  question,
  seeding,
}: {
  question?: string;
  seeding?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="rounded-sm border border-glow/60 bg-ink-shelf p-4"
      initial={false}
      animate={{
        boxShadow: seeding ? (reduce ? PULSE_ON : [PULSE_OFF, PULSE_ON, PULSE_OFF]) : PULSE_OFF,
      }}
      transition={
        seeding && !reduce
          ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
          : { duration: 0.3 }
      }
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] text-bone">research/main</p>
        {seeding && (
          <span className="font-mono text-[10px] text-glow">seeding…</span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-bone">
        {question ?? "—"}
      </p>
      <p className="mt-1 text-xs text-bone-dim">+ corpus</p>
    </motion.div>
  );
}

function BranchNode({
  path,
  claims,
  edge,
}: {
  path: BranchPath;
  claims?: string[];
  edge: EdgeState;
}) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const isPro = path.endsWith("/pro");
  const count = claims?.length ?? 0;
  const ready = count > 0;

  // light vs shadow: pro warms when committed, con stays graphite
  const border =
    edge === "committed" && isPro
      ? "border-glow/70"
      : edge === "committing"
        ? "border-glow/40"
        : "border-graphite";

  // box-shadow per edge: dormant = none; committing = subtle looping pulse
  // (single static shadow under reduced motion); committed = pro warms with the
  // inset glow, con settles cool — both via a weighted spring.
  const committedShadow = isPro ? "inset 3px 0 0 rgba(201,165,106,1)" : PULSE_OFF;
  const variants = {
    dormant: { boxShadow: PULSE_OFF, transition: { duration: 0.3 } },
    committing: {
      boxShadow: reduce ? PULSE_ON : [PULSE_OFF, PULSE_ON, PULSE_OFF],
      transition: reduce
        ? { duration: 0.2 }
        : { duration: 1.6, repeat: Infinity, ease: "easeInOut" as const },
    },
    committed: {
      boxShadow: committedShadow,
      transition: { type: "spring" as const, stiffness: 140, damping: 20 },
    },
  };

  return (
    <motion.div
      className={`rounded-sm border bg-ink-shelf p-4 transition-colors ${border}`}
      initial={false}
      variants={variants}
      animate={edge}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-bone-dim">{path}</span>
        {edge === "committing" && (
          <span className="font-mono text-[10px] text-glow">committing…</span>
        )}
      </div>

      <p className="mt-2 font-serif text-[17px] font-medium text-bone">
        {ready ? `${count} ${path.startsWith("critique") ? "rebuttals" : "claims"}` : "—"}
      </p>

      {ready && (
        <>
          <p className="mt-1.5 text-[13px] leading-snug text-bone-dim">
            {open ? null : claims![0]}
          </p>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {claims!.map((c, i) => (
                <li key={i} className="text-[13px] leading-snug text-bone-dim">
                  • {c}
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-2 font-mono text-[11px] text-bone-dim hover:text-bone"
          >
            {open ? "collapse ⌃" : "expand ⌄"}
          </button>
        </>
      )}
    </motion.div>
  );
}
