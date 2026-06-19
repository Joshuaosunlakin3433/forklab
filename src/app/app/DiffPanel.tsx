import type { MergeResponse } from "@/lib/types";
import { addedFacts } from "@/lib/api";

/**
 * The climax: the merge's verdict committing back, visibly changing main.
 * mainBefore is shown dim and flat;
 * mainAfter's *added* lines (the committed verdict) are the only warm block on
 * the whole screen, arriving with glow-in. "main learned N things" is the real
 * count of new facts, computed from the diff — never asserted.
 */
export default function DiffPanel({ merge }: { merge: MergeResponse }) {
  // Failure path: the verdict was computed, but the on-chain commit-back didn't
  // land — nothing persisted. Show the real verdict plus one honest line. No
  // after-column, no glow, no "main learned N" (glow is reserved for real
  // persisted learning).
  if (!merge.committed) {
    return (
      <section className="mt-10">
        <p className="mb-6 font-mono text-xs text-bone-dim">
          Verdict computed. On-chain commit to research/main pending — sponsor
          unavailable, retry shortly.
        </p>
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <VerdictCol label="accepted" items={merge.verdict.accepted} />
          <VerdictCol label="rejected" items={merge.verdict.rejected} dim />
          <div>
            <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-bone-dim">
              net position
            </p>
            <p className="leading-relaxed text-bone">
              {merge.verdict.netPosition}
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Success path: mainAfter is guaranteed non-null when committed is true.
  const mainAfter = merge.mainAfter ?? [];
  const added = addedFacts(merge.mainBefore, mainAfter);
  const learned = added.length;

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center gap-3 font-mono text-xs text-bone-dim">
        <span>main, before</span>
        <span className="text-graphite">───────────▸</span>
        <span className="text-bone">main, after</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* BEFORE — dim, flat, the cold archive */}
        <div className="rounded-sm border border-graphite bg-ink-shelf p-5">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-bone-dim">
            research/main
          </p>
          <ul className="space-y-2">
            {merge.mainBefore.map((line, i) => (
              <li key={i} className="text-sm leading-relaxed text-bone-dim">
                {line}
              </li>
            ))}
          </ul>
        </div>

        {/* AFTER — same corpus, plus the verdict that glows in */}
        <div className="rounded-sm border border-graphite bg-ink-shelf p-5">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-bone-dim">
            research/main
          </p>
          <ul className="space-y-2">
            {mainAfter.map((line, i) => {
              const isNew = added.includes(line);
              return (
                <li
                  key={i}
                  className={
                    isNew
                      ? "rounded-sm border border-glow bg-glow-soft px-3 py-2 text-sm leading-relaxed text-bone motion-safe:animate-glow-in"
                      : "text-sm leading-relaxed text-bone-dim"
                  }
                >
                  {line}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* the single warm beat, stated plainly */}
      <p className="mt-6 font-serif text-[22px] font-medium text-glow [text-shadow:0_0_18px_rgba(201,165,106,0.35)]">
        ✦ main learned {learned} {learned === 1 ? "thing" : "things"}.
      </p>

      {/* verdict, parsed straight from the structured object */}
      <div className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
        <VerdictCol label="accepted" items={merge.verdict.accepted} />
        <VerdictCol label="rejected" items={merge.verdict.rejected} dim />
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-bone-dim">
            net position
          </p>
          <p className="leading-relaxed text-bone">{merge.verdict.netPosition}</p>
        </div>
      </div>
    </section>
  );
}

function VerdictCol({
  label,
  items,
  dim,
}: {
  label: string;
  items: string[];
  dim?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-bone-dim">
        {label}
      </p>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li
            key={i}
            className={`leading-relaxed ${dim ? "text-bone-dim line-through decoration-graphite" : "text-bone"}`}
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
