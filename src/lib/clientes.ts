export const CLIENTES = [
  "SBM", "Altera", "PRIO", "Perenco", "Seadrill", "Yinson", "BW", "Trident",
  "BW Energy", "Karoon", "MSI", "Poseidon", "Qualitech",
] as const;
export type Cliente = (typeof CLIENTES)[number];
