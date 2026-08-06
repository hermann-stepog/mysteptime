import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchPoInfo, fetchBmHistory, insertIssuedBm } from "../smartsheetBm.server";

export const getPoInfo = createServerFn({ method: "GET" })
  .inputValidator(z.object({ poNumber: z.string().min(1) }))
  .handler(async ({ data }) => fetchPoInfo(data.poNumber));

export const getBmHistoryForPo = createServerFn({ method: "GET" })
  .inputValidator(z.object({ poNumber: z.string().min(1) }))
  .handler(async ({ data }) => fetchBmHistory(data.poNumber));

export const recordIssuedBm = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    poNumber: z.string().min(1),
    bmNumber: z.string(),
    client: z.string(),
    vessel: z.string(),
    value: z.number(),
  }))
  .handler(async ({ data }) => insertIssuedBm(data));

export const listSmartsheetBms = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchBmList } = await import("../smartsheetBm.server");
  return fetchBmList();
});

export const applyMedicaoToBm = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    rowId: z.string().min(1),
    columnTitle: z.string().min(1),
    value: z.number(),
    addToTotal: z.boolean().default(true),
  }))
  .handler(async ({ data }) => {
    const { applyMedicaoToBmRow } = await import("../smartsheetBm.server");
    return applyMedicaoToBmRow(data);
  });

export const listJobOrderPos = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchJobOrderPos } = await import("../smartsheetBm.server");
  return fetchJobOrderPos();
});

export const getNextBmNumber = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchNextBmNumber } = await import("../smartsheetBm.server");
  return fetchNextBmNumber();
});
