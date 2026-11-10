import { useEffect, useState } from "react";
import { formatNumber, formatPercent } from "@/lib/format";
import { moneyToNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

type Year = {
  year: number;
  small: string;
  large: string;
  goal: { small: string; large: string } | null;
};

/** "22,6 mill. kr", "78 mill. kr": millions with one decimal, read from across the room */
function millions(kroner: number) {
  const shown = Math.round(kroner / 1e5) / 10;
  return `${formatNumber(shown, { decimals: Number.isInteger(shown) ? 0 : 1 })} mill. kr`;
}

/** How far into the year we are (local time), 0–1: where the bars would be at an even pace */
function yearShare(year: number, now = new Date()) {
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

/**
 * The office screen's year: this year so far against the year's goal, in two bars split like
 * the analysis pipeline (gifts under 100 000 kr, and gifts of 100 000 kr or more). The bars grow
 * in from empty when the screen opens and move up when new money is registered; a faint light
 * runs along them. A thin line marks an even pace through the year. Without a goal for the
 * year, just the year so far.
 */
export function TickerYear({ year }: { year: Year }) {
  const small = moneyToNumber(year.small);
  const large = moneyToNumber(year.large);
  const total = small + large;
  // Start empty and grow to the value after the first paint, so the bars visibly fill up
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!year.goal) {
    return (
      <p className="text-[clamp(1rem,1.8vw,2.75rem)] text-white/85">
        {year.year} so far: <span className="font-semibold text-white">{millions(total)}</span>
      </p>
    );
  }

  const goalSmall = moneyToNumber(year.goal.small);
  const goalLarge = moneyToNumber(year.goal.large);
  const goal = goalSmall + goalLarge;
  const pace = yearShare(year.year);

  return (
    <section
      aria-label={`${year.year} against the goal`}
      className="grid w-[clamp(18rem,62vw,80rem)] gap-[2.2vh] text-left"
    >
      <p className="flex flex-wrap items-baseline justify-between gap-x-[2vw] text-[clamp(1rem,1.8vw,2.75rem)] text-white/85">
        <span>
          {year.year} so far: <span className="font-semibold text-white">{millions(total)}</span>
        </span>
        <span>
          of {millions(goal)} · {formatPercent(total / goal, { decimals: 0 })}
        </span>
      </p>
      <Bar
        label="Gifts under 100 000 kr"
        value={small}
        goal={goalSmall}
        pace={pace}
        grown={grown}
      />
      <Bar
        label="Gifts of 100 000 kr or more"
        value={large}
        goal={goalLarge}
        pace={pace}
        grown={grown}
      />
    </section>
  );
}

function Bar({
  label,
  value,
  goal,
  pace,
  grown,
}: {
  label: string;
  value: number;
  goal: number;
  pace: number;
  grown: boolean;
}) {
  const share = goal > 0 ? value / goal : 0;
  return (
    <div className="grid gap-[0.8vh]">
      <p className="flex flex-wrap items-baseline justify-between gap-x-[2vw] text-[clamp(0.875rem,1.3vw,2rem)] text-white/80">
        <span>{label}</span>
        <span>
          <span className="font-semibold text-white">{millions(value)}</span> of {millions(goal)}
        </span>
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.round(value)}
        aria-valuetext={`${millions(value)} of ${millions(goal)}`}
        className="relative h-[clamp(0.6rem,1.4vh,1.5rem)] overflow-hidden rounded-full bg-white/20"
      >
        <div
          data-slot="ticker-bar"
          className={cn(
            "relative h-full overflow-hidden rounded-full bg-white motion-safe:transition-[width] motion-safe:duration-[1800ms] motion-safe:ease-out",
          )}
          style={{ width: `${(grown ? Math.min(1, share) : 0) * 100}%` }}
        >
          <span className="absolute inset-y-0 -left-1/3 w-1/3 bg-[linear-gradient(90deg,transparent,rgb(0_154_104/0.35),transparent)] motion-safe:animate-ticker-shine" />
        </div>
        {/* An even pace through the year */}
        <span
          aria-hidden
          className="absolute inset-y-0 w-[0.2vw] min-w-0.5 bg-white/60"
          style={{ left: `${pace * 100}%` }}
        />
      </div>
    </div>
  );
}
