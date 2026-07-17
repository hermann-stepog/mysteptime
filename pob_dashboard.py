"""
POB Dashboard — People On Board
Requisitos: pip install streamlit pandas plotly openpyxl
Rodar:      streamlit run pob_dashboard.py
"""

import streamlit as st
import pandas as pd
import plotly.graph_objects as go

# ── Configuração da página ─────────────────────────────────────────────────────
st.set_page_config(
    page_title="Dashboard POB",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
    [data-testid="stMetricValue"] { font-size: 2.2rem; font-weight: 700; }
    [data-testid="stMetricLabel"] { font-size: 0.75rem; text-transform: uppercase; letter-spacing: .05em; }
    .block-container { padding-top: 1.5rem; }
    hr { margin: 1rem 0; border-color: #e2e8f0; }
</style>
""", unsafe_allow_html=True)

st.title("Dashboard POB")
st.caption("People On Board — Resumo por Unidade e Período")

# ── Carregar dados ─────────────────────────────────────────────────────────────
FILE = "pob.xlsx"

@st.cache_data
def load_data(path: str) -> pd.DataFrame:
    df = pd.read_excel(path)
    df.columns = df.columns.str.strip()

    # Detecta automaticamente as colunas (aceita variações de capitalização)
    col_map = {c.lower(): c for c in df.columns}
    rename = {}
    for alias, target in [("data", "Data"), ("unidade", "Unidade"), ("pob", "POB")]:
        if alias in col_map and col_map[alias] != target:
            rename[col_map[alias]] = target
    if rename:
        df = df.rename(columns=rename)

    df["Data"] = pd.to_datetime(df["Data"], dayfirst=True, errors="coerce")
    df = df.dropna(subset=["Data"])
    df["POB"] = pd.to_numeric(df["POB"], errors="coerce").fillna(0).astype(int)
    return df

try:
    df = load_data(FILE)
except FileNotFoundError:
    st.error(
        f"Arquivo **'{FILE}'** não encontrado.  \n"
        "Coloque o arquivo `pob.xlsx` na mesma pasta deste script e atualize a página."
    )
    st.stop()
except Exception as e:
    st.error(f"Erro ao ler o arquivo: {e}")
    st.stop()

# ── Filtros (sidebar) ──────────────────────────────────────────────────────────
with st.sidebar:
    st.header("Filtros")

    date_min = df["Data"].min().date()
    date_max = df["Data"].max().date()

    start_date = st.date_input("Data inicial", value=date_min, min_value=date_min, max_value=date_max)
    end_date   = st.date_input("Data final",   value=date_max, min_value=date_min, max_value=date_max)

    all_units = sorted(df["Unidade"].dropna().unique().tolist())
    selected_units = st.multiselect(
        "Unidade",
        options=all_units,
        default=[],
        placeholder="Todas as unidades",
    )

    st.divider()
    st.caption("Coloque **pob.xlsx** na mesma pasta do script.")

# ── Aplicar filtros ────────────────────────────────────────────────────────────
mask = (df["Data"].dt.date >= start_date) & (df["Data"].dt.date <= end_date)
filtered = df[mask].copy()

if selected_units:
    filtered = filtered[filtered["Unidade"].isin(selected_units)]

if filtered.empty:
    st.warning("Nenhum dado encontrado para os filtros selecionados.")
    st.stop()

# ── KPIs ───────────────────────────────────────────────────────────────────────
total_pob  = int(filtered["POB"].sum())
avg_pob    = round(filtered["POB"].mean(), 1)
max_pob    = int(filtered["POB"].max())
n_days     = filtered["Data"].nunique()
n_units    = filtered["Unidade"].nunique()

k1, k2, k3, k4, k5 = st.columns(5)
k1.metric("Total POB",       f"{total_pob:,}".replace(",", "."))
k2.metric("Média Diária",    f"{avg_pob:.1f}")
k3.metric("Máximo Registrado", f"{max_pob:,}".replace(",", "."))
k4.metric("Dias Analisados", n_days)
k5.metric("Unidades",        n_units)

st.divider()

# ── Gráfico 1: POB por Unidade (barra horizontal) ─────────────────────────────
by_unit = (
    filtered.groupby("Unidade")["POB"]
    .sum()
    .reset_index()
    .sort_values("POB", ascending=True)
)

fig_unit = go.Figure(go.Bar(
    x=by_unit["POB"],
    y=by_unit["Unidade"],
    orientation="h",
    marker_color="#0288d1",
    text=by_unit["POB"],
    textposition="outside",
    textfont=dict(size=13, color="#0f172a"),
    cliponaxis=False,
))

fig_unit.update_layout(
    title=dict(text="POB por Unidade", font=dict(size=15)),
    plot_bgcolor="white",
    paper_bgcolor="white",
    height=max(320, len(by_unit) * 38),
    margin=dict(l=10, r=80, t=50, b=10),
    font=dict(family="Arial", size=13),
    xaxis=dict(showgrid=True, gridcolor="#e2e8f0", zeroline=False, showticklabels=False),
    yaxis=dict(showgrid=False, automargin=True),
)

st.plotly_chart(fig_unit, use_container_width=True)

st.divider()

# ── Gráfico 2: POB por Dia (barra vertical) ───────────────────────────────────
by_day = (
    filtered.groupby("Data")["POB"]
    .sum()
    .reset_index()
    .sort_values("Data")
)
by_day["DataStr"] = by_day["Data"].dt.strftime("%d/%m")

fig_day = go.Figure(go.Bar(
    x=by_day["DataStr"],
    y=by_day["POB"],
    marker_color="#22c55e",
    text=by_day["POB"],
    textposition="outside",
    textfont=dict(size=11, color="#0f172a"),
    cliponaxis=False,
))

fig_day.update_layout(
    title=dict(text="POB por Dia", font=dict(size=15)),
    plot_bgcolor="white",
    paper_bgcolor="white",
    height=380,
    margin=dict(l=10, r=20, t=50, b=20),
    font=dict(family="Arial", size=12),
    xaxis=dict(
        showgrid=False,
        tickangle=-45 if len(by_day) > 20 else 0,
        automargin=True,
    ),
    yaxis=dict(showgrid=True, gridcolor="#e2e8f0", zeroline=False, showticklabels=False),
)

st.plotly_chart(fig_day, use_container_width=True)

# ── Tabela de dados ─────────────────────────────────────────────────────────────
with st.expander("Ver dados brutos"):
    st.dataframe(
        filtered.sort_values("Data")
        .assign(Data=lambda d: d["Data"].dt.strftime("%d/%m/%Y"))
        .reset_index(drop=True),
        use_container_width=True,
        hide_index=True,
    )
