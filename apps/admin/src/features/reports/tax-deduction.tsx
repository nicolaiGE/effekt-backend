import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DownloadIcon, MailIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Callout } from "@/components/domain/callout";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { describeError, ErrorState } from "@/components/domain/error-state";
import { FileDropzone } from "@/components/domain/file-dropzone";
import { Money, Num } from "@/components/domain/format";
import { Stat, StatGroup } from "@/components/domain/stat";
import { SettingsSection } from "@/components/templates";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pending, Updating } from "@/components/ui/pending";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadFile } from "@/lib/download";
import { sumMoney } from "@/lib/money";
import { usePersistentState } from "@/lib/persistent-store";
import { usePageQuery } from "@/lib/query";
import { useTRPC, type RouterOutputs } from "@/lib/trpc";
import {
  defaultTaxYear,
  emptyTaxContact,
  TAX_MIN_SUM,
  taxContactErrors,
  taxXmlForm,
  taxYearOptions,
  type TaxContact,
} from "./tax-deduction-model";

type Overview = RouterOutputs["reports"]["tax"]["overview"];

const linkClass = "rounded-xs text-accent hover:underline focus-ring";

/** Donor ids as links to the donor; national IDs are never shown on this page */
function DonorLinks({ ids }: { ids: number[] }) {
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {ids.map((id) => (
        <Link key={id} to="/donors/$id" params={{ id: String(id) }} className={linkClass}>
          #{id}
        </Link>
      ))}
    </span>
  );
}

/**
 * Reports › Tax deduction: the yearly report of gifts to Skatteetaten (GE005). Control figures and
 * deviation lists from our database first, then the XML file with EA Giverportal's units added.
 */
export function TaxDeductionReport() {
  const trpc = useTRPC();
  const [year, setYear] = useState(() => defaultTaxYear());
  const overview = usePageQuery(
    trpc.reports.tax.overview.queryOptions({ year, minSum: TAX_MIN_SUM }),
  );

  return (
    <>
      <SettingsSection
        title="Tax deduction"
        description={
          <>
            <p>
              Gifts of at least <Money value={String(TAX_MIN_SUM)} precision="whole" /> per tax unit
              in the year are reported to Skatteetaten by 20 January. Check the figures and lists
              below before you download the file.
            </p>
            <p className="mt-2">The year runs from 1 January to 31 December, Norwegian time.</p>
          </>
        }
      >
        <div className="grid max-w-xs gap-1.5">
          <Label htmlFor="tax-year">Gift year</Label>
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger id="tax-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {taxYearOptions().map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SettingsSection>

      {overview.error ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <Updating active={overview.isPlaceholderData}>
          <div className="grid gap-10">
            <ControlFigures overview={overview.data} />
            {overview.data ? (
              <>
                <WithoutTaxUnit overview={overview.data} />
                <Duplicates overview={overview.data} />
                <InvalidNumbers overview={overview.data} />
              </>
            ) : (
              <Pending className="min-h-40" />
            )}
            <XmlDownload year={year} invalidReported={invalidReportedCount(overview.data)} />
          </div>
        </Updating>
      )}
    </>
  );
}

const invalidReportedCount = (overview: Overview | undefined) =>
  overview?.invalidNumbers.filter((row) => row.reported).length ?? 0;

//region Control figures

function ControlFigures({ overview }: { overview: Overview | undefined }) {
  const pending = !overview;
  const totals = overview?.totals;
  const counts = overview?.counts;
  const balanced = totals?.difference === "0.00";
  const min = <Money value={String(TAX_MIN_SUM)} precision="whole" />;
  const rows: { label: ReactNode; value: string | undefined; detail?: ReactNode }[] = [
    {
      label: "Reported",
      value: totals?.reported,
      detail: counts && plural(counts.reportedUnits, "tax unit"),
    },
    {
      label: <>Below {min}</>,
      value: totals?.belowMinimum,
      detail: counts && plural(counts.belowMinimumUnits, "tax unit"),
    },
    { label: "Without tax unit", value: totals?.withoutTaxUnit },
  ];
  return (
    <SettingsSection
      title="Control figures"
      description={
        <p>
          From our database, before EA Giverportal's units are added. Reported, below {min} and
          without tax unit together make up all donations in the year, to the øre.
        </p>
      }
    >
      <div className="grid gap-4">
        <StatGroup>
          <Stat
            label="Tax units reported"
            pending={pending}
            placeholder="000"
            value={counts && <Num value={counts.reportedUnits} />}
          />
          <Stat
            label="Persons"
            pending={pending}
            placeholder="000"
            value={counts && <Num value={counts.persons} />}
          />
          <Stat
            label="Organizations"
            pending={pending}
            placeholder="00"
            value={counts && <Num value={counts.organizations} />}
          />
          <Stat
            label={
              <>
                Above{" "}
                <Money value={String(overview?.maximumDeduction ?? 25000)} precision="whole" />
              </>
            }
            pending={pending}
            placeholder="00"
            value={counts && <Num value={counts.aboveMaximum} />}
            hint="Deduction capped"
          />
        </StatGroup>
        {totals ? (
          <div className="relative overflow-hidden rounded-md border border-border">
            <Table aria-label="Reconciliation">
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-muted-foreground">{row.detail}</TableCell>
                    <TableCell className="text-right">
                      <Money value={row.value} />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>All donations in the year</TableCell>
                  <TableCell className="font-normal text-muted-foreground">
                    {counts && plural(counts.donations, "donation")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={totals.all} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Difference</TableCell>
                  <TableCell className="text-muted-foreground">
                    {balanced ? "Adds up to the øre" : "Does not add up"}
                  </TableCell>
                  <TableCell className={balanced ? "text-right" : "text-right text-danger"}>
                    <Money value={totals.difference} />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ) : (
          <Pending className="min-h-48" />
        )}
        {totals && !balanced && (
          <Callout tone="danger" title="The figures don't add up">
            Reported, below {min} and without tax unit differ from all donations by{" "}
            <Money value={totals.difference} />. Ask tech to look at it before you send the report.
          </Callout>
        )}
      </div>
    </SettingsSection>
  );
}

const plural = (count: number, word: string) =>
  `${count.toLocaleString("nb-NO")} ${word}${count === 1 ? "" : "s"}`;

//endregion

//region Deviation lists

function ListTable({
  label,
  empty,
  head,
  children,
  count,
}: {
  label: string;
  empty: string;
  head: ReactNode;
  children: ReactNode;
  count: number;
}) {
  if (count === 0) {
    return (
      <Callout tone="success" title={empty}>
        Nothing to check here.
      </Callout>
    );
  }
  return (
    <div className="relative max-h-96 overflow-auto rounded-md border border-border">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>{head}</TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

type NoticeFilter = "notice" | "excluded" | "all";

function WithoutTaxUnit({ overview }: { overview: Overview }) {
  const [filter, setFilter] = useState<NoticeFilter>("notice");
  const all = overview.withoutTaxUnit;
  const recipients = all.filter((row) => row.exclusion === null);
  const excluded = all.filter((row) => row.exclusion !== null);
  const rows = filter === "notice" ? recipients : filter === "excluded" ? excluded : all;
  const min = <Money value={String(overview.minSum)} precision="whole" />;
  return (
    <SettingsSection
      title="Donors without tax unit"
      description={
        <>
          <p>
            Donors who gave at least {min} in {overview.year} on KIDs without a tax unit. These
            gifts are not reported.
          </p>
          <p className="mt-2">
            The notice skips deleted and anonymous donors, donors without a real email address, and
            donors who already have a tax unit (their gifts are on KIDs without it: check those by
            hand). Fundraiser gifts don't count towards {min}, since a new tax unit isn't connected
            to them.
          </p>
        </>
      }
      actions={
        <MissingTaxUnitNotice
          year={overview.year}
          minSum={overview.minSum}
          recipients={recipients.length}
        />
      }
    >
      <div className="grid gap-3">
        <SegmentedControl
          label="Show donors"
          value={filter}
          onValueChange={setFilter}
          options={[
            {
              value: "notice",
              label: `Gets the notice (${recipients.length.toLocaleString("nb-NO")})`,
            },
            { value: "excluded", label: `Left out (${excluded.length.toLocaleString("nb-NO")})` },
            { value: "all", label: `All (${all.length.toLocaleString("nb-NO")})` },
          ]}
        />
        <p className="text-sm text-muted-foreground">
          {plural(rows.length, "donor")},{" "}
          <Money value={sumMoney(rows.map((row) => row.donationsSum))} /> without tax unit.
        </p>
        <ListTable
          label="Donors without tax unit"
          empty={filter === "excluded" ? "No donor is left out" : "No donor in this list"}
          count={rows.length}
          head={
            <>
              <TableHead>Donor</TableHead>
              <TableHead className="text-right">Without tax unit</TableHead>
              <TableHead className="text-right">Of which fundraisers</TableHead>
              <TableHead className="text-right">Donations</TableHead>
              <TableHead>Notice</TableHead>
            </>
          }
        >
          {rows.map((row) => (
            <TableRow key={row.donorId}>
              <TableCell>
                <DonorLinks ids={[row.donorId]} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={row.donationsSum} />
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {row.fundraiserSum === "0.00" ? "–" : <Money value={row.fundraiserSum} />}
              </TableCell>
              <TableCell className="num text-right">{row.donations}</TableCell>
              <TableCell className={row.exclusionLabel ? "text-muted-foreground" : undefined}>
                {row.exclusionLabel ?? "Gets it"}
              </TableCell>
            </TableRow>
          ))}
        </ListTable>
      </div>
    </SettingsSection>
  );
}

function Duplicates({ overview }: { overview: Overview }) {
  const rows = overview.duplicates;
  return (
    <SettingsSection
      title="Possible duplicate donors"
      description={
        <p>
          The same national ID on several donors is reported once, with the gifts added up. Merge
          the donors if they are one person. Several tax units on one donor can be right (a person
          and their company).
        </p>
      }
    >
      <ListTable
        label="Possible duplicate donors"
        empty="No possible duplicates"
        count={rows.length}
        head={
          <>
            <TableHead>Donors</TableHead>
            <TableHead>Why</TableHead>
            <TableHead className="text-right">Tax units</TableHead>
            <TableHead className="text-right">Sum</TableHead>
          </>
        }
      >
        {rows.map((row) => (
          <TableRow key={`${row.reason}-${row.taxUnitIds.join("-")}`}>
            <TableCell>
              <DonorLinks ids={row.donorIds} />
            </TableCell>
            <TableCell>
              {row.reason === "sameNumber"
                ? "Same national ID on several donors"
                : "Several tax units on one donor"}
            </TableCell>
            <TableCell className="num text-right">{row.taxUnitIds.length}</TableCell>
            <TableCell className="text-right">
              <Money value={row.sum} />
            </TableCell>
          </TableRow>
        ))}
      </ListTable>
    </SettingsSection>
  );
}

function InvalidNumbers({ overview }: { overview: Overview }) {
  const rows = overview.invalidNumbers;
  return (
    <SettingsSection
      title="Invalid numbers"
      description={
        <p>
          Tax units with gifts in {overview.year} whose national ID or organization number has the
          wrong length or check digit. Fix them on the donor: the file can't be made while a
          reported unit has one.
        </p>
      }
    >
      <ListTable
        label="Invalid numbers"
        empty="Every number is valid"
        count={rows.length}
        head={
          <>
            <TableHead>Donor</TableHead>
            <TableHead>Problem</TableHead>
            <TableHead className="text-right">Sum</TableHead>
            <TableHead>In the report</TableHead>
          </>
        }
      >
        {rows.map((row) => (
          <TableRow key={row.taxUnitIds.join("-")}>
            <TableCell>
              <DonorLinks ids={row.donorIds} />
            </TableCell>
            <TableCell>{row.problem}</TableCell>
            <TableCell className="text-right">
              <Money value={row.sum} />
            </TableCell>
            <TableCell>{row.reported ? "Yes, blocks the file" : "No, below minimum"}</TableCell>
          </TableRow>
        ))}
      </ListTable>
    </SettingsSection>
  );
}

//endregion

//region Missing tax unit notice

function MissingTaxUnitNotice({
  year,
  minSum,
  recipients,
}: {
  year: number;
  minSum: number;
  /** Donors the notice goes to; one email per address, so the sent count can be lower */
  recipients: number;
}) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [testEmail, setTestEmail] = useState("");
  const [testLimit, setTestLimit] = useState("3");
  const send = useMutation(trpc.reports.tax.missingTaxUnitNotice.mutationOptions());
  const limit = Number(testLimit);
  const testInvalid =
    testMode &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim()) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100);

  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) send.reset();
        }}
        trigger={
          <Button>
            <MailIcon />
            Send missing tax unit notice
          </Button>
        }
        title={
          testMode
            ? `Send a test of the missing tax unit notice for ${year}?`
            : `Email ${plural(recipients, "donor")} without tax unit for ${year}?`
        }
        consequences={
          testMode
            ? [
                `The notices for the ${limit || "first"} largest donors go to the test address, not to the donors.`,
              ]
            : [
                `${plural(recipients, "donor")} in “Gets the notice” get the email (one per address).`,
                "It can't be undone. Sending takes about a second per ten donors.",
              ]
        }
        confirmLabel={testMode ? "Send test" : "Send to donors"}
        tone={testMode ? "default" : "danger"}
        confirmText={testMode ? undefined : String(year)}
        disabled={testInvalid || recipients === 0}
        onConfirm={async () => {
          await send.mutateAsync({
            year,
            minSum,
            ...(testMode ? { testEmail: testEmail.trim(), testLimit: limit } : {}),
          });
        }}
      >
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <Switch id="notice-test-mode" checked={testMode} onCheckedChange={setTestMode} />
            <Label htmlFor="notice-test-mode">Test mode</Label>
          </div>
          {testMode && (
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
              <Field label="Send to">
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(event) => setTestEmail(event.target.value)}
                  placeholder="you@gieffektivt.no"
                />
              </Field>
              <Field label="Donors">
                <Input
                  inputMode="numeric"
                  value={testLimit}
                  onChange={(event) => setTestLimit(event.target.value)}
                />
              </Field>
            </div>
          )}
        </div>
      </ConfirmDialog>
      {send.data && (
        <Callout
          tone={send.data.failed > 0 ? "warning" : "success"}
          title={
            send.data.success === 0
              ? "Nothing was sent"
              : send.data.testMode
                ? "Test sent"
                : "Notices sent"
          }
        >
          {plural(send.data.success, "email")} sent
          {send.data.failed > 0 ? `, ${send.data.failed} failed` : ""}, of {send.data.total}.
        </Callout>
      )}
    </>
  );
}

//endregion

//region XML file

function XmlDownload({ year, invalidReported }: { year: number; invalidReported: number }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [contact, setContact] = usePersistentState<TaxContact>(
    "tax-report-contact",
    emptyTaxContact,
  );
  const [files, setFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const xml = useMutation(trpc.reports.tax.skatteetaten.mutationOptions());
  const errors = submitted ? taxContactErrors(contact) : {};
  const missingFile = submitted && files.length === 0;

  const set = (key: keyof TaxContact) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setContact((current) => ({ ...current, [key]: event.target.value }));
    xml.reset();
  };

  async function download() {
    setSubmitted(true);
    if (files.length === 0 || Object.keys(taxContactErrors(contact)).length > 0) return;
    const result = await xml
      .mutateAsync(taxXmlForm({ year, minSum: TAX_MIN_SUM, report: files[0]!, contact }))
      .catch(() => null);
    if (result?.file) downloadFile(result.file);
    // The lists may have changed since they were loaded
    void queryClient.invalidateQueries({ queryKey: trpc.reports.tax.overview.queryKey() });
  }

  const requestError = xml.error && describeError(xml.error);

  return (
    <SettingsSection
      title="XML for Skatteetaten"
      description={
        <>
          <p>
            Our tax units plus the units in the CSV from EA Giverportal, for {year}. The file is
            checked against Skatteetaten's schema before it downloads.
          </p>
          <p className="mt-2">The contact details are remembered in this browser.</p>
        </>
      }
    >
      <form
        className="grid max-w-xl gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void download();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person" error={errors.name}>
            <Input value={contact.name} onChange={set("name")} autoComplete="name" />
          </Field>
          <Field label="Email for notices" error={errors.email}>
            <Input type="email" value={contact.email} onChange={set("email")} />
          </Field>
          <Field label="Phone" error={errors.phoneNumber}>
            <Input type="tel" value={contact.phoneNumber} onChange={set("phoneNumber")} />
          </Field>
          <Field label="Mobile for SMS notices" error={errors.smsNumber}>
            <Input type="tel" value={contact.smsNumber} onChange={set("smsNumber")} />
          </Field>
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-semibold">EA Giverportal CSV</span>
          <FileDropzone
            accept=".csv,text/csv"
            files={files}
            onFilesChange={(next) => {
              setFiles(next);
              xml.reset();
            }}
            hint="Columns: Name, ssn, Sum, Gieffektivt"
          />
          {missingFile && (
            <p className="text-sm text-danger" role="alert">
              Choose the CSV from EA Giverportal
            </p>
          )}
        </div>
        {invalidReported > 0 && (
          <Callout tone="warning" title="Invalid numbers will stop the file">
            {plural(invalidReported, "reported tax unit")}{" "}
            {invalidReported === 1
              ? "has an invalid number. Fix it"
              : "have invalid numbers. Fix them"}{" "}
            on the donor first.
          </Callout>
        )}
        {requestError && (
          <Callout tone="danger" title={requestError.title}>
            {requestError.hint}
          </Callout>
        )}
        {xml.data && xml.data.errors.length > 0 && (
          <Callout tone="danger" title="No file was made">
            <ul className="mt-1 grid list-disc gap-1 pl-4">
              {xml.data.errors.map((error, i) => (
                <li key={i}>
                  {error.message}
                  {error.donorIds && error.donorIds.length > 0 && (
                    <>
                      {" "}
                      (donor <DonorLinks ids={error.donorIds} />)
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Callout>
        )}
        {xml.data?.file && (
          <Callout tone="success" title="File downloaded">
            {plural(xml.data.units, "tax unit")}, <Money value={xml.data.sum} /> in total, of which{" "}
            <Money value={xml.data.giverportalSum} /> from EA Giverportal. Upload it to
            Skatteetaten.
          </Callout>
        )}
        <div>
          <Button type="submit" variant="primary" pending={xml.isPending}>
            <DownloadIcon />
            Download XML
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

//endregion
