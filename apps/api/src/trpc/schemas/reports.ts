import { z } from "zod";
import { noticeOptionsProblem } from "../../custom_modules/missingTaxUnitNoticeOptions";
import { TRPC_MAX_BODY_SIZE } from "../reportsMultipart";
import {
  reviewQueueSources,
  reviewQueueStatuses,
} from "../../custom_modules/DAO_modules/reviewqueue";
import {
  distributionSchema,
  idSchema as id,
  isoDateOrDateTimeSchema,
  isoDateSchema,
  moneySchema,
  paginationFields,
  sortSchema,
} from "./common";
import { paymentExternalRefSchema } from "./donations";

export const idInput = z.strictObject({ id });

export const donorIdInput = z.strictObject({ donorId: id });

//region FormData uploads

/**
 * Collects FormData entries into a plain object. A key sent more than once becomes an array, so
 * the object schema rejects e.g. two `report` files instead of silently picking one.
 */
const formDataToRecord = (formData: FormData) => {
  const record: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key);
    record[key] = values.length === 1 ? values[0] : values;
  }
  return record;
};

/**
 * Input for a procedure called with a FormData body (multipart/form-data). The client must send
 * these through a non-batching link (`httpLink`), e.g. with `splitLink` +
 * `isNonJsonSerializable(op.input)`.
 */
export const formDataInput = <S extends z.ZodRawShape>(shape: S) =>
  z
    .instanceof(FormData)
    // `any` so the object schema below can declare its own input types
    .transform((formData): any => formDataToRecord(formData))
    .pipe(z.strictObject(shape));

const singleFile = z
  .unknown()
  .refine((value) => !Array.isArray(value), "Upload one report file at a time")
  .pipe(z.instanceof(File, { message: "Missing report file" }));

export const reportFile = singleFile
  .refine((file) => file.size > 0, "Report file is empty")
  .refine((file) => file.size <= TRPC_MAX_BODY_SIZE, "Report file is larger than 10 MB");

/** Numeric FormData field, e.g. "3" */
const positiveIntField = z
  .string()
  .regex(/^[1-9]\d*$/, "Expected a positive integer")
  .transform(Number);

/** Data owner to register the donations under; the default owner when omitted */
const metaOwnerIDField = positiveIntField.optional();

export const reportUploadInput = formDataInput({
  report: reportFile,
  metaOwnerID: metaOwnerIDField,
});

export const bankSeUploadInput = formDataInput({
  report: reportFile,
  metaOwnerID: metaOwnerIDField,
  dryRun: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

/** Windows browsers send .csv files as application/vnd.ms-excel or application/octet-stream */
const isCsv = (file: File) =>
  file.type === "text/csv" ||
  (["application/vnd.ms-excel", "application/octet-stream", ""].includes(file.type) &&
    file.name.toLowerCase().endsWith(".csv"));

export const ku65Input = formDataInput({
  report: reportFile.refine(isCsv, "Invalid file type, must be CSV"),
  year: z
    .string()
    .regex(/^\d{4}$/, "Invalid year")
    .transform(Number)
    .pipe(z.number().int().min(2000, "Invalid year").max(2100, "Invalid year")),
});

/** Tax deduction report (Skatteetaten): the gift year and the minimum per tax unit */
const taxYear = z.number().int().min(2000, "Invalid year").max(2100, "Invalid year");
const taxMinSum = z.number().int().min(0).max(1_000_000);

export const taxOverviewInput = z.strictObject({ year: taxYear, minSum: taxMinSum });

const requiredText = (label: string, max = 100) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const skatteetatenXmlInput = formDataInput({
  report: reportFile.refine(isCsv, "Invalid file type, must be CSV"),
  year: z
    .string()
    .regex(/^\d{4}$/, "Invalid year")
    .transform(Number)
    .pipe(taxYear),
  minSum: z.string().regex(/^\d+$/, "Invalid minimum").transform(Number).pipe(taxMinSum),
  name: requiredText("Name"),
  email: z.email("Enter a valid email address").max(100),
  // Skatteetaten's schema allows at most 20 characters
  phoneNumber: requiredText("Phone number", 20),
  smsNumber: requiredText("SMS number", 20),
});

/** The notice as the first recipient of the round would get it */
export const taxNoticePreviewInput = z.strictObject({
  year: taxYear,
  minSum: taxMinSum.min(1),
  round: z.enum(["notice", "reminder"]),
  donorIds: z.array(z.number().int().positive()).min(1).max(5000).optional(),
});

/** Connects a donor's gifts in the year on KIDs without tax unit to one of their tax units */
export const taxConnectGiftsInput = z.strictObject({
  year: taxYear,
  donorId: z.number().int().positive(),
  taxUnitId: z.number().int().positive(),
});

/** Leaves a tax unit (and every unit with its number) out of the year's report, with the reason */
export const taxExcludeUnitInput = z.strictObject({
  year: taxYear,
  taxUnitId: z.number().int().positive(),
  reason: z.string().trim().min(3, "Say why").max(500),
});

/** Puts tax units left out back in the year's report */
export const taxIncludeUnitsInput = z.strictObject({
  year: taxYear,
  taxUnitIds: z.array(z.number().int().positive()).min(1).max(100),
});

/** Donors to compare before merging, e.g. the donors sharing a national ID */
export const taxCompareDonorsInput = z.strictObject({
  donorIds: z.array(z.number().int().positive()).min(2).max(10),
});

/** Moves donors to "Left out" (excluded) or back to "Gets the notice" for the year */
export const taxNoticeStatusInput = z.strictObject({
  year: taxYear,
  donorIds: z.array(z.number().int().positive()).min(1).max(5000),
  status: z.enum(["excluded", "notice"]),
});

export const missingTaxUnitNoticeInput = z
  .strictObject({
    year: taxYear,
    minSum: taxMinSum.min(1),
    /** Test mode: every notice goes to this address */
    testEmail: z.email().max(255).optional(),
    /** Test mode: only the first donors (with testEmail) */
    testLimit: z.number().int().min(1).max(100).optional(),
    /** Sending to the donors themselves: the year again, as typed in the confirmation */
    confirmYear: taxYear.optional(),
    /** The notice to "Gets the notice" (default), or a reminder to "Sent" */
    round: z.enum(["notice", "reminder"]).optional(),
    /** Only these donors (ticked in the list) */
    donorIds: z.array(z.number().int().positive()).min(1).max(5000).optional(),
  })
  .superRefine((input, ctx) => {
    const problem = noticeOptionsProblem(input);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["confirmYear"] });
  });

//endregion

//region Transaction report

export const transactionRangeInput = z
  .strictObject({
    /** Inclusive, the whole Europe/Oslo day */
    fromDate: isoDateSchema,
    /** Inclusive, the whole Europe/Oslo day */
    toDate: isoDateSchema,
    /** All payment methods when omitted */
    paymentMethodIDs: z.array(id).min(1).optional(),
  })
  .refine((input) => input.fromDate <= input.toDate, {
    message: "fromDate must not be after toDate",
    path: ["toDate"],
  });

//endregion

//region Logs

export const logsSort = sortSchema(["timestamp", "label", "id"] as const);

export const logsListInput = z.strictObject({
  ...paginationFields,
  /** Newest first when omitted */
  sort: logsSort.optional(),
  filter: z
    .strictObject({
      /** Partial match on the stored file content or the uploaded file's name */
      fileSearch: z.string().optional(),
    })
    .optional(),
});

//endregion

//region Fundraisers

/** Whole Europe/Oslo days, `to` inclusive */
const dateRange = z.strictObject({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

const countRange = z.strictObject({
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional(),
});

const sumRange = z.strictObject({
  from: z.number().nonnegative().optional(),
  to: z.number().nonnegative().optional(),
});

/** Mirrors FundraiserListFilter in DAO_modules/fundraisers.ts */
export const fundraiserFilter = z.strictObject({
  registrationDate: dateRange.optional(),
  fundraiserId: id.optional(),
  /** Fuzzy match on the fundraiser owner's name */
  donor: z.string().optional(),
  donationCount: countRange.optional(),
  donationSum: sumRange.optional(),
  /** Fundraisers with at least one donation to one of these organizations */
  organizationIDs: z.array(id).optional(),
});

/** Sortable columns, see jsDBmapping in DAO_modules/fundraisers.ts */
export const fundraiserSort = sortSchema([
  "id",
  "registered",
  "donor",
  "totalSum",
  "donationCount",
  "averageDonation",
] as const);

export const fundraisersListInput = z.strictObject({
  ...paginationFields,
  sort: fundraiserSort.optional(),
  filter: fundraiserFilter.optional(),
});

//endregion

//region Review queue

export const reviewQueueSourceSchema = z.enum(reviewQueueSources);
export const reviewQueueStatusSchema = z.enum(reviewQueueStatuses);

export const reviewQueueSort = sortSchema([
  "id",
  "created",
  "date",
  "amount",
  "source",
  "status",
] as const);

export const reviewQueueListInput = z.strictObject({
  ...paginationFields,
  sort: reviewQueueSort.optional(),
  filter: z
    .strictObject({
      statuses: z.array(reviewQueueStatusSchema).min(1).optional(),
      sources: z.array(reviewQueueSourceSchema).min(1).optional(),
    })
    .optional(),
});

export const reviewQueueSearchInput = z.strictObject({
  /** An item id, or part of a KID, external id, payer name or message */
  query: z.string().trim().min(1).max(255),
  limit: z.number().int().positive().max(50).default(10),
});

/**
 * Registers a donation from a queued item. The amount, date, payment method, external reference
 * and data owner default to the item's; the admin supplies the KID or a distribution.
 */
export const reviewQueueRegisterInput = z
  .strictObject({
    id,
    KID: z.string().min(1).optional(),
    distribution: distributionSchema.optional(),
    sum: moneySchema.optional(),
    timestamp: isoDateOrDateTimeSchema.optional(),
    paymentId: id.optional(),
    /** null registers the donation without an external reference */
    paymentExternalRef: paymentExternalRefSchema.nullable().optional(),
    /** Defaults to the data owner chosen at upload (the item's metaOwnerId), else the default owner */
    metaOwnerId: id.optional(),
    sendReceipt: z.boolean(),
  })
  .refine((input) => (input.KID === undefined) !== (input.distribution === undefined), {
    message: "Provide either a KID or a distribution, not both",
  });

const ignoreNote = z.string().trim().min(1).max(2000).optional();

export const reviewQueueIgnoreInput = z.strictObject({ id, note: ignoreNote });

/** Several items at once, e.g. after a wrong upload; at most 500 per call */
export const reviewQueueIgnoreManyInput = z.strictObject({
  ids: z.array(id).min(1).max(500),
  note: ignoreNote,
});

/** Every open item from one import (Import_logs id), however many pages they fill */
export const reviewQueueIgnoreImportInput = z.strictObject({ importLogId: id, note: ignoreNote });

export const reviewQueueImportInput = z.strictObject({ importLogId: id });

//endregion
