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
