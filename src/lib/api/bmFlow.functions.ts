import { createServerFn } from "@tanstack/react-start";

export const listBmFlowRows = createServerFn({ method: "GET" }).handler(
  async () => {
    const { fetchBmFlowRows } = await import("../smartsheetBm.server");
    return fetchBmFlowRows();
  },
);
