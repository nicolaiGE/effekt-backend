import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LinkIcon } from "lucide-react";
import { useState } from "react";
import { Callout } from "@/components/domain/callout";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { Money, Num } from "@/components/domain/format";
import { SettingsSection } from "@/components/templates";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/choice-cards";
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
type Row = Overview["unconnected"][number];

const linkClass = "rounded-xs text-accent hover:underline focus-ring";
const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("nb-NO")} ${n === 1 ? one : many}`;

/**
 * Gifts not on the donor's tax unit: donors who registered a tax unit, but gave in the year on
 * KIDs without one. Those gifts are not reported. Connect puts the KIDs on one of the donor's tax
 * units (reports.tax.connectToTaxUnit).
 */
export function UnconnectedGifts({ overview }: { overview: Overview }) {
  const rows = overview.unconnected;
  return (
    <SettingsSection
      title="Gifts not on the donor's tax unit"
      description={
        <p>
          Donors with a tax unit who gave in {overview.year} on KIDs without one, for example an old
          AvtaleGiro or a gift registered by hand. These gifts are not reported, though the donor
          has registered. Connect puts the KIDs on the donor's tax unit, so later gifts on them are
          covered too. Gifts from before {overview.year} on the same KIDs stay as they were.
        </p>
      }
    >
      {rows.length === 0 ? (
        <Callout tone="success" title="Every gift is on the donor's tax unit">
          Nothing to check here.
        </Callout>
      ) : (
        <div className="relative max-h-96 overflow-auto rounded-md border border-border">
          <Table aria-label="Gifts not on the donor's tax unit" className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[38%]">Donor</TableHead>
                <TableHead>Tax units</TableHead>
                <TableHead className="w-36 text-right">Sum</TableHead>
                <TableHead className="w-36">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.donorId}>
                  <TableCell className="min-w-0">
                    <span className="block truncate">
                      <Link
                        to="/donors/$id"
                        params={{ id: String(row.donorId) }}
                        className={linkClass}
                      >
                        #{row.donorId}
                      </Link>{" "}
                      {row.name || "No name"}
                    </span>
                    {row.email && (
                      <span
                        className="block truncate text-sm text-muted-foreground"
                        title={row.email}
                      >
                        {row.email}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-0">
                    {row.taxUnits.map((unit) => (
                      <span key={unit.id} className="block truncate">
                        {unit.name || "No name"}{" "}
                        <span className="num text-muted-foreground">{unit.maskedNumber}</span>
                      </span>
                    ))}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Money value={row.donationsSum} />
                    <span className="block text-sm text-muted-foreground">
                      <Num value={row.donations} /> {row.donations === 1 ? "donation" : "donations"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Connect year={overview.year} row={row} />
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

function Connect({ year, row }: { year: number; row: Row }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const connect = useMutation(trpc.reports.tax.connectToTaxUnit.mutationOptions());
  const only = row.taxUnits.length === 1 ? String(row.taxUnits[0]!.id) : undefined;
  const [unitId, setUnitId] = useState<string | undefined>(only);
  const unit = row.taxUnits.find((u) => String(u.id) === unitId);

  return (
    <ConfirmDialog
      title={`Connect the gifts of #${row.donorId} in ${year} to their tax unit?`}
      description="The gifts are reported with the tax unit's other gifts."
      confirmLabel={unit ? `Connect to ${unit.name || "the tax unit"}` : "Connect"}
      disabled={!unit}
      consequences={[
        <>
          {plural(row.donations, "donation", "donations")} (<Money value={row.donationsSum} />) on{" "}
          {plural(row.kids, "KID", "KIDs")} {row.donations === 1 ? "gets" : "get"} the tax unit
          {unit ? ` ${unit.name || ""} (${unit.maskedNumber})` : ""}, and so do later gifts on these
          KIDs.
        </>,
        `Gifts before ${year} on these KIDs stay without a tax unit, on a copy of the KID.`,
      ]}
      trigger={
        <Button size="sm" onClick={() => setUnitId(only)}>
          <LinkIcon />
          Connect gifts
        </Button>
      }
      onConfirm={async () => {
        if (!unit) return;
        const result = await connect.mutateAsync({
          year,
          donorId: row.donorId,
          taxUnitId: unit.id,
        });
        notify.success(
          "Gifts connected",
          `${plural(result.kids, "KID", "KIDs")} of #${row.donorId} now have the tax unit` +
            (result.copiedKids > 0
              ? `; ${plural(result.earlierDonationsKept, "earlier donation", "earlier donations")} kept as before.`
              : "."),
        );
        await queryClient.invalidateQueries({ queryKey: trpc.reports.tax.pathKey() });
      }}
    >
      {row.taxUnits.length > 1 && (
        <p className="text-sm text-muted-foreground">
          The donor has {row.taxUnits.length} tax units, for example a national ID and a company.
          All the gifts above go to the one you pick. If some belong to another unit, change those
          donations one by one instead (the donation’s Edit › Tax unit), from the{" "}
          <Link
            to="/donors/$id"
            params={{ id: String(row.donorId) }}
            className="rounded-xs text-accent hover:underline focus-ring"
          >
            donor’s donations
          </Link>
          .
        </p>
      )}
      {row.taxUnits.length > 1 && (
        <ChoiceCards
          label="Tax unit"
          value={unitId}
          onValueChange={setUnitId}
          options={row.taxUnits.map((u) => ({
            value: String(u.id),
            label: u.name || "No name",
            description: u.maskedNumber,
          }))}
        />
      )}
    </ConfirmDialog>
  );
}
