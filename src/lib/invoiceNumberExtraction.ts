export type InvoiceExtractionMethod = "pdf-text" | "ocr";

export interface InvoiceNumberExtractionResult {
  number: string | null;
  method: InvoiceExtractionMethod | null;
}

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanCandidate(value: string): string | null {
  const candidate = value
    .trim()
    .replace(/^[#:\-.\s]+|[#:\-.\s]+$/g, "");

  if (!candidate) return null;

  const compact = candidate.replace(/[^a-z0-9]/gi, "");

  // Número de nota precisa conter pelo menos um algarismo.
  // Isso evita falsos positivos do OCR como "referencia", "rencia", etc.
  if (!/\d/.test(compact)) return null;

  // Evita confundir chave de acesso de NF-e, CNPJ etc.
  if (compact.length === 44) return null;
  if (compact.length > 20) return null;

  return candidate;
}

export function findInvoiceNumber(text: string): string | null {
  // NFS-e costuma vir em tabela:
  //
  // NÚMERO DA NFS-E | COMPETÊNCIA | DATA...
  // 1957            | 03/08/2026  | ...
  //
  // Por isso, antes dos regex gerais, preservamos as quebras de linha
  // e procuramos o primeiro número no início da linha seguinte ao cabeçalho.
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = normalizeText(lines[i]);

    if (
      /numero\s+da\s+nfs-?e/.test(line) ||
      /numero\s+da\s+nf-?e/.test(line)
    ) {
      for (let offset = 1; offset <= 2; offset++) {
        const nextLine = lines[i + offset];
        if (!nextLine) continue;

        const match = nextLine.trim().match(/^(\d{1,20})\b/);

        if (match?.[1]) {
          const candidate = cleanCandidate(match[1]);
          if (candidate) return candidate;
        }
      }
    }
  }

  const normalized = normalizeText(text);

  // Só preenche automaticamente quando existe um rótulo explícito de número.
  // Evita falsos positivos como "v2.0", versões de layout, referências etc.
  const patterns: RegExp[] = [
    /(?:numero|n[ºo.]*)\s*(?:da\s*)?nfs-?e\s*[:#-]?\s*(\d[\d./-]{0,19})/i,
    /nfs-?e\s*(?:numero|n[ºo.]*)\s*[:#-]?\s*(\d[\d./-]{0,19})/i,
    /(?:numero|n[ºo.]*)\s*(?:da\s+)?nota(?:\s+fiscal)?\s*[:#-]?\s*(\d[\d./-]{0,19})/i,
    /nota\s+fiscal(?:\s+eletronica)?\s*(?:numero|n[ºo.]*)\s*[:#-]?\s*(\d[\d./-]{0,19})/i,
    /nf-?e\s*(?:numero|n[ºo.]*)\s*[:#-]?\s*(\d[\d./-]{0,19})/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;

    const candidate = cleanCandidate(match[1]);
    if (candidate) return candidate;
  }

  return null;
}

async function loadPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");

  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

async function extractPdfText(file: File): Promise<string> {
  const pdf = await loadPdf(file);
  const parts: string[] = [];

  // Para numero de nota, normalmente basta olhar as 3 primeiras paginas.
  const pages = Math.min(pdf.numPages, 3);

  for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const text = textContent.items
      .map((item: any) => ("str" in item ? String(item.str) : ""))
      .join(" ");

    parts.push(text);
  }

  return parts.join("\n");
}

async function runOcr(image: Blob | File): Promise<string> {
  const { createWorker } = await import("tesseract.js");

  // "por" reconhece documentos em portugues.
  const worker = await createWorker("por");

  try {
    const result = await worker.recognize(image);
    return result.data.text ?? "";
  } finally {
    await worker.terminate();
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Nao foi possivel gerar imagem da pagina."));
      },
      "image/png",
      0.95,
    );
  });
}

function rotateCanvas90Clockwise(
  source: HTMLCanvasElement,
): HTMLCanvasElement {
  const rotated = document.createElement("canvas");

  rotated.width = source.height;
  rotated.height = source.width;

  const context = rotated.getContext("2d");

  if (!context) {
    throw new Error("Canvas indisponivel para rotacao.");
  }

  context.translate(rotated.width, 0);
  context.rotate(Math.PI / 2);
  context.drawImage(source, 0, 0);

  return rotated;
}

async function extractScannedPdfWithOcr(file: File): Promise<string> {
  const pdf = await loadPdf(file);
  const parts: string[] = [];

  const pages = Math.min(pdf.numPages, 8);

  for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.8 });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas indisponivel para OCR.");
    }

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    // 1. Tenta na orientacao original.
    const originalImage = await canvasToBlob(canvas);
    const originalText = await runOcr(originalImage);

    parts.push(originalText);

    if (findInvoiceNumber(originalText)) {
      return originalText;
    }

    // 2. Muitos comprovantes chegam escaneados de lado.
    // Gira 90 graus no sentido horario e tenta novamente.
    const rotatedCanvas = rotateCanvas90Clockwise(canvas);
    const rotatedImage = await canvasToBlob(rotatedCanvas);
    const rotatedText = await runOcr(rotatedImage);

    parts.push(rotatedText);

    if (findInvoiceNumber(rotatedText)) {
      return rotatedText;
    }
  }

  return parts.join("\n");
}

export async function extractInvoiceNumberLocally(
  file: File,
): Promise<InvoiceNumberExtractionResult> {
  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    try {
      const text = await extractPdfText(file);
      const number = findInvoiceNumber(text);

      if (number) {
        return {
          number,
          method: "pdf-text",
        };
      }
    } catch {
      // Continua para OCR.
    }

    try {
      const text = await extractScannedPdfWithOcr(file);

      return {
        number: findInvoiceNumber(text),
        method: "ocr",
      };
    } catch {
      return {
        number: null,
        method: null,
      };
    }
  }

  try {
    const text = await runOcr(file);

    return {
      number: findInvoiceNumber(text),
      method: "ocr",
    };
  } catch {
    return {
      number: null,
      method: null,
    };
  }
}