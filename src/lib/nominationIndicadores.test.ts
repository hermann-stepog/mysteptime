import { describe, expect, it } from "vitest";
import {
  calcularTemposMedios,
  calcularTempoPorEtapa,
  contarPorUnidade,
  formatarDuracao,
  nomeacoesRetrocedidas,
  type NomeacaoIndicador,
} from "./nominationIndicadores";

const H = 3600_000;
const base = Date.parse("2026-10-01T00:00:00Z");
const iso = (ms: number) => new Date(base + ms).toISOString();

function nom(p: Partial<NomeacaoIndicador> & { id: string }): NomeacaoIndicador {
  return {
    unidade: "Bravo",
    current_status: "solicitacao",
    outcome: null,
    created_at: iso(0),
    logistics_received_at: null,
    ...p,
  };
}

describe("contarPorUnidade", () => {
  it("separa pendentes, atendidas e ignora canceladas nas duas", () => {
    const r = contarPorUnidade([
      nom({ id: "1" }),
      nom({ id: "2", current_status: "equipe_formada" }),
      nom({ id: "3", current_status: "equipe_formada", outcome: "cancelada" }),
      nom({ id: "4", unidade: "bravo " }),
    ]);
    expect(r).toEqual([{ unidade: "Bravo", solicitadas: 4, pendentes: 2, atendidas: 1 }]);
  });

  it("ordena por pendentes e mostra todas as unidades, sem Outras", () => {
    const noms = Array.from({ length: 8 }, (_, i) =>
      Array.from({ length: i + 1 }, (_, j) => nom({ id: `${i}-${j}`, unidade: `U${i}` })),
    ).flat();
    const r = contarPorUnidade(noms);
    expect(r).toHaveLength(8);
    expect(r[0].unidade).toBe("U7");
    expect(r[7]).toEqual({ unidade: "U0", solicitadas: 1, pendentes: 1, atendidas: 0 });
  });
});

describe("calcularTemposMedios", () => {
  it("usa a primeira chegada em cada etapa e ignora canceladas", () => {
    const noms = [
      nom({ id: "a", current_status: "equipe_formada" }),
      nom({ id: "b", current_status: "equipe_formada", outcome: "cancelada" }),
    ];
    const hist = [
      { nomination_id: "a", status: "recebido_logistica", changed_at: iso(2 * H) },
      { nomination_id: "a", status: "simulacao", changed_at: iso(3 * H) },
      { nomination_id: "a", status: "aprovacao_tecnica", changed_at: iso(10 * H) },
      { nomination_id: "a", status: "recebido_logistica", changed_at: iso(20 * H) },
      { nomination_id: "a", status: "equipe_formada", changed_at: iso(50 * H) },
      { nomination_id: "b", status: "recebido_logistica", changed_at: iso(100 * H) },
    ];
    const t = calcularTemposMedios(noms, hist);
    expect(t.abertura).toBe(2 * H);
    expect(t.resposta).toBe(8 * H);
    expect(t.atendimento).toBe(50 * H);
    expect(t.amostras).toEqual({ abertura: 1, resposta: 1, atendimento: 1 });
  });

  it("cai em logistics_received_at quando o histórico não tem a chegada", () => {
    const t = calcularTemposMedios(
      [nom({ id: "a", current_status: "simulacao", logistics_received_at: iso(5 * H) })],
      [],
    );
    expect(t.abertura).toBe(5 * H);
    expect(t.resposta).toBeNull();
    expect(t.atendimento).toBeNull();
  });
});

describe("formatarDuracao", () => {
  it("formata dias/horas, horas/minutos e minutos", () => {
    expect(formatarDuracao(26 * H + 30 * 60000)).toBe("1d 2h");
    expect(formatarDuracao(3 * H + 15 * 60000)).toBe("3h 15min");
    expect(formatarDuracao(40 * 60000)).toBe("40min");
    expect(formatarDuracao(null)).toBe("—");
  });
});

describe("calcularTempoPorEtapa", () => {
  it("soma as passagens por etapa e ignora a etapa que ainda está correndo", () => {
    const t = calcularTempoPorEtapa(
      [nom({ id: "a", current_status: "simulacao" })],
      [
        { nomination_id: "a", status: "solicitacao", changed_at: iso(0) },
        { nomination_id: "a", status: "recebido_logistica", changed_at: iso(2 * H) },
        { nomination_id: "a", status: "simulacao", changed_at: iso(5 * H) },
        { nomination_id: "a", status: "recebido_logistica", changed_at: iso(6 * H) },
        { nomination_id: "a", status: "simulacao", changed_at: iso(8 * H) },
      ],
    );
    const por = Object.fromEntries(t.map((e) => [e.status, e.media]));
    expect(por.solicitacao).toBe(2 * H);
    expect(por.recebido_logistica).toBe(5 * H);
    expect(por.simulacao).toBe(1 * H);
    expect(por.aprovacao_tecnica).toBeNull();
  });
});

describe("nomeacoesRetrocedidas", () => {
  const h = (id: string, status: string, hora: number) => ({
    nomination_id: id,
    status,
    changed_at: iso(hora * H),
  });

  it("marca quem voltou de etapa e desmarca quando avança de novo", () => {
    const r = nomeacoesRetrocedidas(
      [
        nom({ id: "volta", current_status: "simulacao" }),
        nom({ id: "avancou", current_status: "aprovacao_tecnica" }),
        nom({ id: "normal", current_status: "simulacao" }),
      ],
      [
        h("volta", "simulacao", 1),
        h("volta", "validacao_qualidade", 2),
        h("volta", "simulacao", 3),
        h("volta", "simulacao", 4),
        h("avancou", "aprovacao_tecnica", 1),
        h("avancou", "simulacao", 2),
        h("avancou", "aprovacao_tecnica", 3),
        h("normal", "recebido_logistica", 1),
        h("normal", "simulacao", 2),
      ],
    );
    expect(Array.from(r.entries())).toEqual([["volta", "validacao_qualidade"]]);
  });

  it("ignora canceladas e histórico que não bate com a etapa atual", () => {
    const r = nomeacoesRetrocedidas(
      [
        nom({ id: "c", current_status: "simulacao", outcome: "cancelada" }),
        nom({ id: "x", current_status: "nomeados" }),
      ],
      [
        h("c", "aprovacao_tecnica", 1),
        h("c", "simulacao", 2),
        h("x", "aprovacao_tecnica", 1),
        h("x", "simulacao", 2),
      ],
    );
    expect(r.size).toBe(0);
  });
});
