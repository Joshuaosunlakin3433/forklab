import Image from "next/image";
import Link from "next/link";

const ARC: { n: string; verb: string; desc: string; warm?: boolean }[] = [
  { n: "01", verb: "branch", desc: "fork research/main into two stances" },
  { n: "02", verb: "diverge", desc: "pro and con build opposing claims" },
  { n: "03", verb: "critique", desc: "each side rebuts the other" },
  { n: "04", verb: "merge", desc: "reconcile into a verdict main keeps", warm: true },
];

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* topbar */}
      <header className="flex items-center justify-between px-6 py-7 sm:px-12">
        <span className="font-mono text-lg font-medium tracking-tight text-bone">
          fork<span className="text-glow">lab</span>
        </span>
        <span className="hidden font-mono text-[11px] tracking-wide text-bone-dim min-[480px]:inline">
          built on MemForks · sui / walrus
        </span>
      </header>

      {/* hero — image is the thesis-atmosphere, copy is the message */}
      <main className="mx-auto grid w-full max-w-[1240px] flex-1 items-center gap-8 px-6 pb-2 pt-6 sm:px-12 md:grid-cols-[1.08fr_0.92fr] md:gap-12">
        <div
          className="relative mx-auto aspect-square w-full max-w-[660px] motion-safe:animate-rise"
          style={{ animationDelay: "0ms" }}
        >
          <Image
            src="/cubic-library.png"
            alt="An isometric cutaway of a vast dark library, a lone figure standing in a lit doorway at its center"
            fill
            priority
            sizes="(max-width: 768px) 360px, 660px"
            className="object-contain [mask-image:radial-gradient(ellipse_70%_70%_at_50%_48%,#000_58%,transparent_88%)]"
          />
          {/* the one live warmth — a faint pool behind the doorway */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[46%] h-[22%] w-[16%] -translate-x-1/2 -translate-y-1/2 blur-lg"
            style={{
              background:
                "radial-gradient(ellipse, var(--color-glow-soft), transparent 70%)",
            }}
          />
        </div>

        <div className="max-w-[520px]">
          <div className="motion-safe:animate-rise" style={{ animationDelay: "150ms" }}>
            <p className="mb-5 font-mono text-xs uppercase tracking-[0.12em] text-bone-dim">
              an ai research lab notebook <span className="text-glow">·</span> git for agent memory
            </p>
            <h1
              className="font-serif text-[clamp(38px,5vw,62px)] font-medium leading-[1.02] tracking-[-0.02em] text-bone motion-safe:animate-rise-sharpen"
              style={{ animationDelay: "150ms" }}
            >
              Memory that can
              <br />
              <span className="font-normal italic">disagree</span> with itself.
            </h1>
          </div>
          <p className="mt-6 max-w-[440px] text-[17px] leading-relaxed text-bone-dim motion-safe:animate-rise" style={{ animationDelay: "300ms" }}>
            One question. Two branches argue{" "}
            <span className="font-medium text-bone">opposite sides</span> from the
            same corpus. A merge reconciles them — and{" "}
            <span className="font-medium text-bone">changes what main believes.</span>
          </p>
          <div className="mt-9 flex items-center gap-5 motion-safe:animate-rise" style={{ animationDelay: "450ms" }}>
            <Link
              href="/app"
              className="inline-flex items-center gap-2.5 rounded-[2px] border border-glow bg-glow-soft px-5 py-3 text-[15px] font-medium text-bone transition-colors hover:bg-[rgba(201,165,106,0.18)]"
            >
              Open the lab <span className="text-glow">→</span>
            </Link>
          </div>
        </div>
      </main>

      {/* ArcStrip — the four real moves; numbered because it IS an ordered pipeline */}
      <section
        className="mx-auto mt-8 w-full max-w-[1240px] border-t border-graphite px-6 pb-11 pt-10 sm:px-12 motion-safe:animate-rise"
        style={{ animationDelay: "600ms" }}
      >
        <div className="flex flex-col justify-between gap-7 md:flex-row md:gap-0">
          {ARC.map((s) => (
            <div key={s.n} className="flex-1 md:pr-6">
              <div className="font-mono text-[11px] tracking-[0.1em] text-bone-dim">
                {s.n}
              </div>
              <div className="mt-2 font-serif text-[21px] font-medium text-bone">
                <span
                  className={
                    s.warm
                      ? "text-glow [text-shadow:0_0_18px_rgba(201,165,106,0.35)]"
                      : undefined
                  }
                >
                  {s.verb}
                </span>
              </div>
              <p className="mt-1.5 max-w-[170px] text-[13px] leading-snug text-bone-dim">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
