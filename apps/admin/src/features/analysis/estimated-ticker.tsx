import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/format";
import { moneyToNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Larger gaps than this many seconds of flow count up quickly instead of being shown at once */
const JUMP_SECONDS = 5;
/** How fast a jump closes: about two thirds of the way in this many ms */
const JUMP_EASE_MS = 300;
/** A drop larger than this many seconds of flow isn't estimate error: the figure follows it down */
const DROP_SECONDS = 86_400;

/**
 * The office screen's figure with the fixed agreements' estimate on top: the registered total
 * plus `perSecond × (now − since)`, the agreement money that has come in but isn't registered
 * yet. Ticks on every frame like a fund counter. New registrations (pledges, manual entries,
 * the daily Vipps and AvtaleGiro imports) come in as jumps that count up quickly. When the
 * registered money comes in a little below the estimate, the figure holds still until the
 * estimate has caught up; a drop of more than a day's flow (a deleted or corrected donation, a
 * pledge marked received) is followed at once. The Analysis overview never shows this, only
 * /ticker.
 */
export function EstimatedTicker({
  sum,
  perSecond,
  since,
  className,
}: {
  sum: string;
  perSecond: number;
  since: string;
  className?: string;
}) {
  const base = moneyToNumber(sum);
  const from = new Date(since).getTime();
  const target = () => base + perSecond * Math.max(0, (Date.now() - from) / 1000);
  const [shown, setShown] = useState(target);
  const current = useRef(shown);
  const rendered = useRef(shown);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const step = (time: number) => {
      const dt = time - last;
      last = time;
      const goal = base + perSecond * Math.max(0, (Date.now() - from) / 1000);
      const gap = goal - current.current;
      if (gap > 0) {
        // A jump counts up quickly; the steady flow is shown as it is
        current.current =
          gap > perSecond * JUMP_SECONDS
            ? current.current + gap * Math.min(1, dt / JUMP_EASE_MS)
            : goal;
      } else if (-gap > perSecond * DROP_SECONDS) {
        current.current = goal;
      }
      // Only whole kroner are shown: re-render when that changes, not on every frame
      if (Math.floor(current.current) !== Math.floor(rendered.current)) {
        rendered.current = current.current;
        setShown(current.current);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [base, perSecond, from]);

  const whole = String(Math.floor(shown));
  return (
    <span className={cn("num whitespace-nowrap", className)}>
      <span data-slot="count-up" aria-hidden>
        {formatMoney(whole, { precision: "whole" })}
      </span>
      <span className="sr-only">{formatMoney(whole, { precision: "whole" })}</span>
    </span>
  );
}
