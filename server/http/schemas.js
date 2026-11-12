import { z } from "zod";
import { priorities } from "../domain.js";
import { failCode } from "./errors.js";

export const text = z.string().trim().min(1).max(2000);
export const coordinate = {
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
};
export const occurrenceSchema = z.object({
  request_id: z.string().uuid().optional(),
  requested_by: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(40).default(""),
  category_id: text,
  subcategory: text,
  sector_id: text.optional(),
  description: text,
  origin: text,
  address: text,
  neighborhood: text,
  reference: z.string().max(1000).default(""),
  priority: z.enum(priorities),
  ...coordinate,
  duplicate_action: z.enum(["new", "link"]).optional(),
  duplicate_id: z.string().optional(),
});
// Optional idempotency key; absent values keep the legacy behavior untouched.
export const optionalRequestId = (value) =>
  value === undefined || value === null || value === ""
    ? undefined
    : z.string().uuid().parse(value);
const CAPTURE_FUTURE_MS = 5 * 60 * 1000;
const CAPTURE_PAST_MS = 30 * 24 * 3600 * 1000;
// Real time of field work (offline capture). Normalized to UTC ISO so string comparisons stay valid.
export const parseCapturedAt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const valid =
    typeof value === "string" &&
    z.string().datetime({ offset: true }).safeParse(value).success;
  const time = valid ? Date.parse(value) : NaN;
  const current = Date.now();
  if (
    !Number.isFinite(time) ||
    time > current + CAPTURE_FUTURE_MS ||
    time < current - CAPTURE_PAST_MS
  )
    failCode(400, "Data e hora de captura inválida.", "INVALID_CAPTURED_AT");
  return new Date(time).toISOString();
};
