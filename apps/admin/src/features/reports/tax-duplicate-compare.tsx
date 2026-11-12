import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { GitMergeIcon, UsersIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Callout } from "@/components/domain/callout";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Money, Num } from "@/components/domain/format";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/choice-cards";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Pending } from "@/components/ui/pending";
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

type Donor = RouterOutputs["reports"]["tax"]["compareDonors"][number];

const linkClass = "rounded-xs text-accent hover:underline focus-ring";
const count = (n: number, one: string, many: string) => (
  <>
    <Num value={n} /> {n === 1 ? one : many}
  </>
);
const label = (donor: Donor) => `${donor.name || donor.email} (#${donor.id})`;

/**
 * Possible duplicate donors › Compare: the donors sharing a national ID side by side, to judge
 * whether they are one person, and a merge into the one to keep. Each of the others is merged
 * into it with donors.merge, which moves donations, agreements, tax units and KIDs and deletes
 * the other donor.
 */
export function CompareDuplicates({ donorIds }: { donorIds: number[] }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState<string | undefined>();
  const donors = useQuery({
    ...trpc.reports.tax.compareDonors.queryOptions({ donorIds }),
    enabled: open,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setKeep(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UsersIcon />
          Compare
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare donors {donorIds.map((id) => `#${id}`).join(" and ")}</DialogTitle>
          <DialogDescription>
            They have tax units with the same national ID. Merge them if they are one person: pick
            the donor to keep, and the others move into it.
          </DialogDescription>
        </DialogHeader>
        {donors.error ? (
          <ErrorState error={donors.error} onRetry={() => void donors.refetch()} />
        ) : !donors.data ? (
          <Pending className="min-h-40" />
        ) : (
          <div className="grid gap-5">
            <Comparison donors={donors.data} />
            {donors.data.length < donorIds.length && (
              <Callout tone="warning" title="A donor is gone">
                One of the donors no longer exists, perhaps merged already. Close and reload the
                page.
              </Callout>
            )}
            <ChoiceCards
              label="Donor to keep"
              value={keep}
              onValueChange={setKeep}
              options={donors.data.map((donor) => ({
                value: String(donor.id),
                label: `Keep #${donor.id}`,
                description: `${donor.name || "No name"}, ${donor.email}`,
              }))}
            />
          </div>
        )}
        <DialogFooter>
          {donors.data && (
            <MergeInto
              donors={donors.data}
              keepId={keep ? Number(keep) : null}
              onDone={() => setOpen(false)}
            />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Comparison({ donors }: { donors: Donor[] }) {
  const rows: { label: string; value: (donor: Donor) => ReactNode }[] = [
    { label: "Name", value: (donor) => donor.name || "–" },
    { label: "Email", value: (donor) => <span className="break-all">{donor.email}</span> },
    { label: "Registered", value: (donor) => <DateTime value={donor.registered} format="date" /> },
    {
      label: "Donations",
      value: (donor) => (
        <>
          <Num value={donor.donations} />, <Money value={donor.donationsSum} />
        </>
      ),
    },
    {
      label: "Last donation",
      value: (donor) =>
        donor.lastDonation ? <DateTime value={donor.lastDonation} format="date" /> : "–",
    },
    { label: "KIDs", value: (donor) => <Num value={donor.kids} /> },
    {
      label: "Agreements",
      value: (donor) => (
        <>
          <Num value={donor.agreements} /> (<Num value={donor.activeAgreements} /> active)
        </>
      ),
    },
    {
      label: "Tax units",
      value: (donor) =>
        donor.taxUnits.length === 0
          ? "–"
          : donor.taxUnits.map((unit) => (
              <span key={unit.id} className="block">
                {unit.name || "No name"}{" "}
                <span className="num text-muted-foreground">{unit.maskedNumber}</span>
                {unit.archived && <span className="text-muted-foreground"> (archived)</span>}
              </span>
            )),
    },
  ];
  return (
    <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
      <Table aria-label="Donors compared">
        <TableHeader>
          <TableRow>
            <TableHead />
            {donors.map((donor) => (
              <TableHead key={donor.id}>
                <Link to="/donors/$id" params={{ id: String(donor.id) }} className={linkClass}>
                  #{donor.id}
                </Link>
                {donor.trashed && <span className="text-muted-foreground"> (deleted)</span>}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableHead scope="row" className="font-normal text-muted-foreground">
                {row.label}
              </TableHead>
              {donors.map((donor) => (
                <TableCell key={donor.id} className="align-top">
                  {row.value(donor)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MergeInto({
  donors,
  keepId,
  onDone,
}: {
  donors: Donor[];
  keepId: number | null;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const merge = useMutation(trpc.donors.merge.mutationOptions());
  const keep = donors.find((donor) => donor.id === keepId);
  const others = donors.filter((donor) => donor.id !== keepId);
  const sum = (pick: (donor: Donor) => number) => others.reduce((acc, d) => acc + pick(d), 0);

  return (
    <ConfirmDialog
      title={keep ? `Merge into ${label(keep)}?` : "Merge donors?"}
      description="Everything on the other donors moves to the donor you keep."
      tone="danger"
      confirmLabel={keep ? `Merge into #${keep.id}` : "Merge donors"}
      confirmText={keep ? String(keep.id) : undefined}
      disabled={!keep}
      consequences={
        keep
          ? [
              <>
                {count(
                  sum((d) => d.donations),
                  "donation",
                  "donations",
                )}
                ,{" "}
                {count(
                  sum((d) => d.agreements),
                  "agreement",
                  "agreements",
                )}
                ,{" "}
                {count(
                  sum((d) => d.taxUnits.length),
                  "tax unit",
                  "tax units",
                )}{" "}
                and{" "}
                {count(
                  sum((d) => d.kids),
                  "KID",
                  "KIDs",
                )}{" "}
                move to #{keep.id}.
              </>,
              <>
                {others.map((d) => `#${d.id} (${d.email})`).join(", ")}{" "}
                {others.length === 1 ? "is" : "are"} deleted. This can't be undone.
              </>,
            ]
          : undefined
      }
      trigger={
        <Button variant="primary" disabled={!keep}>
          <GitMergeIcon />
          {keep ? `Merge into #${keep.id}` : "Pick the donor to keep"}
        </Button>
      }
      onConfirm={async () => {
        if (!keep) return;
        for (const other of others)
          await merge.mutateAsync({ originId: other.id, destinationId: keep.id });
        notify.success(
          "Donors merged",
          `${others.map((d) => `#${d.id}`).join(", ")} ${others.length === 1 ? "is" : "are"} now part of #${keep.id}`,
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.reports.tax.pathKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.donors.pathKey() }),
        ]);
        onDone();
      }}
    />
  );
}
