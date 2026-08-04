/** Fetch server-only compatível com o runtime nativo do Lovable. */
import "@tanstack/react-start/server-only";

export const supabaseServerFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, init);
