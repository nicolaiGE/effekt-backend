import { CircleAlertIcon, CircleCheckIcon, CircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { DateTime } from "@/components/domain/format";
import { SettingsSection } from "@/components/templates";
import type { RouterOutputs } from "@/lib/trpc";

type Overview = RouterOutputs["reports"]["tax"]["overview"];
type State = "done" | "todo" | "attention" | "manual";

type Step = { when: string; what: string; state: State; status: ReactNode };

const n = (value: number) => value.toLocaleString("nb-NO");
const count = (value: number, one: string, many: string) =>
  `${n(value)} ${value === 1 ? one : many}`;

/**
 * The year's report as a checklist (GE005): each step with its deadline and where it stands,
 * from the figures on this page. The årsoppgaver are sent outside the admin panel, so that step
 * only says when.
 */
export function TaxChecklist({ overview }: { overview: Overview }) {
  const next = overview.year + 1;
  const sent = overview.withoutTaxUnit.filter((row) => row.status === "sent").length;
  const waiting = overview.withoutTaxUnit.filter((row) => row.status === "notice").length;
  const blocking = overview.invalidNumbers.filter((row) => row.reported).length;
  const duplicates = overview.duplicates.filter((row) => row.reason === "sameNumber").length;
  const submitted = overview.files.find((file) => file.submitted);
  const corrections = overview.changes?.rows.length ?? 0;

  const steps: Step[] = [
    {
      when: `Before 1 January ${next}`,
      what: `Tax deduction limits for ${overview.year} in the code`,
      state: overview.limitsInCode ? "done" : "attention",
      status: overview.limitsInCode ? "In the code" : "Missing: ask tech",
    },
    {
      when: "December and January",
      what: "Missing tax unit notice to donors without a tax unit",
      state: waiting === 0 ? (sent > 0 ? "done" : "todo") : sent > 0 ? "attention" : "todo",
      status:
        waiting === 0
          ? sent > 0
            ? `Sent to ${n(sent)}`
            : "Nobody needs it yet"
          : `${n(waiting)} still get it${sent > 0 ? `, ${n(sent)} sent` : ""}`,
    },
    {
      when: "Before the file",
      what: "Gifts on the donor's tax unit, duplicates merged, numbers fixed",
      state:
        blocking > 0 ? "attention" : overview.unconnected.length + duplicates > 0 ? "todo" : "done",
      status:
        [
          blocking > 0 &&
            `${count(blocking, "invalid number blocks", "invalid numbers block")} the file`,
          overview.unconnected.length > 0 &&
            `${count(overview.unconnected.length, "donor", "donors")} to connect`,
          duplicates > 0 && `${count(duplicates, "possible duplicate", "possible duplicates")}`,
        ]
          .filter(Boolean)
          .join(", ") || "Nothing to fix",
    },
    {
      when: `20 January ${next}`,
      what: "XML file sent to Skatteetaten (RF-1301), and marked as sent here",
      state: submitted ? "done" : overview.files.length > 0 ? "attention" : "todo",
      status: submitted?.submitted ? (
        <>
          Sent <DateTime value={submitted.submitted} format="date" />
        </>
      ) : overview.files.length > 0 ? (
        "A file is made, not marked as sent"
      ) : (
        "No file made yet"
      ),
    },
    {
      when: `15 February ${next}`,
      what: "Årsoppgaver to donors",
      state: "manual",
      status: "Sent outside the admin panel",
    },
    {
      when: `1 March and 29 April ${next}`,
      what: "Corrections (RF-1310) for gifts changed since the report",
      state: !submitted ? "todo" : corrections > 0 ? "attention" : "done",
      status: !submitted
        ? "After the report"
        : corrections > 0
          ? `${n(corrections)} to correct`
          : "Nothing changed",
    },
  ];

  return (
    <SettingsSection
      title={`The report for ${overview.year}`}
      description={<p>The steps of GE005 with their deadlines, and where each stands now.</p>}
    >
      <ol aria-label={`Checklist for ${overview.year}`} className="grid gap-2">
        {steps.map((step) => (
          <li key={step.what} className="flex items-start gap-3 text-sm">
            <StateIcon state={step.state} />
            <span className="grid flex-1 gap-0.5 sm:grid-cols-[12rem_minmax(0,1fr)_minmax(0,16rem)] sm:gap-3">
              <span className="text-muted-foreground">{step.when}</span>
              <span>{step.what}</span>
              <span
                className={step.state === "attention" ? "text-warning" : "text-muted-foreground"}
              >
                {step.status}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </SettingsSection>
  );
}

function StateIcon({ state }: { state: State }) {
  const label = { done: "Done", todo: "To do", attention: "Needs attention", manual: "Outside" }[
    state
  ];
  const className = "mt-0.5 size-4 shrink-0";
  if (state === "done")
    return <CircleCheckIcon aria-label={label} className={`${className} text-success`} />;
  if (state === "attention")
    return <CircleAlertIcon aria-label={label} className={`${className} text-warning`} />;
  return <CircleIcon aria-label={label} className={`${className} text-muted-foreground`} />;
}
