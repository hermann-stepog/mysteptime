/**
 * Lê NDJSON linha a linha a partir de um ReadableStream.
 * Compartilhado pelos fluxos independentes de atualização do Drake.
 */
export async function consumeDrakeNdjsonStream<TEvent>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        onEvent(JSON.parse(trimmed) as TEvent);
      }
    }
    const tail = buffer.trim();
    if (tail) onEvent(JSON.parse(tail) as TEvent);
  } finally {
    reader.releaseLock();
  }
}
