export const CLIENTES = ["SBM", "Altera", "PRIO", "Perenco", "Seadrill", "Yinson", "BW", "Trident"] as const;
export type Cliente = (typeof CLIENTES)[number];
