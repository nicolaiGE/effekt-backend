import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import logo from "@/assets/logos/GiEffektivt_Logo_2026_Hvit.png";
import mark from "@/assets/logos/GiEffektivt_Symbol_2026_Hvit.png";
import { DateTime } from "@/components/domain/format";
import { CountUpMoney } from "@/features/analysis/count-up";
import { EstimatedTicker } from "@/features/analysis/estimated-ticker";
import { OVERVIEW_REFRESH_MS } from "@/features/analysis/model";
import { org } from "@/lib/org";
import { useTRPC } from "@/lib/trpc";

/**
 * The office screen: the Analysis overview's big figure on its own, full screen and without
 * signing in (analysis.ticker is public and has nothing but the total). Outside /_app, so no
 * login, menu or panels. One look whatever the theme: the brand green with the 2026 logo in
 * white, and the butterfly large and faint behind the figure. Asks for new numbers every minute
 * like the overview, and keeps the last figure on screen if a refresh fails.
 */
export const Route = createFileRoute("/ticker")({
  component: TickerPage,
});

function TickerPage() {
  const trpc = useTRPC();
  const ticker = useQuery({
    ...trpc.analysis.ticker.queryOptions(),
    // Keeps going after a failed refresh too (a screen runs for weeks): the next minute tries again
    refetchInterval: OVERVIEW_REFRESH_MS,
  });
  const data = ticker.data;

  return (
    <main className="relative grid min-h-dvh cursor-none place-items-center overflow-hidden bg-[radial-gradient(ellipse_at_center,#00a870_0%,#009a68_45%,#007a52_100%)] p-[4vw] text-white">
      {/* The butterfly, large and faint, drifting slowly; still under reduced motion */}
      <img
        src={mark}
        alt=""
        aria-hidden
        width={290}
        height={394}
        className="pointer-events-none absolute -right-[6vh] -bottom-[14vh] h-[115vh] w-auto opacity-[0.08] motion-safe:animate-ticker-drift"
      />
      <div className="relative grid justify-items-center gap-[5vh] text-center">
        <img
          src={logo}
          alt={org.name}
          width={1400}
          height={276}
          className="h-auto w-[clamp(12rem,30vw,40rem)]"
        />
        {/* About 14 characters ("170 245 588 kr"): 10vw keeps it within the screen's width */}
        <p className="text-[clamp(3rem,10vw,16rem)] leading-none font-semibold tracking-tight [text-shadow:0_0.04em_0.12em_rgb(0_0_0/0.18)]">
          {data?.estimate ? (
            <EstimatedTicker
              sum={data.sum}
              perSecond={data.estimate.perSecond}
              since={data.estimate.since}
            />
          ) : data ? (
            <CountUpMoney value={data.sum} />
          ) : (
            <span className="text-white/70" aria-busy>
              {ticker.isError ? "Couldn't load the figure, trying again" : "…"}
            </span>
          )}
        </p>
      </div>
      <p className="absolute inset-x-0 bottom-[3vh] text-center text-[clamp(0.875rem,1.1vw,1.5rem)] text-white/80">
        {data && (
          <>
            {data.estimate && "Includes an estimate for the fixed agreements · "}
            Updated{" "}
            <DateTime value={new Date(ticker.dataUpdatedAt).toISOString()} format="datetime" />
            {ticker.isError && " · couldn't update, trying again"}
          </>
        )}
      </p>
    </main>
  );
}
