/**
 * Analysis: the overview (collected this year, through time, open pledges) and pledges
 * (tilsagn), decided gifts that haven't arrived. Pledges are a separate layer on top of the
 * measured totals, never part of them.
 */
import { moneyInputError, parseMoneyInput } from "@/features/donations/form";
import type { RouterInputs, RouterOutputs } from "@/lib/trpc";

export type Overview = RouterOutputs["analysis"]["overview"];
export type Pledge = RouterOutputs["analysis"]["pledges"]["list"][number];
export type PledgeCreateInput = RouterInputs["analysis"]["pledges"]["create"];
export type PledgeReceivedInput = RouterInputs["analysis"]["pledges"]["markReceived"];

//region Overview

/** Ease-out: fast at first, settling on the value. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** The count-up's value `elapsed` ms into `duration`, from `from` to `target`, in whole kroner. */
export function countUpValue(target: number, elapsed: number, duration: number, from = 0) {
  if (elapsed >= duration) return target;
  return Math.round(from + (target - from) * easeOut(Math.max(elapsed, 0) / duration));
}

/** How often the overview asks for fresh numbers: new donations show within a minute. */
export const OVERVIEW_REFRESH_MS = 60_000;

//endregion

//region Pledges

export const isOpen = (pledge: Pledge) => pledge.receivedDate === null;

export type PledgeForm = { sum: string; decidedDate: string };

export function validatePledge(form: PledgeForm) {
  return {
    sum: moneyInputError(form.sum),
    decidedDate: form.decidedDate ? undefined : "Enter the date it was decided",
  };
}

/** analysis.pledges.create input. Assumes validatePledge passed. */
export const pledgeCreateInput = (form: PledgeForm): PledgeCreateInput => ({
  sum: Number(parseMoneyInput(form.sum)!),
  decidedDate: form.decidedDate,
});

export type ReceivedForm = { receivedDate: string; donationId: string };

export function validateReceived(form: ReceivedForm) {
  const id = form.donationId.trim();
  return {
    receivedDate: form.receivedDate ? undefined : "Enter the date the money came in",
    donationId: id === "" || /^[1-9]\d*$/.test(id) ? undefined : "Enter a donation ID (digits)",
  };
}

/** analysis.pledges.markReceived input. Assumes validateReceived passed. */
export const receivedInput = (id: number, form: ReceivedForm): PledgeReceivedInput => ({
  id,
  receivedDate: form.receivedDate,
  donationId: form.donationId.trim() ? Number(form.donationId.trim()) : null,
});

//endregion
