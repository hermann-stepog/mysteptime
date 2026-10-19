import type { AjustesSimulacao, EntradasSimulacao, ResultadoSimulacao } from "@/lib/costSimulator";
import { REFERENCIA_LABEL } from "@/lib/costSimulator";
import { TIPO_LABEL, formatBRL } from "@/components/costSimulator/formatacao";
import logoUrl from "@/assets/Logo - STEP.png";

// Exportação do simulador em PDF (pedido dela, 2026-10-02; reestruturado 2026-10-16 pra
// simulação parcial). Gráficos entram como imagem capturada da própria tela (html2canvas) —
// mais simples que redesenhar em vetor. jsPDF/html2canvas são carregados só quando o botão é
// clicado, pra não pesar a página.

const MARGEM = 14;
const TOPO_CONTEUDO = 50;
const DISCLAIMER =
  "Simulação baseada nos custos lançados no My Step Time. Valores estimados, sujeitos a variação.";

// jsPDF usa fonte WinAnsi, que não tem seta; troca pra texto simples.
function texto(s: string): string {
  return s.replace(/→/g, "->");
}

function dataBR(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function linhasTrajetos(lista: { origem: string; destino: string; qtd: number }[]): string {
  return (
    lista
      .filter((t) => t.origem.trim() && t.destino.trim())
      .map((t) => `${t.origem} -> ${t.destino}: ${t.qtd} viagem(ns)`)
      .join("\n") || "—"
  );
}

export function resumoEntradas(entradas: EntradasSimulacao): [string, string][] {
  return resumoEntradasBase(entradas);
}

function resumoEntradasBase(entradas: EntradasSimulacao): [string, string][] {
  if (entradas.tipo === "embarque") {
    const regimeDias =
      entradas.regime.tipo === "custom"
        ? `${entradas.regime.diasEmbarcado} dias embarcado / ${entradas.regime.diasFolga} de folga`
        : entradas.regime.tipo;
    return [
      ["Cidade de embarque", entradas.cidadeEmbarque || "—"],
      ["Regime", regimeDias],
      ["Duração", `${entradas.duracao.valor} ${entradas.duracao.unidade}`],
      ["Mob/Desmob", entradas.mobDesmob ? "Sim" : "Não"],
      [
        "Equipe",
        entradas.equipe
          .map(
            (l) => `${l.funcao || "Função"}: ${l.qtd} pessoa(s) saindo de ${l.cidadeOrigem || "—"}`,
          )
          .join("\n") || "—",
      ],
      ["Uber por trajeto", linhasTrajetos(entradas.trajetos ?? [])],
      ["Transporte executivo por trajeto", linhasTrajetos(entradas.trajetosExecutivos ?? [])],
    ];
  }
  if (entradas.tipo === "viagem_executiva") {
    return [
      [
        "Viagens",
        entradas.viagens
          .map((v, i) => {
            const partes = [`${v.qtd} pessoa(s)`];
            if (v.incluirPassagem)
              partes.push(
                `${v.origem || "—"} -> ${v.destino || "—"}${v.somenteIda ? " (só ida)" : ""}`,
              );
            if (v.incluirHospedagem) partes.push(`${v.noitesHotel} noite(s) de hotel`);
            if (v.incluirAlimentacao) partes.push("alimentação");
            if (v.incluirUber) partes.push("Uber");
            if (v.incluirTransporteExecutivo) partes.push("Transporte executivo");
            return `${v.descricao.trim() || `Viagem ${i + 1}`}: ${partes.join(", ")}`;
          })
          .join("\n") || "—",
      ],
    ];
  }
  return [
    ["Local", entradas.local || "—"],
    ["Duração", `${entradas.duracaoDias} dia(s)`],
    ["Equipe", entradas.equipe.map((l) => `${l.funcao || "Função"}: ${l.qtd}`).join("\n") || "—"],
    ["Uber por trajeto", linhasTrajetos(entradas.trajetos ?? [])],
    ["Transporte executivo por trajeto", linhasTrajetos(entradas.trajetosExecutivos ?? [])],
  ];
}

// jspdf-autotable grava a posição final da última tabela no documento, mas o tipo não expõe isso.
function fimDaUltimaTabela(doc: unknown, padrao: number): number {
  return (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? padrao;
}

async function carregarLogoDataUrl(): Promise<string | null> {
  try {
    const resposta = await fetch(logoUrl);
    const blob = await resposta.blob();
    return await new Promise<string>((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(leitor.result as string);
      leitor.onerror = () => reject(leitor.error);
      leitor.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function capturarGrafico(
  el: HTMLElement,
): Promise<{ dataUrl: string; largura: number; altura: number }> {
  const html2canvas = (await import("html2canvas")).default;
  const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2 });
  return { dataUrl: canvas.toDataURL("image/png"), largura: canvas.width, altura: canvas.height };
}

export async function exportarSimulacaoPdf({
  nomeCenario,
  entradas,
  ajustes,
  resultado,
  geradoPor,
  graficos,
}: {
  nomeCenario: string;
  entradas: EntradasSimulacao;
  ajustes: AjustesSimulacao;
  resultado: ResultadoSimulacao;
  geradoPor: string | null;
  graficos: HTMLElement[];
}): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const larguraPagina = doc.internal.pageSize.getWidth();
  const alturaPagina = doc.internal.pageSize.getHeight();
  const larguraUtil = larguraPagina - MARGEM * 2;

  const logo = await carregarLogoDataUrl();
  const geradoEm = new Date().toLocaleString("pt-BR");

  const cabecalhoTabela = {
    margin: { top: TOPO_CONTEUDO, bottom: 20, left: MARGEM, right: MARGEM },
    theme: "grid" as const,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59] as [number, number, number] },
  };

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(texto(nomeCenario || "Simulação de custos"), MARGEM, TOPO_CONTEUDO - 12);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Tipo: ${TIPO_LABEL[entradas.tipo]}`, MARGEM, TOPO_CONTEUDO - 7);

  const periodoTexto =
    ajustes.periodoReferencia.tipo === "todo"
      ? "Todo o histórico"
      : `Últimos ${ajustes.periodoReferencia.tipo} meses (${dataBR(ajustes.periodoReferencia.inicio)} a ${dataBR(ajustes.periodoReferencia.fim)})`;

  autoTable(doc, {
    ...cabecalhoTabela,
    startY: TOPO_CONTEUDO,
    head: [["Dados da simulação", ""]],
    body: [
      ["Cliente", entradas.cliente || "—"],
      ["Unidade", entradas.unidade || "—"],
      ["BSP", entradas.bsp || "—"],
      ["Período de referência", periodoTexto],
      ["Valor de referência", REFERENCIA_LABEL[ajustes.referencia]],
      ...resumoEntradas(entradas),
      ["Categorias incluídas", resultado.categoriasIncluidas.join(", ") || "—"],
      [
        "Categorias pendentes",
        resultado.categoriasPendentes
          .map((p) => `${p.categoria} (falta: ${p.motivo})`)
          .join("; ") || "—",
      ],
      ["Gerado em", geradoEm],
      ["Gerado por", geradoPor || "—"],
    ].map(([k, v]) => [texto(k), texto(v)]),
    columnStyles: { 0: { cellWidth: 45, fontStyle: "bold" } },
  });

  const kpis = [
    ["Total", formatBRL(resultado.total)],
    ["Por pessoa", formatBRL(resultado.porPessoa)],
    ["Pessoas", String(resultado.totalPessoas)],
  ];
  autoTable(doc, {
    ...cabecalhoTabela,
    startY: fimDaUltimaTabela(doc, TOPO_CONTEUDO) + 6,
    head: [kpis.map(([k]) => k)],
    body: [kpis.map(([, v]) => v)],
    styles: { fontSize: 10, cellPadding: 3, halign: "center" },
    headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105] },
    bodyStyles: { fontStyle: "bold" },
  });

  const porPessoaDe = (valor: number) =>
    resultado.totalPessoas > 0 ? formatBRL(valor / resultado.totalPessoas) : "—";

  const linhasCategoria = resultado.porCategoria.map((c) => [
    texto(c.categoria),
    texto(c.base ?? ""),
    formatBRL(c.unitario),
    String(c.qtd),
    formatBRL(c.subtotal),
    porPessoaDe(c.subtotal),
    `${c.percentualDoTotal.toFixed(1)}%`,
  ]);
  const rodapeValores: [string, number][] = [
    ["Subtotal", resultado.subtotal],
    ...(resultado.reajusteValor !== 0
      ? [["Reajuste", resultado.reajusteValor] as [string, number]]
      : []),
    ...(resultado.contingenciaValor !== 0
      ? [["Contingência", resultado.contingenciaValor] as [string, number]]
      : []),
    ...(resultado.markupValor !== 0 ? [["Markup", resultado.markupValor] as [string, number]] : []),
    ["Total", resultado.total],
  ];
  autoTable(doc, {
    ...cabecalhoTabela,
    startY: fimDaUltimaTabela(doc, TOPO_CONTEUDO) + 6,
    head: [
      ["Categoria", "Base do cálculo", "Unitário", "Qtd", "Subtotal", "Por pessoa", "% do total"],
    ],
    body:
      linhasCategoria.length > 0
        ? linhasCategoria
        : [["Nenhum custo histórico encontrado pros filtros informados.", "", "", "", "", "", ""]],
    foot: rodapeValores.map(([k, v]) => [k, "", "", "", formatBRL(v), porPessoaDe(v), ""]),
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
  });

  let y = fimDaUltimaTabela(doc, TOPO_CONTEUDO) + 8;
  for (const el of graficos) {
    const { dataUrl, largura, altura } = await capturarGrafico(el);
    const altImg = (larguraUtil * altura) / largura;
    if (y + altImg > alturaPagina - 20) {
      doc.addPage();
      y = TOPO_CONTEUDO;
    }
    doc.addImage(dataUrl, "PNG", MARGEM, y, larguraUtil, altImg);
    y += altImg + 8;
  }

  // Cabeçalho (logo + banner) e rodapé repetidos em toda página — feito por último, quando já
  // se sabe o nº total de páginas.
  const totalPaginas = doc.getNumberOfPages();
  for (let p = 1; p <= totalPaginas; p++) {
    doc.setPage(p);
    if (logo) doc.addImage(logo, "PNG", MARGEM, 8, 34, 11);
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text("Simulador de Custos Logísticos", larguraPagina - MARGEM, 14, { align: "right" });
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(252, 211, 77);
    doc.roundedRect(MARGEM, 22, larguraUtil, 9, 1.5, 1.5, "FD");
    doc.setTextColor(120, 53, 15);
    doc.text(DISCLAIMER, MARGEM + 3, 27.8);
    doc.setTextColor(120);
    doc.text(`Página ${p} de ${totalPaginas}`, larguraPagina - MARGEM, alturaPagina - 8, {
      align: "right",
    });
    doc.text(`Gerado em ${geradoEm}`, MARGEM, alturaPagina - 8);
    doc.setTextColor(0);
  }

  const nomeArquivo = `${(nomeCenario || "simulacao").replace(/[^\p{L}\p{N}]+/gu, "_")}.pdf`;
  doc.save(nomeArquivo);
}
