import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SendIcon } from "lucide-react";
import { Callout } from "@/components/domain/callout";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { DateTime, Money } from "@/components/domain/format";
import { SettingsSection } from "@/components/templates";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { notify } from "@/lib/notify";
import { useTRPC, type RouterOutputs } from "@/lib/trpc";

type Overview = RouterOutputs["reports"]["tax"]["overview"];
type File = Overview["files"][number];

const linkClass = "rounded-xs text-accent hover:underline focus-ring";

/**
 * The XML files made for the year (every download is recorded), and which was sent to
 * Skatteetaten. Marking the file sent is what "Changed since the report" compares against.
 */
export function TaxFiles({ overview }: { overview: Overview }) {
  const files = overview.files;
  if (files.length === 0) return null;
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold">Files made for {overview.year}</h3>
      <div className="relative max-h-72 overflow-auto rounded-md border border-border">
        <Table aria-label={`Files made for ${overview.year}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Made</TableHead>
              <TableHead className="text-right">Tax units</TableHead>
              <TableHead className="text-right">Sum</TableHead>
              <TableHead>Sent to Skatteetaten</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => (
              <TableRow key={file.id}>
                <TableCell>
                  <DateTime value={file.created} />
                  <span className="block text-sm text-muted-foreground">{file.createdBy}</span>
                </TableCell>
                <TableCell className="num text-right">
                  {file.units.toLocaleString("nb-NO")}
                  {file.leftOut > 0 && (
                    <span className="block text-sm text-muted-foreground">
                      {file.leftOut} left out
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Money value={file.sum} />
                </TableCell>
                <TableCell>
                  {file.submitted ? (
                    <span>
                      Sent <DateTime value={file.submitted} format="date" />
                      <span className="block text-sm text-muted-foreground">
                        {file.submittedBy}
                      </span>
                    </span>
                  ) : (
                    <MarkSent year={overview.year} file={file} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MarkSent({ year, file }: { year: number; file: File }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const mark = useMutation(trpc.reports.tax.markSubmitted.mutationOptions());
  return (
    <ConfirmDialog
      title={`Is this the file sent to Skatteetaten for ${year}?`}
      confirmLabel="Mark as sent"
      consequences={[
        <>
          The file made <DateTime value={file.created} /> ({file.units.toLocaleString("nb-NO")} tax
          units, <Money value={file.sum} />) is recorded as sent today, with your name.
        </>,
        "Gifts that change after it are listed under “Changed since the report”, for a correction.",
        "Where gifts in the year are registered or changed, the admin panel warns that the year is reported.",
      ]}
      trigger={
        <Button size="sm">
          <SendIcon />
          Mark as sent
        </Button>
      }
      onConfirm={async () => {
        await mark.mutateAsync({ reportId: file.id });
        await queryClient.invalidateQueries({ queryKey: trpc.reports.tax.pathKey() });
        notify.success("Marked as sent", `Changes to ${year} are now listed against this file.`);
      }}
    />
  );
}

/**
 * Changed since the report: tax units whose amount in the report differs now from the file sent
 * to Skatteetaten (whole kroner, Gi Effektivt's part), for a correction with RF-1310.
 */
export function ChangesSinceReport({ overview }: { overview: Overview }) {
  const changes = overview.changes;
  if (!changes) return null;
  return (
    <SettingsSection
      title="Changed since the report"
      description={
        <>
          <p>
            Tax units whose amount for {overview.year} is different now from the file sent{" "}
            <DateTime value={changes.basis.submitted} format="date" />: gifts registered, changed or
            moved since, merged donors, units left out or put back. Gi Effektivt's part only.
          </p>
          <p className="mt-2">
            Send each correction with RF-1310 in Altinn, with the new total. Before 1 March the
            donor needn't do anything, but should hear if the amount differs from their årsoppgave;
            after that they must change their skattemelding themselves.
          </p>
        </>
      }
    >
      {changes.rows.length === 0 ? (
        <Callout tone="success" title="Nothing has changed since the report">
          The report still matches the gifts.
        </Callout>
      ) : (
        <div className="relative max-h-96 overflow-auto rounded-md border border-border">
          <Table aria-label="Changed since the report">
            <TableHeader>
              <TableRow>
                <TableHead>Donor</TableHead>
                <TableHead>Tax unit</TableHead>
                <TableHead className="text-right">Reported</TableHead>
                <TableHead className="text-right">Now</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changes.rows.map((row) => (
                <TableRow key={row.taxUnitIds.join("-")}>
                  <TableCell>
                    {row.donorIds.map((id) => (
                      <Link
                        key={id}
                        to="/donors/$id"
                        params={{ id: String(id) }}
                        search={{ tab: "tax" }}
                        className={`${linkClass} mr-2`}
                      >
                        #{id}
                      </Link>
                    ))}
                  </TableCell>
                  <TableCell>
                    <span className="block">{row.name || "No name"}</span>
                    <span className="num text-sm text-muted-foreground">{row.maskedNumber}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.filed} precision="whole" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.now} precision="whole" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.difference} precision="whole" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SettingsSection>
  );
}

/**
 * Where a gift is registered or changed: a warning when its year has been reported to
 * Skatteetaten, so the change gets a correction (RF-1310)
 */
export function ReportedYearWarning({ date }: { date: Date | string | null | undefined }) {
  const trpc = useTRPC();
  const years = useQuery({ ...trpc.reports.tax.submittedYears.queryOptions(), staleTime: 300_000 });
  if (!date || !years.data) return null;
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Europe/Oslo" }).format(
    new Date(date),
  );
  const reported = years.data.find((entry) => String(entry.year) === year);
  if (!reported) return null;
  return (
    <Callout tone="warning" title={`${year} is reported to Skatteetaten`}>
      The report for {year} was sent <DateTime value={reported.submitted} format="date" />. A gift
      on a tax unit registered or changed now needs a correction: it shows under{" "}
      <Link to="/reports" search={{ section: "tax-deduction" }} className={linkClass}>
        Reports › Tax deduction
      </Link>{" "}
      › Changed since the report.
    </Callout>
  );
}
