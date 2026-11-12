import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRingIcon, MailIcon } from "lucide-react";
import { useState } from "react";
import { Callout } from "@/components/domain/callout";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { describeError } from "@/components/domain/error-state";
import { Money } from "@/components/domain/format";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pending } from "@/components/ui/pending";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/lib/notify";
import { useTRPC, type RouterOutputs } from "@/lib/trpc";

export type NoticeRound = "notice" | "reminder";
type Preview = RouterOutputs["reports"]["tax"]["noticePreview"];
type Result = RouterOutputs["reports"]["tax"]["missingTaxUnitNotice"];

const plural = (n: number, word: string) =>
  `${n.toLocaleString("nb-NO")} ${word}${n === 1 ? "" : "s"}`;

const words: Record<NoticeRound, { what: string; list: string; moves: string }> = {
  notice: {
    what: "missing tax unit notice",
    list: "“Gets the notice”",
    moves: "Those it reaches move to “Sent”, so a later sending skips them.",
  },
  reminder: {
    what: "reminder",
    list: "“Sent” who still have no tax unit",
    moves: "The reminder is recorded on each donor it reaches; they stay in “Sent”.",
  },
};

/**
 * Sends the missing tax unit notice, or a reminder, to the round's donors: all of them, or the
 * ticked ones (donorIds). Test mode (on by default) sends to a test address. The dialog shows
 * how many emails go out and the email for the first recipient: the MailerSend template and the
 * values filled into it. A real send needs the year typed.
 */
export function NoticeSend({
  year,
  minSum,
  round,
  donorIds,
  recipients,
  label,
  size,
  onSent,
}: {
  year: number;
  minSum: number;
  round: NoticeRound;
  /** Only these donors; all of the round's donors when absent */
  donorIds?: number[];
  /** Donors the round goes to; one email per address, so the sent count can be lower */
  recipients: number;
  label: string;
  size?: "sm";
  onSent?: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [testEmail, setTestEmail] = useState("");
  const [testLimit, setTestLimit] = useState("3");
  const send = useMutation(trpc.reports.tax.missingTaxUnitNotice.mutationOptions());
  const preview = useQuery({
    ...trpc.reports.tax.noticePreview.queryOptions({
      year,
      minSum,
      round,
      ...(donorIds && { donorIds }),
    }),
    enabled: open,
  });
  const limit = Number(testLimit);
  const testInvalid =
    testMode &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim()) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100);
  const w = words[round];
  const who = donorIds ? `${plural(recipients, "ticked donor")}` : plural(recipients, "donor");
  const Icon = round === "reminder" ? BellRingIcon : MailIcon;

  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) send.reset();
        }}
        trigger={
          <Button size={size} disabled={recipients === 0}>
            <Icon />
            {label}
          </Button>
        }
        title={
          testMode
            ? `Send a test of the ${w.what} for ${year}?`
            : `Email the ${w.what} to ${who} for ${year}?`
        }
        consequences={
          testMode
            ? [
                `The emails for the ${limit || "first"} largest of ${who} in ${w.list} go to the test address, not to the donors.`,
                "Nothing is recorded.",
              ]
            : [
                `${who} in ${w.list} get the email (one per address).`,
                w.moves,
                "It can't be undone. Sending takes about a second per ten donors.",
              ]
        }
        confirmLabel={testMode ? "Send test" : "Send to donors"}
        tone={testMode ? "default" : "danger"}
        confirmText={testMode ? undefined : String(year)}
        disabled={testInvalid || recipients === 0}
        onConfirm={async () => {
          const result = await send.mutateAsync({
            year,
            minSum,
            round,
            ...(donorIds && { donorIds }),
            ...(testMode
              ? { testEmail: testEmail.trim(), testLimit: limit }
              : { confirmYear: year }),
          });
          // A toast too: sending from the ticked rows clears them, and the callout with them
          if (result.failed > 0) notify.info(resultTitle(result), resultText(result));
          else notify.success(resultTitle(result), resultText(result));
          if (!testMode) {
            await queryClient.invalidateQueries({
              queryKey: trpc.reports.tax.pathKey(),
            });
            onSent?.();
          }
        }}
      >
        <div className="grid gap-4">
          <NoticePreview preview={preview} round={round} />
          <div className="flex items-center gap-2">
            <Switch
              id={`notice-test-mode-${round}`}
              checked={testMode}
              onCheckedChange={setTestMode}
            />
            <Label htmlFor={`notice-test-mode-${round}`}>Test mode</Label>
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
      {send.data && <SendResult result={send.data} />}
    </>
  );
}

const resultTitle = (result: Result) =>
  result.success === 0
    ? "Nothing was sent"
    : result.testMode
      ? "Test sent"
      : result.round === "reminder"
        ? "Reminders sent"
        : "Notices sent";

const resultText = (result: Result) =>
  `${plural(result.success, "email")} sent${result.failed > 0 ? `, ${result.failed} failed` : ""}, of ${result.total}.` +
  (!result.testMode && result.donorsMarkedSent > 0
    ? result.round === "reminder"
      ? ` The reminder is recorded on ${plural(result.donorsMarkedSent, "donor")}.`
      : ` ${plural(result.donorsMarkedSent, "donor")} moved to Sent.`
    : "");

function SendResult({ result }: { result: Result }) {
  return (
    <Callout tone={result.failed > 0 ? "warning" : "success"} title={resultTitle(result)}>
      {resultText(result)}
    </Callout>
  );
}

/** Values the MailerSend template gets, in the order a reader of the email meets them */
const fieldLabels: [string, string][] = [
  ["name", "First name"],
  ["year", "Gift year"],
  ["donationTotalSum", "Gifts without tax unit"],
  ["deductionPercentage", "Deduction"],
  ["maxDeduction", "Maximum"],
  ["profilePageLinkTitle", "Link text"],
  ["profilePageUrl", "Link"],
  ["reminder", "Reminder"],
];

type Organization = { name: string; sum: string; percentage: string; outputs: string[] };

function NoticePreview({
  preview,
  round,
}: {
  preview: { data?: Preview; error: unknown; isPending: boolean };
  round: NoticeRound;
}) {
  if (preview.error)
    return (
      <Callout tone="warning" title="The preview couldn't be made">
        {describeError(preview.error).title}
      </Callout>
    );
  if (!preview.data) return <Pending className="min-h-24" />;
  const { emails, donors, example, mail, problem } = preview.data;
  const values = mail?.personalization ?? {};
  const organizations = (values.organizations ?? []) as Organization[];

  return (
    <section
      aria-label="Preview"
      className="grid gap-2 rounded-md border border-border p-3 text-sm"
    >
      <p className="font-semibold">
        {plural(emails, "email")} to {plural(donors, "donor")}
      </p>
      {example && (
        <p className="text-muted-foreground">
          First: {example.name || "No name"}, {example.email},{" "}
          <Money value={example.donationsSum.toFixed(2)} />
        </p>
      )}
      {problem && (
        <Callout tone="danger" title="The email can't be made">
          {problem}
        </Callout>
      )}
      {mail && (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
            {fieldLabels
              .filter(([key]) => key in values)
              .map(([key, text]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{text}</dt>
                  <dd className="break-words">
                    {key === "reminder" ? (values[key] ? "Yes" : "No") : String(values[key])}
                  </dd>
                </div>
              ))}
          </dl>
          {organizations.length > 0 && (
            <ul className="grid gap-0.5">
              {organizations.map((org) => (
                <li key={org.name}>
                  {org.name}: {org.sum} ({org.percentage})
                  {org.outputs.length > 0 && (
                    <span className="text-muted-foreground"> · {org.outputs.join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground">
            The wording is in MailerSend, template{" "}
            {mail.templateId || "(no template id set in this environment)"}; these are the values it
            gets.
            {round === "reminder" &&
              " The template gets reminder = Yes: its text must use it to say this is a reminder."}
          </p>
        </>
      )}
    </section>
  );
}
