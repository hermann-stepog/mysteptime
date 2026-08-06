import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getJobOrderPoTotal = createServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      poNumber: z.string().trim().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { fetchJobOrderPoTotal } = await import(
      "../jobOrderPoTotal.server"
    );

    return fetchJobOrderPoTotal(data.poNumber);
  });
