import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleSlashIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";
import { Callout } from "@/components/domain/callout";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { DateTime, Money } from "@/components/domain/format";
import { SettingsSection } from "@/components/templates";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/choice-cards";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/lib/notify";
import { useTRPC, type RouterOutputs } from "@/lib/trpc";

type Overview = RouterOutputs["reports"]["tax"]["overview"];

const linkClass = "rounded-xs text-accent hover:underline focus-ring";

/** Like the API's maskIdNumberForList: the first four characters, a dot for each of the rest */
const maskNumber = (value: string | null | undefined) => {
  const id = (value ?? "").replace(/\s/g, "");
  return id.slice(0, 4) + "•".repeat(Math.max(0, id.length - 4));
};

/**
 * Left out of the file: tax units an admin has taken out of the year's report, with the reason,
 * for example a number Altinn rejected for a donor we can't reach. Put back undoes it.
 */
export function LeftOutUnits({ overview }: { overview: Overview }) {
  const rows = overview.leftOut;
  return (
    <SettingsSection
      title="Left out of the file"
      description={
        <p>
          Tax units left out of the report for {overview.year} by hand, with the reason. Every tax
          unit with the same number is left out with it, and so is EA Giverportal's row for the
          number. Use it when Altinn rejects a number and the donor can't be reached: correct it
          later with RF-1310.
        </p>
      }
      actions={<LeaveOut year={overview.year} />}
    >
      {rows.length === 0 ? (
        <Callout tone="success" title="Nothing is left out">
          Every tax unit with at least the minimum is in the file.
        </Callout>
      ) : (
        <div className="relative max-h-96 overflow-auto rounded-md border border-border">
          <Table aria-label="Left out of the file">
            <TableHeader>
              <TableRow>
                <TableHead>Donor</TableHead>
                <TableHead>Tax unit</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Sum</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
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
                  <TableCell>
                    <span className="block">{row.reason}</span>
                    <span className="text-sm text-muted-foreground">
                      <DateTime value={row.at} format="date" />, {row.by}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.sum} />
                    {!row.aboveMinimum && (
                      <span className="block text-sm text-muted-foreground">below minimum</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <PutBack year={overview.year} taxUnitIds={row.taxUnitIds} name={row.name} />
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

function PutBack({ year, taxUnitIds, name }: { year: number; taxUnitIds: number[]; name: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const include = useMutation(trpc.reports.tax.includeUnits.mutationOptions());
  return (
    <Button
      size="sm"
      pending={include.isPending}
      aria-label={`Put ${name || "the tax unit"} back in the file`}
      onClick={async () => {
        await include.mutateAsync({ year, taxUnitIds });
        await queryClient.invalidateQueries({ queryKey: trpc.reports.tax.pathKey() });
        notify.success("Back in the file", `${name || "The tax unit"} is reported for ${year}.`);
      }}
    >
      <Undo2Icon />
      Put back
    </Button>
  );
}

/**
 * Leaves a tax unit out of the year's file. Given donorId and taxUnitId (from Invalid numbers)
 * it only asks for the reason; otherwise the donor is entered and one of their tax units picked.
 */
export function LeaveOut({
  year,
  donorId: givenDonor,
  taxUnitId: givenUnit,
  reason: suggested = "",
}: {
  year: number;
  donorId?: number;
  taxUnitId?: number;
  reason?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [donorText, setDonorText] = useState("");
  const [unitId, setUnitId] = useState<string | undefined>();
  const [reason, setReason] = useState(suggested);
  const exclude = useMutation(trpc.reports.tax.excludeUnit.mutationOptions());
  const donorId =
    givenDonor ??
    (/^#?\d+$/.test(donorText.trim()) ? Number(donorText.trim().replace("#", "")) : null);
  const units = useQuery({
    ...trpc.donors.taxUnits.list.queryOptions({ donorId: donorId ?? 0 }),
    enabled: open && !givenUnit && donorId !== null,
  });
  const chosen = givenUnit ?? (unitId ? Number(unitId) : null);
  const reasonOk = reason.trim().length >= 3;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDonorText("");
          setUnitId(undefined);
          setReason(suggested);
        }
      }}
      title={`Leave a tax unit out of the file for ${year}?`}
      description="Its gifts are not reported to Skatteetaten. The donor gets no deduction for them unless you put it back or send a correction."
      confirmLabel="Leave out"
      tone="danger"
      disabled={chosen === null || !reasonOk}
      consequences={[
        "Every tax unit with the same number is left out, and EA Giverportal's row for it.",
        "It is saved for everyone, with your name and the reason, and can be put back.",
      ]}
      trigger={
        <Button size="sm">
          <CircleSlashIcon />
          {givenUnit ? "Leave out" : "Leave a tax unit out"}
        </Button>
      }
      onConfirm={async () => {
        if (chosen === null) return;
        await exclude.mutateAsync({ year, taxUnitId: chosen, reason: reason.trim() });
        await queryClient.invalidateQueries({ queryKey: trpc.reports.tax.pathKey() });
        notify.success("Left out of the file", `The tax unit is not reported for ${year}.`);
      }}
    >
      <div className="grid gap-4">
        {!givenUnit && (
          <>
            <Field label="Donor ID">
              <Input
                inputMode="numeric"
                value={donorText}
                onChange={(event) => {
                  setDonorText(event.target.value);
                  setUnitId(undefined);
                }}
                placeholder="#1234"
              />
            </Field>
            {donorId !== null && units.data && units.data.length === 0 && (
              <p className="text-sm text-muted-foreground">The donor has no tax units.</p>
            )}
            {units.data && units.data.length > 0 && (
              <ChoiceCards
                label="Tax unit"
                value={unitId}
                onValueChange={setUnitId}
                options={units.data.map((unit) => ({
                  value: String(unit.id),
                  label: unit.name || "No name",
                  description: maskNumber(unit.ssn) + (unit.archived ? " (archived)" : ""),
                }))}
              />
            )}
          </>
        )}
        <Field label="Reason" error={reason && !reasonOk ? "Say why" : undefined}>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Altinn rejected the number; the donor hasn't answered"
            rows={2}
          />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
