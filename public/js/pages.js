const GROUP_LABELS = {
  diretoria: 'Diretoria', site: 'Site / Filial', cliente: 'Cliente',
  operacao: 'Operação', referencia: 'Mês', desc_centro_custo: 'Descrição Centro de Custo',
};
const DRILL_LABELS = { none: 'Nenhum', ...GROUP_LABELS };
const GROUP_OPTIONS_HTML = Object.entries(GROUP_LABELS)
  .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  .map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
const DRILL_OPTIONS_HTML = `<option value="none">Nenhum</option>` + GROUP_OPTIONS_HTML;

function yearOptions(selected) {
  const cur = new Date().getFullYear();
  const sel = selected ?? cur;
  return [cur - 1, cur, cur + 1].map(a => `<option ${a === sel ? 'selected' : ''}>${a}</option>`).join('');
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
// Gráfico de barras mensal (sem dependências externas) — usado pelas visões
// Headcount / Volume (Chamadas) / TMA / Receita Bruta x mês do Painel Gerencial.
// ---------------------------------------------------------------
function niceCeil(n) {
  if (!(n > 0)) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const f = n / base;
  const niceF = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return niceF * base;
}

function roundedTopRectPath(x, y, w, h, r) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

function renderBarChart(container, { title, color, data, valueLabel }) {
  const W = 640, H = 260;
  const padL = 60, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = niceCeil(Math.max(1, ...data.map(d => d.valor)));
  const n = data.length || 1;
  const slot = plotW / n;
  const barW = Math.min(24, slot * 0.55);

  const yOf = (v) => padT + plotH * (1 - v / maxVal);
  const ticks = [0, maxVal / 2, maxVal];

  const gridlines = ticks.map(t => `<line x1="${padL}" y1="${yOf(t).toFixed(1)}" x2="${W - padR}" y2="${yOf(t).toFixed(1)}" class="chart-gridline" />`).join('');
  const yLabels = ticks.map(t => `<text x="${padL - 8}" y="${(yOf(t) + 3).toFixed(1)}" class="chart-axis-label" text-anchor="end">${valueLabel(t)}</text>`).join('');

  const bars = data.map((d, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    const y = yOf(d.valor);
    const h = padT + plotH - y;
    return `<path d="${roundedTopRectPath(x, y, barW, h, 4)}" fill="${color}" data-mes="${d.mes}" data-valor="${d.valor}"></path>`;
  }).join('');

  const xLabels = data.map((d, i) => {
    const x = padL + i * slot + slot / 2;
    return `<text x="${x.toFixed(1)}" y="${H - padB + 18}" class="chart-axis-label" text-anchor="middle">${Fmt.mes(d.mes)}</text>`;
  }).join('');

  container.innerHTML = `
    <div class="chart-title">${escapeHtml(title)}</div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">
        ${gridlines}
        <line x1="${padL}" y1="${(padT + plotH).toFixed(1)}" x2="${W - padR}" y2="${(padT + plotH).toFixed(1)}" class="chart-baseline" />
        ${yLabels}
        ${bars}
        ${xLabels}
      </svg>
      <div class="chart-tooltip" style="display:none"></div>
    </div>
  `;

  const tooltip = container.querySelector('.chart-tooltip');
  const wrap = container.querySelector('.chart-wrap');
  container.querySelectorAll('path[data-mes]').forEach(el => {
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

async function renderDashboardPage(container, meta) {
  const expanded = new Set();

  container.innerHTML = `
    <div class="toolbar">
      <label>Agrupar por <select id="d-group">${GROUP_OPTIONS_HTML}</select></label>
      <label>Drill <select id="d-drill">${DRILL_OPTIONS_HTML}</select></label>
    </div>
    <div class="toolbar">
      <label>Ano <select id="d-ano">${yearOptions()}</select></label>
      <label>Responsável PCP <select id="d-resp"><option value="">Todos</option>${(meta.responsaveis||[]).map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></label>
      <label>Gerente <select id="d-gerente"><option value="">Todos</option>${(meta.gerentes||[]).map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></label>
      <label>Operação <select id="d-operacao"><option value="">Todas</option>${(meta.operacoes||[]).map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></label>
    </div>
    <div id="kpis" class="kpi-row"></div>

    <div class="section-title">Resumo por <span id="group-label"></span> <span class="small" id="drill-hint"></span></div>
    <div class="panel"><table class="grid" id="tbl-dash"></table></div>

    <div class="section-title">Headcount, Volume, TMA e Receita Bruta por mês</div>
    <div class="chart-grid">
      <div class="panel chart-card" id="chart-hc"></div>
      <div class="panel chart-card" id="chart-volume"></div>
      <div class="panel chart-card" id="chart-tma"></div>
      <div class="panel chart-card" id="chart-receita"></div>
    </div>
  `;
  applyIcons(container);

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
    document.getElementById('kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Receita Bruta (total)</div><div class="kpi-value">${Fmt.display(t.receita_bruta,'currency')}</div></div>
      <div class="kpi-card"><div class="kpi-label">HC Dimensionado (total)</div><div class="kpi-value">${Fmt.display(t.hc_dim,'number')}</div></div>
      <div class="kpi-card"><div class="kpi-label">FTE Financeiro (total)</div><div class="kpi-value">${Fmt.display(t.fte_financeiro,'number')}</div></div>
      <div class="kpi-card"><div class="kpi-label">ROB/Financeiro</div><div class="kpi-value">${Fmt.display(t.rob_financeiro,'currency')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Absenteísmo (méd. pond. HC)</div><div class="kpi-value">${Fmt.display(t.absenteismo,'percent')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Turnover (méd. pond. HC)</div><div class="kpi-value">${Fmt.display(t.turnover,'percent')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Férias (méd. pond. HC)</div><div class="kpi-value">${Fmt.display(t.ferias,'percent')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Folga Adicional (méd. pond. HC)</div><div class="kpi-value">${Fmt.display(t.folga_extra,'percent')}</div></div>
    `;
  }

  function drawCharts() {
    const porMes = data.porMes || [];
    renderBarChart(document.getElementById('chart-hc'), {
      title: 'Headcount x Mês', color: 'var(--chart-1)',
      data: porMes.map(m => ({ mes: m.mes, valor: m.hc })),
      valueLabel: v => Fmt.display(v, 'number'),
    });
    renderBarChart(document.getElementById('chart-volume'), {
      title: 'Volume (Chamadas) x Mês', color: 'var(--chart-2)',
      data: porMes.map(m => ({ mes: m.mes, valor: m.volume })),
      valueLabel: v => Fmt.display(v, 'number'),
    });
    renderBarChart(document.getElementById('chart-tma'), {
      title: 'TMA Médio (seg) x Mês', color: 'var(--chart-3)',
      data: porMes.map(m => ({ mes: m.mes, valor: m.tma })),
      valueLabel: v => Fmt.display(v, 'decimal1'),
    });
    renderBarChart(document.getElementById('chart-receita'), {
      title: 'Receita Bruta x Mês', color: 'var(--chart-4)',
      data: porMes.map(m => ({ mes: m.mes, valor: m.receita })),
      valueLabel: v => Fmt.display(v, 'currency'),
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
// Calendário — exibe a tabela mensal calculada por fnCalendarioMensal
// (calendario.js): dias úteis, sábados, domingos, feriados nacionais e
// dias de faturamento (dia útil + feriado) por mês, base de todo o cálculo
// de projeção de Volume em calc.js/buildForecast.
// ---------------------------------------------------------------
function renderCalendarioPage(container, meta) {
  container.innerHTML = `
    <div class="toolbar">
      <label>Ano <select id="cal-ano">${yearOptions()}</select></label>
    </div>
    <div class="panel"><table class="grid" id="tbl-calendario"></table></div>
  `;

  function draw() {
    const ano = parseInt(document.getElementById('cal-ano').value, 10);
    const meses = fnCalendarioMensal(ano);
    const linhas = [...meses.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

    const totais = { diaUtil: 0, sabado: 0, domingo: 0, feriados: 0, diasFaturamento: 0 };
    for (const [, b] of linhas) {
      totais.diaUtil += b.diaUtil;
      totais.sabado += b.sabado;
      totais.domingo += b.domingo;
      totais.feriados += b.feriados;
      totais.diasFaturamento += b.diasFaturamento;
    }

    const tbl = document.getElementById('tbl-calendario');
    tbl.innerHTML = `<thead><tr><th>Mês</th><th>Dia Útil</th><th>Sábado</th><th>Domingo</th><th>Feriados</th><th>Dias Faturamento</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const [mes, b] of linhas) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="id-col">${Fmt.mes(mes)}</td><td>${b.diaUtil}</td><td>${b.sabado}</td><td>${b.domingo}</td><td>${b.feriados}</td><td>${b.diasFaturamento}</td>`;
      tbody.appendChild(tr);
    }
    const trTotal = document.createElement('tr');
    trTotal.innerHTML = `<td class="total-ok">Total ${ano}</td><td class="total-ok">${totais.diaUtil}</td><td class="total-ok">${totais.sabado}</td><td class="total-ok">${totais.domingo}</td><td class="total-ok">${totais.feriados}</td><td class="total-ok">${totais.diasFaturamento}</td>`;
    tbody.appendChild(trTotal);
    tbl.appendChild(tbody);
  }

  document.getElementById('cal-ano').onchange = draw;
  draw();
}
