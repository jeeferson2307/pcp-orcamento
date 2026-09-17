const GROUP_LABELS = {
  diretoria: 'Diretoria', site: 'Site / Filial', cliente: 'Cliente',
  operacao: 'Operação', referencia: 'Mês', desc_centro_custo: 'Descrição Centro de Custo',
};
const DRILL_LABELS = { none: 'Nenhum', ...GROUP_LABELS };
const GROUP_OPTIONS_HTML = Object.entries(GROUP_LABELS)
  .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  .map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
const DRILL_OPTIONS_HTML = `<option value="none">Nenhum</option>` + GROUP_OPTIONS_HTML;

// Intervalo dinâmico (não depende da data do sistema): do ano mínimo
// cadastrado em Cadastro Dimensionamento até um ano além do máximo cadastrado
// (o "próximo ano" a orçar) — vem pronto em meta.anoMinDimens/anoMaxDimens
// (Store.getMeta). Sem `selected` válido no intervalo, seleciona o "próximo
// ano" (o mais recente das opções), o mais relevante para orçamento.
function yearOptions(meta, selected) {
  const min = meta?.anoMinDimens ?? new Date().getFullYear();
  const max = (meta?.anoMaxDimens ?? new Date().getFullYear()) + 1;
  const sel = (selected != null && selected >= min && selected <= max) ? selected : max;
  const opts = [];
  for (let a = min; a <= max; a++) opts.push(a);
  return opts.map(a => `<option ${a === sel ? 'selected' : ''}>${a}</option>`).join('');
}

function groupRowCells(g) {
  return `
    <td>${Fmt.display(g.receita_bruta,'currency')}</td>
    <td>${Fmt.display(g.hc_dim,'number')}</td>
    <td>${Fmt.display(g.fte_financeiro,'number')}</td>
    <td>${Fmt.display(g.rob_financeiro,'currency')}</td>
    <td>${Fmt.display(g.absenteismo,'percent')}</td>
    <td>${Fmt.display(g.turnover,'percent')}</td>
    <td>${Fmt.display(g.ferias,'percent')}</td>
    <td>${Fmt.display(g.folga_extra,'percent')}</td>
  `;
}

// Peso de cada mês do ano para a "Média/Mês" ponderada dos cards de KPI —
// usa a mesma base de Faturamento 5x2 (= dias úteis) da guia Calendário.
// Só um peso genérico por mês (não por operação/Tipo Escala) porque o card
// agrega várias operações de uma vez; é uma aproximação razoável para não
// tratar todo mês como igual (fev pesa menos que um mês de 22 dias úteis).
function pesosDiasFaturamentoPorMes(ano) {
  const cal = fnCalendarioMensal(ano);
  const pesos = new Map();
  for (const [mes, b] of cal) pesos.set(mes, b.faturamento5x2);
  return pesos;
}

// Média ponderada (por dias de faturamento do mês), máximo e mínimo de um
// campo de `porMes` — usado nos cards de Receita Bruta/HC Dimensionado/FTE
// Financeiro do Painel Gerencial.
function monthlyStats(porMes, key, pesos) {
  if (!porMes.length) return { media: 0, max: 0, min: 0 };
  let num = 0, den = 0;
  const vals = porMes.map(m => m[key] || 0);
  for (const m of porMes) {
    const peso = pesos.get(m.mes) ?? 1;
    num += (m[key] || 0) * peso;
    den += peso;
  }
  return { media: den > 0 ? num / den : 0, max: Math.max(...vals), min: Math.min(...vals) };
}

function kpiSubStats(stats, format) {
  return `
    <div class="kpi-sub">
      <div class="kpi-sub-row"><span>Média/Mês</span><span>${Fmt.display(stats.media, format)}</span></div>
      <div class="kpi-sub-row"><span>Máximo</span><span>${Fmt.display(stats.max, format)}</span></div>
      <div class="kpi-sub-row"><span>Mínimo</span><span>${Fmt.display(stats.min, format)}</span></div>
    </div>
  `;
}

// Repopula um <select> de filtro preservando a seleção atual quando ela
// ainda é válida no novo conjunto de opções (filtros "relativos": mudar um
// nível recalcula o que os demais podem oferecer). Retorna true se a seleção
// precisou ser descartada (não existe mais na lista) — quem chama deve então
// recarregar os dados com o filtro resetado para "Todos".
function repopulateFilterSelect(selectEl, options, allLabel) {
  const current = selectEl.value;
  const stillValid = !current || options.includes(current);
  selectEl.innerHTML = `<option value="">${allLabel}</option>` +
    options.map(o => `<option value="${escapeHtml(o)}" ${o === current ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
  if (!stillValid) selectEl.value = '';
  return !stillValid;
}

// ---------------------------------------------------------------
// Gráfico de linhas mensal (sem dependências externas) — usado pelas visões
// Headcount / Volume (Chamadas) / TMA / Receita Bruta / Absenteísmo /
// Turnover / Férias / Folga x mês do Painel Gerencial.
// ---------------------------------------------------------------
function niceCeil(n) {
  if (!(n > 0)) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const f = n / base;
  const niceF = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return niceF * base;
}

// Rótulo de eixo/dado "dinâmico": abrevia valores grandes de moeda/número
// (mil/mi) em vez de imprimir o número cheio, para caber no eixo e nos
// rótulos de dado sem depender do tamanho absoluto dos valores do período.
// Percentual e decimal já são compactos por natureza — mantém Fmt.display.
function formatAxisValue(v, format) {
  if (format === 'percent' || format === 'decimal1') return Fmt.display(v, format);
  const prefix = format === 'currency' ? 'R$ ' : '';
  const abs = Math.abs(v);
  if (abs >= 1e6) return prefix + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (abs >= 1e3) return prefix + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return prefix + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function renderLineChart(container, { title, color, data, valueLabel, format }) {
  const W = 640, H = 280;
  const padL = 60, padR = 16, padT = 28, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = niceCeil(Math.max(1, ...data.map(d => d.valor)));
  const n = data.length || 1;
  const slot = plotW / n;

  const yOf = (v) => padT + plotH * (1 - v / maxVal);
  const xOf = (i) => padL + i * slot + slot / 2;
  const ticks = [0, maxVal / 2, maxVal];

  const gridlines = ticks.map(t => `<line x1="${padL}" y1="${yOf(t).toFixed(1)}" x2="${W - padR}" y2="${yOf(t).toFixed(1)}" class="chart-gridline" />`).join('');
  const yLabels = ticks.map(t => `<text x="${padL - 8}" y="${(yOf(t) + 3).toFixed(1)}" class="chart-axis-label" text-anchor="end">${formatAxisValue(t, format)}</text>`).join('');

  const points = data.map((d, i) => ({ x: xOf(i), y: yOf(d.valor), d }));
  const linePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const dots = points.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${color}" data-mes="${p.d.mes}" data-valor="${p.d.valor}" class="chart-dot"></circle>`).join('');

  const dataLabels = points.map(p => `<text x="${p.x.toFixed(1)}" y="${Math.max(11, p.y - 10).toFixed(1)}" text-anchor="middle" class="chart-data-label">${formatAxisValue(p.d.valor, format)}</text>`).join('');

  const xLabels = data.map((d, i) => {
    const x = xOf(i);
    return `<text x="${x.toFixed(1)}" y="${H - padB + 18}" class="chart-axis-label" text-anchor="middle">${Fmt.mes(d.mes)}</text>`;
  }).join('');

  container.innerHTML = `
    <div class="chart-title">${escapeHtml(title)}</div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">
        ${gridlines}
        <line x1="${padL}" y1="${(padT + plotH).toFixed(1)}" x2="${W - padR}" y2="${(padT + plotH).toFixed(1)}" class="chart-baseline" />
        ${yLabels}
        <polyline points="${linePoints}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" class="chart-line"></polyline>
        ${dots}
        ${dataLabels}
        ${xLabels}
      </svg>
      <div class="chart-tooltip" style="display:none"></div>
    </div>
  `;

  const tooltip = container.querySelector('.chart-tooltip');
  const wrap = container.querySelector('.chart-wrap');
  container.querySelectorAll('circle[data-mes]').forEach(el => {
    el.addEventListener('mouseenter', () => { tooltip.style.display = 'block'; });
    el.addEventListener('mousemove', (e) => {
      const rect = wrap.getBoundingClientRect();
      tooltip.textContent = `${Fmt.mes(el.dataset.mes)} · ${valueLabel(Number(el.dataset.valor))}`;
      tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
      tooltip.style.top = (e.clientY - rect.top - 28) + 'px';
    });
    el.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
  });
}

// Últimos filtros aplicados no Painel Gerencial — em memória, no nível do
// módulo (não dentro de renderDashboardPage), para sobreviver a navegar para
// outra página e voltar. Atualizado a cada load() bem-sucedido.
const dashboardFilterState = {
  ano: null, groupBy: 'diretoria', drillBy: 'none', responsavel: '', gerente: '', operacao: '',
};

async function renderDashboardPage(container, meta) {
  const expanded = new Set();
  const fs = dashboardFilterState;

  container.innerHTML = `
    <div class="toolbar">
      <label>Agrupar por <select id="d-group">${GROUP_OPTIONS_HTML}</select></label>
      <label>Drill <select id="d-drill">${DRILL_OPTIONS_HTML}</select></label>
    </div>
    <div class="toolbar">
      <label>Ano <select id="d-ano">${yearOptions(meta, fs.ano)}</select></label>
      <label>Responsável PCP <select id="d-resp"><option value="">Todos</option>${(meta.responsaveis||[]).map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></label>
      <label>Gerente <select id="d-gerente"><option value="">Todos</option>${(meta.gerentes||[]).map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></label>
      <label>Operação <select id="d-operacao"><option value="">Todas</option>${(meta.operacoes||[]).map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></label>
    </div>
    <div id="kpis" class="kpi-row"></div>
    <div id="kpis2" class="kpi-row"></div>

    <div class="section-title">Resumo por <span id="group-label"></span> <span class="small" id="drill-hint"></span></div>
    <div class="panel"><table class="grid" id="tbl-dash"></table></div>

    <div class="section-title">Headcount, Volume, TMA e Receita Bruta por mês</div>
    <div class="chart-grid">
      <div class="panel chart-card" id="chart-hc"></div>
      <div class="panel chart-card" id="chart-volume"></div>
      <div class="panel chart-card" id="chart-tma"></div>
      <div class="panel chart-card" id="chart-receita"></div>
    </div>

    <div class="section-title">Absenteísmo, Turnover, Férias e Folga por mês</div>
    <div class="chart-grid">
      <div class="panel chart-card" id="chart-absenteismo"></div>
      <div class="panel chart-card" id="chart-turnover"></div>
      <div class="panel chart-card" id="chart-ferias"></div>
      <div class="panel chart-card" id="chart-folga"></div>
    </div>

    <button class="primary" id="btn-export-analitico">${Icon('table')} Export</button>
  `;
  applyIcons(container);

  // Restaura os últimos filtros aplicados (Agrupar por/Drill/Responsável/
  // Gerente/Operação) antes do primeiro load() — o Ano já vem selecionado
  // via yearOptions(meta, fs.ano) acima. Se a operação/responsável/gerente
  // persistido não existir mais entre as opções atuais, o <select> ignora o
  // value inválido e volta para "Todos" sozinho.
  document.getElementById('d-group').value = fs.groupBy;
  document.getElementById('d-drill').value = fs.drillBy;
  document.getElementById('d-resp').value = fs.responsavel;
  document.getElementById('d-gerente').value = fs.gerente;
  document.getElementById('d-operacao').value = fs.operacao;

  container.querySelector('#btn-export-analitico').onclick = () => { location.hash = 'dashboard:analitico'; };

  let data = null;

  // true enquanto repopulamos os selects de filtro por código, para não
  // disparar um load() recursivo a partir do próprio evento "change" deles.
  let syncingFilters = false;

  async function load() {
    const ano = document.getElementById('d-ano').value;
    const groupBy = document.getElementById('d-group').value;
    const drillBy = document.getElementById('d-drill').value;
    const responsavel = document.getElementById('d-resp').value;
    const gerente = document.getElementById('d-gerente').value;
    const operacao = document.getElementById('d-operacao').value;
    Object.assign(fs, { ano: Number(ano), groupBy, drillBy, responsavel, gerente, operacao });
    data = await Api.get(`/api/dashboard?ano=${ano}&groupBy=${groupBy}&drillBy=${drillBy}&responsavel=${encodeURIComponent(responsavel)}&gerente=${encodeURIComponent(gerente)}&operacao=${encodeURIComponent(operacao)}`);
    expanded.clear();
    if (data.drillBy !== 'none') data.grupos.forEach(g => expanded.add(g.chave)); // drill inicia sempre aberto
    drawKpis();
    drawGroupTable();
    drawCharts();

    // Filtros relativos: cada combo só oferece valores compatíveis com o que
    // já está selecionado nos outros dois. Se a seleção atual não existe mais
    // no novo conjunto (ficou incompatível), ela é descartada e recarregamos.
    syncingFilters = true;
    const fo = data.filterOptions || { responsaveis: [], gerentes: [], operacoes: [] };
    const respReset = repopulateFilterSelect(document.getElementById('d-resp'), fo.responsaveis, 'Todos');
    const gerReset = repopulateFilterSelect(document.getElementById('d-gerente'), fo.gerentes, 'Todos');
    const opReset = repopulateFilterSelect(document.getElementById('d-operacao'), fo.operacoes, 'Todas');
    syncingFilters = false;
    if (respReset || gerReset || opReset) await load();
  }

  function drawKpis() {
    const t = data.totals;
    const ano = parseInt(document.getElementById('d-ano').value, 10);
    const pesos = pesosDiasFaturamentoPorMes(ano);
    const receitaStats = monthlyStats(data.porMes, 'receita', pesos);
    const hcStats = monthlyStats(data.porMes, 'hc', pesos);
    const fteStats = monthlyStats(data.porMes, 'fte', pesos);
    const robStats = monthlyStats(data.porMes, 'rob', pesos);
    document.getElementById('kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Receita Bruta (total)</div><div class="kpi-value">${Fmt.display(t.receita_bruta,'currency')}</div>${kpiSubStats(receitaStats,'currency')}</div>
      <div class="kpi-card"><div class="kpi-label">HC Dimensionado (total)</div><div class="kpi-value">${Fmt.display(t.hc_dim,'integer')}</div>${kpiSubStats(hcStats,'integer')}</div>
      <div class="kpi-card"><div class="kpi-label">FTE Financeiro (total)</div><div class="kpi-value">${Fmt.display(t.fte_financeiro,'integer')}</div>${kpiSubStats(fteStats,'integer')}</div>
      <div class="kpi-card"><div class="kpi-label">ROB/Financeiro</div><div class="kpi-value">${Fmt.display(t.rob_financeiro,'currency')}</div>${kpiSubStats(robStats,'currency')}</div>
    `;
    document.getElementById('kpis2').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Absenteísmo (méd. pond. HC)</div><div class="kpi-value">${Fmt.display(t.absenteismo,'percent')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Turnover (méd. pond. HC)</div><div class="kpi-value">${Fmt.display(t.turnover,'percent')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Férias (méd. pond. HC)</div><div class="kpi-value">${Fmt.display(t.ferias,'percent')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Folga Adicional (méd. pond. HC)</div><div class="kpi-value">${Fmt.display(t.folga_extra,'percent')}</div></div>
    `;
  }

  function drawCharts() {
    const porMes = data.porMes || [];
    renderLineChart(document.getElementById('chart-hc'), {
      title: 'Headcount x Mês', color: 'var(--chart-1)', format: 'number',
      data: porMes.map(m => ({ mes: m.mes, valor: m.hc })),
      valueLabel: v => Fmt.display(v, 'number'),
    });
    renderLineChart(document.getElementById('chart-volume'), {
      title: 'Volume (Chamadas) x Mês', color: 'var(--chart-2)', format: 'number',
      data: porMes.map(m => ({ mes: m.mes, valor: m.volume })),
      valueLabel: v => Fmt.display(v, 'number'),
    });
    renderLineChart(document.getElementById('chart-tma'), {
      title: 'TMA Médio (seg) x Mês', color: 'var(--chart-3)', format: 'decimal1',
      data: porMes.map(m => ({ mes: m.mes, valor: m.tma })),
      valueLabel: v => Fmt.display(v, 'decimal1'),
    });
    renderLineChart(document.getElementById('chart-receita'), {
      title: 'Receita Bruta x Mês', color: 'var(--chart-4)', format: 'currency',
      data: porMes.map(m => ({ mes: m.mes, valor: m.receita })),
      valueLabel: v => Fmt.display(v, 'currency'),
    });
    renderLineChart(document.getElementById('chart-absenteismo'), {
      title: 'Absenteísmo x Mês', color: 'var(--chart-5)', format: 'percent',
      data: porMes.map(m => ({ mes: m.mes, valor: m.absenteismo })),
      valueLabel: v => Fmt.display(v, 'percent'),
    });
    renderLineChart(document.getElementById('chart-turnover'), {
      title: 'Turnover x Mês', color: 'var(--chart-6)', format: 'percent',
      data: porMes.map(m => ({ mes: m.mes, valor: m.turnover })),
      valueLabel: v => Fmt.display(v, 'percent'),
    });
    renderLineChart(document.getElementById('chart-ferias'), {
      title: 'Férias x Mês', color: 'var(--chart-7)', format: 'percent',
      data: porMes.map(m => ({ mes: m.mes, valor: m.ferias })),
      valueLabel: v => Fmt.display(v, 'percent'),
    });
    renderLineChart(document.getElementById('chart-folga'), {
      title: 'Folga Adicional x Mês', color: 'var(--chart-8)', format: 'percent',
      data: porMes.map(m => ({ mes: m.mes, valor: m.folga_extra })),
      valueLabel: v => Fmt.display(v, 'percent'),
    });
  }

  function drawGroupTable() {
    const label = GROUP_LABELS[data.groupBy] || data.groupBy;
    document.getElementById('group-label').textContent = label;
    document.getElementById('drill-hint').textContent = data.drillBy !== 'none'
      ? `(clique numa linha para recolher o detalhamento por ${DRILL_LABELS[data.drillBy]})` : '';
    const tbl = document.getElementById('tbl-dash');
    tbl.innerHTML = `<thead><tr><th>${label}</th><th>Receita Bruta (R$)</th><th>HC Dim</th><th>FTE Financeiro</th><th>ROB/Financeiro (R$)</th><th>ABS (%)</th><th>TO (%)</th><th>Férias (%)</th><th>Folga Adic. (%)</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    const hasDrill = data.drillBy !== 'none';
    for (const g of data.grupos) {
      const tr = document.createElement('tr');
      tr.className = 'drill-row';
      const toggle = hasDrill ? `<button class="drill-toggle">${Icon(expanded.has(g.chave) ? 'chevron-down' : 'chevron-right')}</button> ` : '';
      tr.innerHTML = `<td>${toggle}${escapeHtml(g.chave)}</td>${groupRowCells(g)}`;
      if (hasDrill) {
        tr.querySelector('.drill-toggle').onclick = () => {
          if (expanded.has(g.chave)) expanded.delete(g.chave); else expanded.add(g.chave);
          drawGroupTable();
        };
      }
      tbody.appendChild(tr);
      if (hasDrill && expanded.has(g.chave)) {
        for (const sub of g.drill) {
          const subTr = document.createElement('tr');
          subTr.className = 'sub-row';
          subTr.innerHTML = `<td class="indent">${escapeHtml(sub.chave)}</td>${groupRowCells(sub)}`;
          tbody.appendChild(subTr);
        }
      }
    }
    tbl.appendChild(tbody);
  }

  document.getElementById('d-ano').onchange = load;
  document.getElementById('d-group').onchange = load;
  document.getElementById('d-drill').onchange = load;
  document.getElementById('d-resp').onchange = () => { if (!syncingFilters) load(); };
  document.getElementById('d-gerente').onchange = () => { if (!syncingFilters) load(); };
  document.getElementById('d-operacao').onchange = () => { if (!syncingFilters) load(); };

  await load();
}

// ---------------------------------------------------------------
// Analítico — visão completa, linha a linha, de tudo que entra no cálculo de
// dimensionamento e receita (TB_PROJECAO_FORECAST_FINAL), com os mesmos
// filtros do Painel Gerencial (Ano/Responsável PCP/Gerente/Operação) e
// exportação para CSV/XLSX.
// ---------------------------------------------------------------
const ANALITICO_COLUMNS = [
  { key: 'referencia', label: 'Mês', format: 'mes' },
  { key: '_tipo_linha', label: 'Tipo Linha', format: 'text' },
  { key: 'diretoria', label: 'Diretoria', format: 'text' },
  { key: 'gerente', label: 'Gerente', format: 'text' },
  { key: 'responsavel_pcp', label: 'Responsável PCP', format: 'text' },
  { key: 'responsavel_fpa', label: 'Responsável FP&A', format: 'text' },
  { key: 'un_dre', label: 'UN DRE', format: 'text' },
  { key: 'cliente', label: 'Cliente', format: 'text' },
  { key: 'operacao', label: 'Operação', format: 'text' },
  { key: 'site', label: 'Site / Filial', format: 'text' },
  { key: 'cod_empresa', label: 'Cód. Empresa', format: 'text' },
  { key: 'cod_filial', label: 'Cód. Filial', format: 'text' },
  { key: 'cod_cc', label: 'Cód. Centro de Custo', format: 'text' },
  { key: 'desc_centro_custo', label: 'Descrição Centro de Custo', format: 'text' },
  { key: 'faturamento', label: 'Tipo Faturamento', format: 'text' },
  { key: '_tipo_dimens', label: 'Tipo Dimensionamento', format: 'text' },
  { key: '_volume_revisado', label: 'Volume Revisado', format: 'number' },
  { key: '_tma', label: 'TMA (seg)', format: 'decimal1' },
  { key: 'posicao_contratada', label: 'HC Contratado', format: 'number' },
  { key: '_hc_revisado', label: 'HC Revisado', format: 'number' },
  { key: 'hc_dim', label: 'HC Dimensionado', format: 'number' },
  { key: 'hc_dim_jovem', label: 'HC Dim. + Jovem Aprendiz', format: 'number' },
  { key: 'hc_custo_jovem', label: 'Qtd. Jovem Aprendiz', format: 'number' },
  { key: 'hc_treinamento', label: 'HC Treinamento (Contratações)', format: 'number' },
  { key: 'spam_supervisao', label: 'Spam Supervisão', format: 'number' },
  { key: 'supervisor', label: 'Supervisores', format: 'number' },
  { key: 'fte_financeiro', label: 'FTE Financeiro', format: 'number' },
  { key: 'pa_hc_infra', label: 'PA HC Infra', format: 'number' },
  { key: 'taxa_ocup_pa_infra', label: 'Taxa Ocupação PA Infra', format: 'percent' },
  { key: 'ocupacao_garantia', label: 'Ocupação Garantia', format: 'percent' },
  { key: 'pct_escala_fer_nac', label: '% Escala Feriado Nacional', format: 'percent' },
  { key: 'pct_escala_local', label: '% Escala Feriado Local', format: 'percent' },
  { key: 'absenteismo', label: 'Absenteísmo', format: 'percent' },
  { key: 'turnover', label: 'Turnover', format: 'percent' },
  { key: 'ferias', label: 'Férias', format: 'percent' },
  { key: 'folga_extra', label: 'Folga Adicional', format: 'percent' },
  { key: 'total_tfl', label: 'Total TFL', format: 'percent' },
  { key: 'evasao', label: 'Evasão', format: 'percent' },
  { key: 'cprb_aplicado', label: 'CPRB Aplicado', format: 'text' },
  { key: 'cprb_pct', label: 'CPRB %', format: 'percent' },
  { key: 'reajuste_aplicado', label: 'Reajuste Aplicado', format: 'text' },
  { key: 'reajuste_pct', label: 'Reajuste %', format: 'percent' },
  { key: 'receita_bruta', label: 'Receita Bruta', format: 'currency' },
];

function analiticoRowToDisplay(r) {
  return ANALITICO_COLUMNS.map(c => c.format === 'mes' ? Fmt.mes(r[c.key]) : Fmt.display(r[c.key], c.format));
}

async function renderAnaliticoPage(container, meta) {
  container.innerHTML = `
    <div class="toolbar">
      <label>Ano <select id="a-ano">${yearOptions(meta)}</select></label>
      <label>Responsável PCP <select id="a-resp"><option value="">Todos</option>${(meta.responsaveis||[]).map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></label>
      <label>Gerente <select id="a-gerente"><option value="">Todos</option>${(meta.gerentes||[]).map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></label>
      <label>Operação <select id="a-operacao"><option value="">Todas</option>${(meta.operacoes||[]).map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></label>
    </div>
    <div class="toolbar">
      <input type="text" id="a-busca" class="op-search" placeholder="Buscar em qualquer coluna…">
      <span class="small" id="a-count"></span>
      <button id="btn-export-csv">${Icon('download')} Exportar CSV</button>
      <button id="btn-export-xlsx">${Icon('download')} Exportar XLSX</button>
    </div>
    <div class="panel"><table class="grid" id="tbl-analitico"></table></div>
  `;
  applyIcons(container);

  let rows = [];
  let filtered = [];

  function draw() {
    const busca = document.getElementById('a-busca').value.trim().toLowerCase();
    filtered = !busca ? rows : rows.filter(r =>
      ANALITICO_COLUMNS.some(c => String(r[c.key] ?? '').toLowerCase().includes(busca)));
    document.getElementById('a-count').textContent = `${filtered.length} linha(s)`;

    const tbl = document.getElementById('tbl-analitico');
    tbl.innerHTML = `<thead><tr>${ANALITICO_COLUMNS.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`;
    const tbody = document.createElement('tbody');
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${ANALITICO_COLUMNS.length}"><div class="empty-state">Nenhuma linha encontrada.</div></td></tr>`;
    }
    for (const r of filtered) {
      const tr = document.createElement('tr');
      tr.innerHTML = analiticoRowToDisplay(r).map(v => `<td>${escapeHtml(v)}</td>`).join('');
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
  }

  async function load() {
    const ano = document.getElementById('a-ano').value;
    const responsavel = document.getElementById('a-resp').value;
    const gerente = document.getElementById('a-gerente').value;
    const operacao = document.getElementById('a-operacao').value;
    const resp = await Api.get(`/api/resultado?ano=${ano}&responsavel=${encodeURIComponent(responsavel)}&gerente=${encodeURIComponent(gerente)}&operacao=${encodeURIComponent(operacao)}`);
    rows = resp.rows;
    draw();
  }

  function exportar(formato) {
    const aaData = [ANALITICO_COLUMNS.map(c => c.label), ...filtered.map(analiticoRowToDisplay)];
    const ano = document.getElementById('a-ano').value;
    if (formato === 'csv') ExportUtil.downloadCsv(`analitico_${ano}.csv`, aaData);
    else ExportUtil.downloadXlsx(`analitico_${ano}.xlsx`, aaData, 'Analítico');
  }

  document.getElementById('a-ano').onchange = load;
  document.getElementById('a-resp').onchange = load;
  document.getElementById('a-gerente').onchange = load;
  document.getElementById('a-operacao').onchange = load;
  document.getElementById('a-busca').oninput = draw;
  document.getElementById('btn-export-csv').onclick = () => exportar('csv');
  document.getElementById('btn-export-xlsx').onclick = () => exportar('xlsx');

  await load();
}

// ---------------------------------------------------------------
// Calendário — exibe a tabela mensal calculada por fnCalendarioMensal
// (calendario.js): dias úteis, sábados, domingos, feriados nacionais e as
// duas bases de faturamento (5x2 e 6x1) por mês, usadas pelo cálculo de
// projeção de Volume em calc.js/buildForecast de acordo com o Tipo Escala
// cadastrado em Cadastro Operações.
// ---------------------------------------------------------------
async function renderCalendarioPage(container, meta) {
  const pesoAtual = await Api.get('/api/parametro/peso_feriado_nacional?default=0.5');
  let pesoFeriadoNacional = pesoAtual.valor ?? 0.5;

  container.innerHTML = `
    <div class="toolbar">
      <label>Ano <select id="cal-ano">${yearOptions(meta)}</select></label>
      <label>Peso Feriado Nacional <input class="field-input" type="text" id="cal-peso" style="max-width:100px" value="${Fmt.toEdit(pesoFeriadoNacional,'percent')}"></label>
      <span class="small">usado no cálculo de Faturamento 6x1: dias úteis + ((sábado+domingo+feriados) × peso)</span>
    </div>
    <div class="panel"><table class="grid" id="tbl-calendario"></table></div>
  `;

  function draw() {
    const ano = parseInt(document.getElementById('cal-ano').value, 10);
    const meses = fnCalendarioMensal(ano, pesoFeriadoNacional);
    const linhas = [...meses.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

    const totais = { diaUtil: 0, sabado: 0, domingo: 0, feriados: 0, faturamento5x2: 0, faturamento6x1: 0 };
    for (const [, b] of linhas) {
      totais.diaUtil += b.diaUtil;
      totais.sabado += b.sabado;
      totais.domingo += b.domingo;
      totais.feriados += b.feriados;
      totais.faturamento5x2 += b.faturamento5x2;
      totais.faturamento6x1 += b.faturamento6x1;
    }

    const tbl = document.getElementById('tbl-calendario');
    tbl.innerHTML = `<thead><tr><th>Mês</th><th>Dia Útil</th><th>Sábado</th><th>Domingo</th><th>Feriados</th><th>Faturamento 5x2</th><th>Faturamento 6x1</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const [mes, b] of linhas) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="id-col">${Fmt.mes(mes)}</td><td>${b.diaUtil}</td><td>${b.sabado}</td><td>${b.domingo}</td><td>${b.feriados}</td><td>${Fmt.display(b.faturamento5x2,'decimal1')}</td><td>${Fmt.display(b.faturamento6x1,'decimal1')}</td>`;
      tbody.appendChild(tr);
    }
    const trTotal = document.createElement('tr');
    trTotal.innerHTML = `<td class="total-ok">Total ${ano}</td><td class="total-ok">${totais.diaUtil}</td><td class="total-ok">${totais.sabado}</td><td class="total-ok">${totais.domingo}</td><td class="total-ok">${totais.feriados}</td><td class="total-ok">${Fmt.display(totais.faturamento5x2,'decimal1')}</td><td class="total-ok">${Fmt.display(totais.faturamento6x1,'decimal1')}</td>`;
    tbody.appendChild(trTotal);
    tbl.appendChild(tbody);
  }

  document.getElementById('cal-ano').onchange = draw;
  document.getElementById('cal-peso').onchange = async (e) => {
    const novo = Fmt.fromEdit(e.target.value, 'percent');
    if (novo == null) { toast('Informe um peso válido.', true); e.target.value = Fmt.toEdit(pesoFeriadoNacional, 'percent'); return; }
    pesoFeriadoNacional = novo;
    await Api.put('/api/parametro/peso_feriado_nacional', { valor: novo });
    toast('Peso Feriado Nacional atualizado.');
    draw();
  };
  draw();
}

// ---------------------------------------------------------------
// Glossário/Regras — página estática explicando, de forma didática, o
// pipeline de cálculo (TB_PREMISSAS_DIMENS -> FORECAST -> COMPLETO -> FINAL),
// a lógica de projeção do Forecast e os quatro Tipos de Faturamento.
// Não depende do banco — é só documentação embutida no próprio sistema.
// ---------------------------------------------------------------
function renderGlossarioPage(container) {
  container.innerHTML = `
    <div class="glossario">
      <div class="panel glossario-block">
        <p>Esta página explica, em linguagem simples, como o sistema transforma o que é cadastrado
        (Volume, TMA, HC Contratado, Absenteísmo, Turnover...) na Receita Bruta e no HC/FTE que aparecem
        no Painel Gerencial e no Analítico. Não é preciso entender tudo de uma vez — use o índice abaixo
        para ir direto ao ponto que interessa.</p>
        <div class="glossario-toc">
          <a href="#" data-target="glo-pipeline">1. Pipeline de cálculo</a>
          <a href="#" data-target="glo-projecao">2. Mês-base e projeção do Forecast</a>
          <a href="#" data-target="glo-minutagem">3. Minutagem e HC projetado</a>
          <a href="#" data-target="glo-distribuicao">4. Distribuição por Filial</a>
          <a href="#" data-target="glo-overstaff">5. Overstaff (TFL)</a>
          <a href="#" data-target="glo-faturamento">6. Tipos de Faturamento</a>
          <a href="#" data-target="glo-contratacoes">7. Contratações e Evasão</a>
          <a href="#" data-target="glo-receita">8. CPRB, Reajuste e Receita</a>
          <a href="#" data-target="glo-indicadores">9. FTE, ROB e PA HC Infra</a>
          <a href="#" data-target="glo-calendario">10. Calendário e Tipo Escala</a>
          <a href="#" data-target="glo-informativos">11. Campos informativos</a>
          <a href="#" data-target="glo-painel">12. Estatísticas do Painel</a>
        </div>
      </div>

      <div class="panel glossario-block" id="glo-pipeline">
        <h2>1. Pipeline de cálculo</h2>
        <p>Todo número que você vê no sistema nasce de 4 etapas, cada uma alimentando a próxima —
        a mesma estrutura das queries do <code>MODEL.xlsb</code> original:</p>
        <ol>
          <li><strong>TB_PREMISSAS_DIMENS</strong> — o que você cadastra em <em>Cadastro Dimensionamento</em>:
          Volume, TMA, Pausa, Ocupação, HC Dimensionado, HC Contratado e (opcional) Ocupação Garantia, mês a
          mês, por operação.</li>
          <li><strong>FORECAST</strong> — pega os meses reais cadastrados e <em>projeta</em> os meses
          seguintes (Volume, TMA, Pausa, HC), sem ainda saber nada sobre filial, faturamento ou overstaff.
          Ver seção 2.</li>
          <li><strong>COMPLETO</strong> — pega cada linha do Forecast e multiplica pelas filiais cadastradas,
          aplicando a % de Distribuição, Overstaff (Absenteísmo/Turnover/Férias/Folga), o Tipo de
          Faturamento, CPRB/Reajuste etc. É aqui que nascem Receita Bruta, HC Dimensionado, FTE Financeiro.</li>
          <li><strong>FINAL</strong> — a mesma coisa que o COMPLETO, só que filtrando fora as linhas sem
          custo (FTE Financeiro = 0) e, se pedido, por um Responsável PCP específico. É o que alimenta o
          Painel Gerencial e o Analítico.</li>
        </ol>
      </div>

      <div class="panel glossario-block" id="glo-projecao">
        <h2>2. Mês-base e projeção do Forecast</h2>
        <h3>O que é o mês-base</h3>
        <p>É o <strong>mês mais recente</strong>, para cada operação, que tem Volume ou HC Contratado
        preenchido em Cadastro Dimensionamento. Todo mês até o mês-base é tratado como <strong>REAL</strong>
        (dado histórico, não recalculado). Todo mês depois do mês-base é <strong>PROJETADO</strong>
        (calculado automaticamente pelo sistema).</p>
        <h3>Como o Volume é projetado</h3>
        <p>O sistema não simplesmente repete o volume do mês-base — ele ajusta pela quantidade de dias
        de faturamento de cada mês (ver seção 10), para que um mês com mais dias úteis (ou feriados,
        conforme a escala) tenha naturalmente mais volume projetado:</p>
        <p><code>Volume Projetado = (Volume do mês-base / Dias do mês-base) × Dias do mês projetado</code></p>
        <p>Depois disso, se houver uma % cadastrada em <em>Cadastro Ajuste Premissas</em> para aquele mês
        e operação, ela é aplicada por cima do Volume, do TMA e da Pausa — é a forma de você quebrar a
        herança automática e simular reajustes/reduções futuras sem mexer no dado real do mês-base.
        Ajustes só têm efeito em meses projetados; no mês-base e antes, são ignorados.</p>
        <h3>Como o HC Dimensionado é projetado</h3>
        <p>Depende de existir HC Contratado cadastrado (faturamento por Tempo Logado/Posição, "PA fixa"):</p>
        <ul>
          <li><strong>Com HC Contratado:</strong> o HC Dimensionado projetado é simplesmente o mesmo HC
          Contratado do mês-base, repetido em todos os meses seguintes (é um número fechado por contrato,
          não varia com volume).</li>
          <li><strong>Sem HC Contratado:</strong> o sistema resolve o HC pela fórmula inversa da
          Minutagem — ver seção 3.</li>
        </ul>
      </div>

      <div class="panel glossario-block" id="glo-minutagem">
        <h2>3. Minutagem e HC projetado</h2>
        <p><strong>Minutagem</strong> é a produtividade líquida observada no mês-base: quantos minutos de
        atendimento cada HC efetivamente produtivo consegue realizar.</p>
        <p><code>HC Efetivo = HC Dimensionado × (1 − Pausa)</code></p>
        <p><code>Minutagem = (Volume × TMA) / 60 / HC Efetivo</code></p>
        <p>Nos meses projetados, o sistema assume que essa produtividade <strong>se mantém constante</strong>
        e usa a fórmula invertida para descobrir quanto HC é necessário para o novo Volume/TMA/Pausa
        (já com os Ajustes de Premissas aplicados):</p>
        <p><code>HC Projetado = (Volume Projetado × TMA Projetado) / 60 / (Minutagem × (1 − Pausa Projetada))</code></p>
        <p>Ou seja: se o volume sobe, mais HC é necessário para manter a mesma produtividade — a menos que
        a operação tenha HC Contratado fixo (PA fixa), caso em que o HC simplesmente não muda com o volume.</p>
      </div>

      <div class="panel glossario-block" id="glo-distribuicao">
        <h2>4. Distribuição de Volume &amp; HC por Filial</h2>
        <p>Até aqui, tudo foi calculado <strong>por operação</strong>, sem falar em filial. A etapa
        COMPLETO reparte esse total entre as filiais usando as % cadastradas em <em>Cadastro Distribuição
        (Volume &amp; HC)</em>: uma % de Volume e uma % de HC, mês a mês, que devem somar 100% entre as
        filiais daquela operação.</p>
        <p>Se um mês novo (geralmente projetado) não tiver % cadastrada, o sistema usa a
        <strong>última % conhecida</strong> daquela operação/filial — assim você não precisa recadastrar a
        distribuição toda vez que estende o Dimensionamento para um mês novo.</p>
        <p>Exceção: quando o faturamento é por Tempo Logado/Posição <strong>e</strong> há HC Contratado, o
        HC não é rateado pela % de Distribuição — ele usa o HC Contratado direto (é um número fechado por
        contrato, não uma grandeza a dividir entre sites).</p>
      </div>

      <div class="panel glossario-block" id="glo-overstaff">
        <h2>5. Overstaff (TFL): Absenteísmo, Turnover, Férias, Folga</h2>
        <p>Cadastrados por filial/mês em <em>Cadastro Premissas Overstaff</em>, esses quatro indicadores
        somados formam o <strong>Total TFL</strong>:</p>
        <p><code>Total TFL = Absenteísmo + Turnover + Férias + Folga Extra</code></p>
        <p>O TFL representa a fração do quadro que, na prática, não está disponível para atender (ausências,
        desligamentos, férias, folgas) — por isso o HC "bruto" precisa ser maior que o HC "líquido"
        necessário para cobrir a operação:</p>
        <p><code>HC Bruto = HC Revisado / (1 − Total TFL)</code></p>
        <p><strong>Importante:</strong> essa inflação pelo TFL não se aplica a toda operação por igual — ver
        a diferença entre Tempo Logado e os demais tipos na seção 6.</p>
        <p>O Turnover também gera <strong>Reposições</strong> (quantas contratações são necessárias para
        repor quem sai): <code>Reposições = arredondar para cima(HC Dimensionado × Turnover × %HC da
        filial)</code>. Ver seção 7.</p>
      </div>

      <div class="panel glossario-block" id="glo-faturamento">
        <h2>6. Tipos de Faturamento</h2>
        <p>Cadastrado por filial/operação em <em>Cadastro Premissas Receita</em>, o Tipo de Faturamento
        define qual grandeza (HC ou Volume) gera receita, e qual fórmula de HC Bruto se aplica:</p>
        <div class="panel"><table class="grid">
          <thead><tr><th>Tipo</th><th>O que fatura</th><th>Numerador de Faturamento</th><th>HC Bruto infla por TFL?</th></tr></thead>
          <tbody>
            <tr><td class="id-col">Tempo Logado</td><td>Tempo logado do agente (posições/horas)</td><td><code>HC Revisado ÷ Ocupação</code></td><td>Não — HC Bruto = HC Revisado</td></tr>
            <tr><td class="id-col">Posição</td><td>Posição de atendimento (PA) fixa contratada</td><td><code>HC Revisado ÷ Ocupação</code></td><td>Sim — HC Bruto = HC Revisado ÷ (1 − TFL)</td></tr>
            <tr><td class="id-col">Minutagem</td><td>Minutos de chamada atendidos</td><td><code>Volume Revisado × (1 − Abandono − Shortcalls) × TMA ÷ 60</code></td><td>Sim — HC Bruto = HC Revisado ÷ (1 − TFL)</td></tr>
            <tr><td class="id-col">Evento</td><td>Quantidade de chamadas/eventos atendidos</td><td><code>Volume Revisado × (1 − Abandono − Shortcalls)</code></td><td>Sim — HC Bruto = HC Revisado ÷ (1 − TFL)</td></tr>
          </tbody>
        </table></div>
        <p>Repare que <strong>Tempo Logado</strong> e <strong>Posição</strong> usam exatamente a mesma
        fórmula de faturamento (HC Revisado ÷ Ocupação) — a diferença de negócio entre "pagar por tempo
        logado" e "pagar por posição fixa" não muda a receita, mas muda como o HC Bruto (o indicador
        "HC Dimensionado" exibido no sistema) é calculado: só o Tempo Logado fica isento da inflação por
        Absenteísmo/Turnover/Férias/Folga.</p>
        <p>Depois de calculado, o Numerador de Faturamento vira Receita — ver seção 8.</p>
        <p><strong>Ocupação</strong>, usada no numerador de Tempo Logado/Posição, é o campo cadastrado em
        Cadastro Dimensionamento (formato <code>#.#</code>) — a taxa de ocupação esperada do agente/posição.
        <strong>Abandono</strong> e <strong>Shortcalls</strong> são cadastrados em Cadastro Premissas Receita
        e reduzem o volume que efetivamente gera faturamento em Minutagem/Evento.</p>
      </div>

      <div class="panel glossario-block" id="glo-contratacoes">
        <h2>7. Contratações Adicionais e Evasão de Treinamento</h2>
        <p>Além das Reposições por Turnover (seção 5), você pode cadastrar <strong>Contratações
        Adicionais</strong> em Cadastro Premissas Adicionais — headcount extra que você já sabe que vai
        contratar, independente do turnover.</p>
        <p><code>Total de Contratações = arredondar para cima((Reposições + Contratações Adicionais) / (1 − Evasão))</code></p>
        <p>A <strong>Evasão</strong> (cadastrada em Overstaff) representa a fração de quem entra em
        treinamento e não conclui/não fica — por isso o total de contratações precisa ser maior que a
        necessidade líquida, para compensar essa perda. Esse total vira o <strong>HC Treinamento</strong>
        exibido no Analítico, e é somado ao HC Bruto para formar o FTE Financeiro (seção 9).</p>
      </div>

      <div class="panel glossario-block" id="glo-receita">
        <h2>8. CPRB, Reajuste Contratual e Receita Bodyshop</h2>
        <p>O <strong>Unitário G3</strong> (cadastrado por filial/operação em Cadastro Premissas Receita) é
        ajustado mês a mês por dois percentuais cadastrados separadamente (CPRB e Reajuste Contratual):</p>
        <p><code>Unitário Reajustado = Unitário G3 × (1 + CPRB%) × (1 + Reajuste%)</code></p>
        <p>A Receita Bruta final soma ainda a Receita Bodyshop (cadastrada à parte, não depende de HC/Volume):</p>
        <p><code>Receita Bruta = Numerador de Faturamento × Unitário Reajustado + Receita Bodyshop</code></p>
      </div>

      <div class="panel glossario-block" id="glo-indicadores">
        <h2>9. FTE Financeiro, ROB/Financeiro e PA HC Infra</h2>
        <ul>
          <li><strong>FTE Financeiro</strong> (também chamado HC Custo) = HC Bruto + Total de Contratações —
          é o headcount total que gera custo, usado como denominador do ROB.</li>
          <li><strong>ROB/Financeiro</strong> = Receita Bruta ÷ FTE Financeiro — quanto de receita cada FTE
          gera. É a régua de eficiência mostrada no topo do Painel Gerencial.</li>
          <li><strong>PA HC Infra</strong> — estimativa de posições de atendimento físicas/infraestrutura
          necessárias: <code>HC Revisado ÷ Ocupação</code> para Tempo Logado/Posição, ou
          <code>(HC Revisado ÷ Ocupação) × 1.06</code> para Minutagem/Evento (os 6% a mais cobrem um buffer
          de infraestrutura que esses tipos de operação costumam precisar).</li>
          <li><strong>Taxa Ocupação PA Infra</strong> = HC Revisado ÷ PA HC Infra — o quão ocupada está essa
          infraestrutura estimada.</li>
        </ul>
      </div>

      <div class="panel glossario-block" id="glo-calendario">
        <h2>10. Calendário e Tipo Escala</h2>
        <p>A guia Calendário calcula, para cada mês do ano, quantos dias úteis, sábados, domingos e
        feriados nacionais existem, e a partir disso duas bases de "dias de faturamento" usadas para
        projetar o Volume (seção 2):</p>
        <ul>
          <li><strong>Faturamento 5x2</strong> = dias úteis do mês (escala tradicional, sem operação em
          fim de semana).</li>
          <li><strong>Faturamento 6x1</strong> = dias úteis + ((sábados + domingos + feriados) × Peso
          Feriado Nacional) — para operações que funcionam também aos fins de semana/feriados, mas contando
          esses dias com um peso menor (por padrão 0.5, editável na própria guia Calendário).</li>
        </ul>
        <p>Qual das duas bases é usada na projeção de cada operação depende do campo <strong>Tipo
        Escala</strong> (6x1 ou 5x2), cadastrado em Cadastro Operações — se não for cadastrado, o sistema
        assume 5x2 por padrão (critério mais conservador).</p>
      </div>

      <div class="panel glossario-block" id="glo-informativos">
        <h2>11. Campos informativos (não entram em nenhum cálculo)</h2>
        <p>Alguns campos existem para consulta/registro, mas não alteram Receita, HC ou FTE:</p>
        <ul>
          <li><strong>Ocupação Garantia</strong> — cadastrada em Cadastro Dimensionamento, só habilitada
          quando há HC Contratado preenchido. É uma referência de negócio (o percentual de ocupação
          garantido contratualmente), mas hoje não entra em nenhuma fórmula.</li>
          <li><strong>Feriado Local</strong> — cadastrado por operação/filial em Cadastro Premissas
          Overstaff. Diferente do Feriado Nacional (seção 10), que virou um peso global usado no cálculo,
          o Feriado Local é só um registro — aparece no Analítico, mas não influencia a projeção.</li>
        </ul>
      </div>

      <div class="panel glossario-block" id="glo-painel">
        <h2>12. Estatísticas do Painel Gerencial</h2>
        <p>Os cards de Receita Bruta, HC Dimensionado, FTE Financeiro e ROB/Financeiro mostram, além do
        total do período, três números calculados sobre a série mensal do ano selecionado:</p>
        <ul>
          <li><strong>Média/Mês</strong> — não é uma média simples: é ponderada pelo Faturamento 5x2 (dias
          úteis) de cada mês, para que um mês mais curto (ex.: fevereiro) pese menos que um mês mais longo
          no cálculo da média.</li>
          <li><strong>Máximo</strong> e <strong>Mínimo</strong> — o maior e o menor valor mensal observado
          no ano selecionado, simples (sem ponderação).</li>
        </ul>
      </div>
    </div>
  `;

  container.querySelectorAll('.glossario-toc a').forEach(a => {
    a.onclick = (e) => {
      e.preventDefault();
      document.getElementById(a.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}
