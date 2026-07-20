import type { DrakeProgressEvent } from "./update-types";

/**
 * Lê NDJSON linha a linha a partir de um ReadableStream.
 * Usado pelo card para atualizar a barra em tempo real.
 */
export async function consumeDrakeNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: DrakeProgressEvent) => void,
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
        onEvent(JSON.parse(trimmed) as DrakeProgressEvent);
      }
    }
    const tail = buffer.trim();
    if (tail) onEvent(JSON.parse(tail) as DrakeProgressEvent);
  } finally {
    reader.releaseLock();
  }
}
