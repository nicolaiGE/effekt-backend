import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MonitorIcon } from "lucide-react";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Money, MoneyPrecisionProvider, Num } from "@/components/domain/format";
import { Stat, StatGroup } from "@/components/domain/stat";
import { DetailPage, PageSection } from "@/components/templates";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/ui/skeleton";
import { CountUpMoney } from "@/features/analysis/count-up";
import { NEW_DONOR_MONTHS } from "@/features/analysis/donor-cohorts";
import { CohortsSection, NewDonorsSection } from "@/features/analysis/donor-sections";
import { OVERVIEW_REFRESH_MS, type Overview } from "@/features/analysis/model";
import { loadPage } from "@/lib/route-data";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_app/analysis/")({
  loader: ({ context: { queryClient, trpc }, cause }) =>
    loadPage(queryClient, cause, trpc.analysis.overview.queryOptions(), [
      trpc.analysis.newDonors.queryOptions({ months: NEW_DONOR_MONTHS }),
      trpc.analysis.cohorts.queryOptions(),
    ]),
  component: AnalysisOverviewPage,
});

function AnalysisOverviewPage() {
  const trpc = useTRPC();
  // Refreshed every minute while the page is open, so the ticker follows new donations
  const overview = useQuery({
    ...trpc.analysis.overview.queryOptions(),
    refetchInterval: OVERVIEW_REFRESH_MS,
  });
  const data = overview.data;

  return (
    <DetailPage
      title="Analysis"
      meta={["Measured from the donations; open pledges shown on top, never mixed in"]}
      stats={
        overview.isError ? null : (
          <StatGroup>
            <Stat
              label={data ? `Collected in ${data.thisYear.year}` : "Collected this year"}
              pending={!data}
              placeholder="00 000 000 kr"
              value={data && <Money value={data.thisYear.sum} />}
              hint="All confirmed donations so far this year"
            />
            <Stat
              label="Through time, measured"
              pending={!data}
              placeholder="000 000 000 kr"
              value={data && <Money value={data.throughTime.measured} />}
              hint={
                data && (
                  <>
                    <Num value={data.throughTime.donations} /> donations
                    {data.throughTime.from && (
                      <>
                        {" "}
                        since <DateTime value={data.throughTime.from} />
                      </>
                    )}
                  </>
                )
              }
            />
            <Stat
              label="Open pledges"
              pending={!data}
              placeholder="00 000 000 kr"
              value={data && <Money value={data.pledges.open} />}
              hint={
                data && (
                  <Link to="/analysis/pledges" className="text-accent hover:underline">
                    <Num value={data.pledges.count} />{" "}
                    {data.pledges.count === 1 ? "pledge" : "pledges"} decided, not received
                  </Link>
                )
              }
            />
          </StatGroup>
        )
      }
    >
      {overview.isError ? (
        <ErrorState
          error={overview.error}
          title="Couldn't load the overview"
          onRetry={() => void overview.refetch()}
        />
      ) : (
        <ThroughTime overview={data} />
      )}
      <NewDonorsSection />
      <CohortsSection />
    </DetailPage>
  );
}

function ThroughTime({ overview }: { overview: Overview | undefined }) {
  const since = overview?.throughTime.from?.slice(0, 4);
  return (
    <PageSection
      title={`Given to the recipients${since ? ` since ${since}` : ""}, with open pledges`}
      description="Excludes support for our own operations (Drift). Includes Influenced donations."
      actions={
        // The same figure full screen and without signing in, for the screen at the office
        <Button asChild size="sm" variant="ghost">
          <Link to="/ticker" target="_blank">
            <MonitorIcon />
            Show on a screen
          </Link>
        </Button>
      }
    >
      {/* A headline figure: whole kroner, like the stats above. */}
      <MoneyPrecisionProvider precision="whole">
        <div className="grid gap-4">
          {/* The page's one big figure: a ticker, no progress bar under it */}
          <p className="text-display font-semibold tracking-tight">
            {overview ? (
              <CountUpMoney value={overview.withPledges.sum} />
            ) : (
              <SkeletonText>000 000 000 kr</SkeletonText>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {overview ? (
              <>
                <Money
                  value={overview.throughTime.measured}
                  className="font-semibold text-foreground"
                />{" "}
                measured
                {overview.pledges.count > 0 && (
                  <>
                    {" "}
                    +{" "}
                    <Money
                      value={overview.pledges.open}
                      className="font-semibold text-foreground"
                    />{" "}
                    in <Num value={overview.pledges.count} /> open{" "}
                    {overview.pledges.count === 1 ? "pledge" : "pledges"}
                  </>
                )}
              </>
            ) : (
              <SkeletonText>000 000 000 kr measured + 00 000 000 kr in 0 open pledges</SkeletonText>
            )}
          </p>
        </div>
      </MoneyPrecisionProvider>
    </PageSection>
  );
}
