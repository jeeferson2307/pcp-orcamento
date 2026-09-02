// Cadastros com navegação por operação: lista vertical -> clique abre uma
// janela (modal) com o detalhe mês a mês da operação selecionada.

const OVERSTAFF_METRICS = [
  { key: 'abs', table: 'tb_abs', label: 'Absenteísmo', format: 'percent', hasTipoDimens: true },
  { key: 'to', table: 'tb_to', label: 'Turnover', format: 'percent', hasTipoDimens: true },
  { key: 'ferias', table: 'tb_ferias', label: 'Férias', format: 'percent', hasTipoDimens: true },
  { key: 'folga', table: 'tb_folga', label: 'Folga Extra', format: 'percent', hasTipoDimens: true },
  { key: 'evasoes', table: 'tb_evasoes', label: 'Evasão Treinamento', format: 'percent', hasTipoDimens: true },
];

const ADICIONAIS_METRICS = [
  { key: 'contrat', table: 'tb_contratacoes_adicionais', label: 'Contratações Adicionais', format: 'number', hasTipoDimens: true },
  { key: 'spam', table: 'tb_spam', label: 'Spam Supervisão', format: 'number', hasTipoDimens: false },
  { key: 'jovens', table: 'tb_jovens', label: 'Jovem Aprendiz', format: 'number', hasTipoDimens: false },
];

const RECEITA_MONTHLY_METRICS = [
  { key: 'cprb', table: 'tb_cprb', label: 'CPRB', format: 'percent', hasTipoDimens: false },
  { key: 'reajuste', table: 'tb_reajuste', label: 'Reajuste', format: 'percent', hasTipoDimens: false },
  { key: 'bodyshop', table: 'tb_bodyshop', label: 'Receita Bodyshop', format: 'currency', hasTipoDimens: false },
];

// Sufixo de unidade mostrado junto ao rótulo do campo/coluna, para deixar
// claro ao usuário o tipo de valor esperado (ex.: "Absenteísmo (%)").
function unitSuffix(format) {
  if (format === 'percent') return ' (%)';
  if (format === 'currency') return ' (R$)';
  return '';
}
function labelWithUnit(f) {
  return escapeHtml(f.label) + unitSuffix(f.format);
}

function nextMonthStr(refStr) {
  const [y, m] = refStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1)); // m já é 1-based -> vira o mês seguinte
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// ---------------------------------------------------------------
// Lista vertical de operações (comum a todos os cadastros abaixo)
// ---------------------------------------------------------------
function renderOperationList(container, meta, onSelect) {
  container.innerHTML = `
    <div class="search-input op-search"><span data-icon="search"></span><input type="text" id="op-search-input" placeholder="Buscar operação…"></div>
    <div class="op-list" id="op-list"></div>
  `;
  applyIcons(container);
  const listEl = container.querySelector('#op-list');
  function draw(filter) {
    const ops = meta.operacoes.filter(o => !filter || o.toLowerCase().includes(filter.toLowerCase()));
    listEl.innerHTML = ops.map(o => `<div class="op-list-item" data-op="${escapeHtml(o)}"><span>${escapeHtml(o)}</span><span class="chev">${Icon('chevron-right')}</span></div>`).join('')
      || '<div class="empty-state">Nenhuma operação encontrada.</div>';
    listEl.querySelectorAll('.op-list-item').forEach(el => {
      el.onclick = () => onSelect(el.dataset.op);
    });
  }
  container.querySelector('#op-search-input').oninput = (e) => draw(e.target.value);
  draw('');
}

// ---------------------------------------------------------------
// Resolve o TIPO_DIMENS de uma operação para um dado mês (usa a Cadastro
// Dimensionamento como referência; cai para o último tipo_dimens conhecido).
// ---------------------------------------------------------------
async function resolveTipoDimensMap(operacao) {
  const premissas = await Api.get('/api/flat/tb_premissas_dimens');
  const rows = premissas.filter(r => r.nom_operacao === operacao).sort((a, b) => a.referencia < b.referencia ? -1 : 1);
  const byMonth = new Map(rows.map(r => [r.referencia, r.tipo_dimens]));
  const ultimo = rows.length ? rows[rows.length - 1].tipo_dimens : null;
  return { get: (mes) => byMonth.get(mes) ?? ultimo };
}

// ---------------------------------------------------------------
// Grid de métricas x filial, mesmo modelo do Cadastro Operações:
// tabela somente-leitura (agrupada por filial) + edição/criação via
// formulário em janela (uma janela por mês, com todas as filiais juntas).
// Usado por Overstaff, Adicionais e a parte mensal de Receita.
// ---------------------------------------------------------------
async function renderMetricGridFormDetail(container, operacao, metrics, meta) {
  const filiais = meta.filiais;
  const needsTipo = metrics.some(m => m.hasTipoDimens);
  const tipoDimensMap = needsTipo ? await resolveTipoDimensMap(operacao) : null;
  const tipoFor = (mes) => (tipoDimensMap ? tipoDimensMap.get(mes) : undefined);

  const dataByMetric = {};
  for (const m of metrics) {
    const res = await Api.get(`/api/wide/${m.table}`);
    dataByMetric[m.key] = res.rows.filter(r => r.nom_operacao === operacao);
  }
  const monthsSet = new Set();
  metrics.forEach(m => dataByMetric[m.key].forEach(r => monthsSet.add(r.referencia)));
  let months = [...monthsSet].sort();

  function findRow(metricKey, mes) {
    return dataByMetric[metricKey].find(r => r.referencia === mes);
  }

  container.innerHTML = `
    <div class="toolbar">
      <span class="small">${months.length} mês(es) cadastrado(s)</span>
      <button class="primary" id="btn-new-metric-grid">${Icon('plus')} Novo registro</button>
    </div>
    <div class="panel"><table class="grid" id="mg-table"></table></div>
  `;

  function draw() {
    const table = container.querySelector('#mg-table');
    const groupRow = `<tr class="group-row"><th rowspan="2">Mês</th>${metrics.map(m => `<th class="group-bound" colspan="${filiais.length}">${labelWithUnit(m)}</th>`).join('')}<th rowspan="2"></th></tr>`;
    const filialRow = `<tr>${metrics.map(() => filiais.map((f, i) => `<th class="${i === 0 ? 'group-bound' : ''}">${escapeHtml(f)}</th>`).join('')).join('')}</tr>`;
    table.innerHTML = `<thead>${groupRow}${filialRow}</thead>`;

    const tbody = document.createElement('tbody');
    if (months.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${metrics.length * filiais.length + 2}"><div class="empty-state">Nenhum mês cadastrado ainda. Use "Novo registro" para começar.</div></td></tr>`;
    }
    for (const mes of months) {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      let cellsHtml = `<td class="id-col">${Fmt.mes(mes)}</td>`;
      for (const m of metrics) {
        const row = findRow(m.key, mes);
        for (const [fi, f] of filiais.entries()) {
          const val = row ? Fmt.display(row[f], m.format) : '';
          cellsHtml += `<td class="${fi === 0 ? 'group-bound' : ''}">${escapeHtml(val)}</td>`;
        }
      }
      tr.innerHTML = cellsHtml;
      tr.onclick = (e) => { if (!e.target.closest('button')) openMetricGridForm(mes, false); };

      const tdAction = document.createElement('td');
      tdAction.className = 'actions-col';
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.innerHTML = Icon('pencil');
      editBtn.title = 'Editar';
      editBtn.onclick = () => openMetricGridForm(mes, false);
      tdAction.appendChild(editBtn);

      const replBtn = document.createElement('button');
      replBtn.className = 'icon-btn';
      replBtn.innerHTML = Icon('arrow-right');
      replBtn.title = 'Replicar para o próximo mês';
      replBtn.onclick = () => replicateMonth(mes);
      tdAction.appendChild(replBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'danger icon-btn';
      delBtn.innerHTML = Icon('trash-2');
      delBtn.title = 'Excluir este mês';
      delBtn.onclick = () => deleteMonth(mes);
      tdAction.appendChild(delBtn);

      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  async function deleteMonth(mes) {
    if (!confirm(`Excluir ${Fmt.mes(mes)} de todos os indicadores desta operação?`)) return;
    for (const m of metrics) {
      await Api.del(`/api/wide/${m.table}/row`, { referencia: mes, tipo_dimens: tipoFor(mes), nom_operacao: operacao });
      dataByMetric[m.key] = dataByMetric[m.key].filter(r => r.referencia !== mes);
    }
    months = months.filter(mm => mm !== mes);
    toast(`Mês ${Fmt.mes(mes)} excluído.`);
    draw();
  }

  async function replicateMonth(mes) {
    const proximo = nextMonthStr(mes);
    if (!months.includes(proximo)) months = [...months, proximo].sort();
    for (const m of metrics) {
      const srcRow = findRow(m.key, mes);
      if (!srcRow) continue;
      const tipoDimens = tipoFor(mes) ?? tipoFor(proximo);
      await Api.post(`/api/wide/${m.table}/row`, { referencia: proximo, tipo_dimens: tipoDimens, nom_operacao: operacao });
      const cells = filiais
        .filter(f => srcRow[f] != null)
        .map(f => ({ referencia: proximo, tipo_dimens: tipoDimens, nom_operacao: operacao, unidade: f, valor: srcRow[f] }));
      if (cells.length) await Api.put(`/api/wide/${m.table}`, { cells });
      let destRow = findRow(m.key, proximo);
      if (!destRow) { destRow = { referencia: proximo, nom_operacao: operacao, tipo_dimens: tipoDimens }; dataByMetric[m.key].push(destRow); }
      filiais.forEach(f => { if (srcRow[f] != null) destRow[f] = srcRow[f]; });
    }
    toast(`Réplicado para ${Fmt.mes(proximo)}.`);
    draw();
  }

  function openMetricGridForm(mes, isNew) {
    openModal(isNew ? `Novo registro · ${operacao}` : `Editar · ${Fmt.mes(mes)} · ${operacao}`, (body, close) => {
      body.innerHTML = `
        ${isNew ? `<label class="field-label" style="max-width:220px;margin-bottom:16px">Mês <input class="field-input" type="month" id="mgf-mes"></label>` : ''}
        <div class="panel"><table class="grid" id="mgf-form-table"></table></div>
        <div class="modal-actions" style="margin-top:16px">
          <button id="mgf-cancel">Cancelar</button>
          <button class="primary" id="mgf-save">${Icon('check')} Salvar</button>
        </div>
      `;
      const formTable = body.querySelector('#mgf-form-table');

      function drawFormTable(mesAtual) {
        formTable.innerHTML = `<thead><tr><th>Filial</th>${metrics.map(m => `<th>${labelWithUnit(m)}</th>`).join('')}</tr></thead>`;
        const tb = document.createElement('tbody');
        for (const f of filiais) {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td class="id-col">${escapeHtml(f)}</td>`;
          for (const m of metrics) {
            const td = document.createElement('td');
            td.className = 'num-cell';
            const input = document.createElement('input');
            input.type = 'text';
            const row = mesAtual ? findRow(m.key, mesAtual) : null;
            input.value = row ? Fmt.toEdit(row[f], m.format) : '';
            input.dataset.metric = m.key;
            input.dataset.filial = f;
            td.appendChild(input);
            tr.appendChild(td);
          }
          tb.appendChild(tr);
        }
        formTable.appendChild(tb);
      }
      drawFormTable(isNew ? null : mes);

      body.querySelector('#mgf-cancel').onclick = close;
      body.querySelector('#mgf-save').onclick = async () => {
        let targetMes = mes;
        if (isNew) {
          const val = body.querySelector('#mgf-mes').value;
          if (!val) { toast('Informe o mês.', true); return; }
          targetMes = `${val}-01`;
          if (months.includes(targetMes)) { toast('Esse mês já existe — edite-o na tabela.', true); return; }
        }
        const tipoDimens = tipoFor(targetMes);
        try {
          for (const m of metrics) {
            await Api.post(`/api/wide/${m.table}/row`, { referencia: targetMes, tipo_dimens: tipoDimens, nom_operacao: operacao });
          }
          const cellsByMetric = {};
          formTable.querySelectorAll('input').forEach(input => {
            const metricKey = input.dataset.metric;
            const format = metrics.find(m => m.key === metricKey).format;
            const valor = Fmt.fromEdit(input.value, format);
            if (valor == null) return;
            if (!cellsByMetric[metricKey]) cellsByMetric[metricKey] = [];
            cellsByMetric[metricKey].push({ referencia: targetMes, tipo_dimens: tipoDimens, nom_operacao: operacao, unidade: input.dataset.filial, valor });
          });
          for (const [metricKey, cells] of Object.entries(cellsByMetric)) {
            const tableName = metrics.find(m => m.key === metricKey).table;
            await Api.put(`/api/wide/${tableName}`, { cells });
            for (const c of cells) {
              let row = findRow(metricKey, targetMes);
              if (!row) { row = { referencia: targetMes, nom_operacao: operacao, tipo_dimens: tipoDimens }; dataByMetric[metricKey].push(row); }
              row[c.unidade] = c.valor;
            }
          }
          if (!months.includes(targetMes)) months = [...months, targetMes].sort();
          toast(isNew ? 'Registro criado.' : 'Registro atualizado.');
          close();
          draw();
        } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  container.querySelector('#btn-new-metric-grid').onclick = () => openMetricGridForm(null, true);

  draw();
}

// ---------------------------------------------------------------
// Cadastro Dimensionamento (sem filial): tipo_dimens, volume, tma, pausa,
// ocupação, hc_dimensionado, hc_contratado.
// Mesmo modelo do Cadastro Operações: tabela somente-leitura com títulos +
// edição/criação via formulário em janela.
// ---------------------------------------------------------------
const DIMENS_FIELDS = [
  { key: 'volume', label: 'Volume', format: 'number' },
  { key: 'tma', label: 'TMA', format: 'number' },
  { key: 'pausa', label: 'Pausa', format: 'percent' },
  { key: 'ocupacao', label: 'Ocupação', format: 'decimal1' },
  { key: 'hc_dimensionado', label: 'HC Dimensionado', format: 'number' },
  { key: 'hc_contratado', label: 'HC Contratado', format: 'number' },
];

async function renderDimensDetail(container, operacao) {
  let rows = (await Api.get('/api/flat/tb_premissas_dimens')).filter(r => r.nom_operacao === operacao);
  rows.sort((a, b) => a.referencia < b.referencia ? -1 : 1);

  container.innerHTML = `
    <div class="toolbar">
      <span class="small">${rows.length} mês(es) cadastrado(s)</span>
      <button class="primary" id="btn-new-dimens">${Icon('plus')} Novo registro</button>
    </div>
    <div class="panel"><table class="grid" id="dim-table"></table></div>
  `;

  function draw() {
    const table = container.querySelector('#dim-table');
    table.innerHTML = `<thead><tr><th>Mês</th><th>Tipo</th>${DIMENS_FIELDS.map(f => `<th>${labelWithUnit(f)}</th>`).join('')}<th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${DIMENS_FIELDS.length + 3}"><div class="empty-state">Nenhum mês cadastrado ainda. Use "Novo registro" para começar.</div></td></tr>`;
    }
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML = `<td class="id-col">${Fmt.mes(row.referencia)}</td><td class="id-col">${escapeHtml(row.tipo_dimens)}</td>` +
        DIMENS_FIELDS.map(f => `<td>${escapeHtml(Fmt.display(row[f.key], f.format))}</td>`).join('');
      tr.onclick = (e) => { if (!e.target.closest('button')) openDimensForm(row, false); };

      const tdAction = document.createElement('td');
      tdAction.className = 'actions-col';
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.innerHTML = Icon('pencil');
      editBtn.title = 'Editar';
      editBtn.onclick = () => openDimensForm(row, false);
      tdAction.appendChild(editBtn);

      const replBtn = document.createElement('button');
      replBtn.className = 'icon-btn';
      replBtn.innerHTML = Icon('arrow-right');
      replBtn.title = 'Replicar para o próximo mês';
      replBtn.onclick = async () => {
        const proximo = nextMonthStr(row.referencia);
        const novo = { ...row, referencia: proximo };
        try {
          await Api.post('/api/flat/tb_premissas_dimens', novo);
          rows.push(novo);
          rows.sort((a, b) => a.referencia < b.referencia ? -1 : 1);
          toast(`Réplicado para ${Fmt.mes(proximo)}.`);
          draw();
        } catch (e) { toast('Erro ao replicar (talvez esse mês já exista): ' + e.message, true); }
      };
      tdAction.appendChild(replBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'danger icon-btn';
      delBtn.innerHTML = Icon('trash-2');
      delBtn.title = 'Excluir este mês';
      delBtn.onclick = async () => {
        if (!confirm(`Excluir ${Fmt.mes(row.referencia)}?`)) return;
        try {
          await Api.del('/api/flat/tb_premissas_dimens', row);
          rows = rows.filter(r => r !== row);
          toast('Mês excluído.');
          draw();
        } catch (e) { toast('Erro ao excluir: ' + e.message, true); }
      };
      tdAction.appendChild(delBtn);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  function openDimensForm(rec, isNew) {
    const draft = { ...rec };
    if (isNew) draft.tipo_dimens = rows.length ? rows[rows.length - 1].tipo_dimens : '';
    openModal(isNew ? `Novo registro · ${operacao}` : `Editar · ${Fmt.mes(rec.referencia)} · ${operacao}`, (body, close) => {
      const monthVal = draft.referencia ? draft.referencia.slice(0, 7) : '';
      body.innerHTML = `
        <div class="field-grid">
          <label class="field-label">Mês
            <input class="field-input" type="month" data-key="referencia" value="${monthVal}" ${isNew ? '' : 'disabled'}>
          </label>
          <label class="field-label">Tipo (TIPO_DIMENS)
            <input class="field-input" type="text" data-key="tipo_dimens" value="${escapeHtml(draft.tipo_dimens ?? '')}" placeholder="ex: RECEPTIVO" ${isNew ? '' : 'disabled'}>
          </label>
          <label class="field-label">Operação
            <input class="field-input" type="text" value="${escapeHtml(operacao)}" disabled>
          </label>
          ${DIMENS_FIELDS.map(f => `
            <label class="field-label">${labelWithUnit(f)}
              <input class="field-input" type="text" data-key="${f.key}" value="${Fmt.toEdit(draft[f.key], f.format)}">
            </label>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button id="dim-cancel">Cancelar</button>
          <button class="primary" id="dim-save">${Icon('check')} Salvar</button>
        </div>
      `;

      body.querySelector('#dim-cancel').onclick = close;
      body.querySelector('#dim-save').onclick = async () => {
        const payload = isNew ? { nom_operacao: operacao } : { ...rec };
        if (isNew) {
          const monthInput = body.querySelector('[data-key="referencia"]').value;
          const tipoInput = body.querySelector('[data-key="tipo_dimens"]').value.trim();
          if (!monthInput || !tipoInput) { toast('Informe mês e tipo.', true); return; }
          payload.referencia = `${monthInput}-01`;
          payload.tipo_dimens = tipoInput;
        }
        DIMENS_FIELDS.forEach(f => {
          const el = body.querySelector(`[data-key="${f.key}"]`);
          payload[f.key] = Fmt.fromEdit(el.value, f.format);
        });
        try {
          if (isNew) {
            await Api.post('/api/flat/tb_premissas_dimens', payload);
            rows.push(payload);
            rows.sort((a, b) => a.referencia < b.referencia ? -1 : 1);
            toast('Registro criado.');
          } else {
            await Api.put('/api/flat/tb_premissas_dimens', payload);
            Object.assign(rec, payload);
            toast('Registro atualizado.');
          }
          close();
          draw();
        } catch (e) { toast('Erro ao salvar (talvez esse mês já exista): ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  container.querySelector('#btn-new-dimens').onclick = () => {
    const blank = { referencia: '', tipo_dimens: '' };
    DIMENS_FIELDS.forEach(f => { blank[f.key] = null; });
    openDimensForm(blank, true);
  };

  draw();
}

// ---------------------------------------------------------------
// Cadastro Premissas Receita: seção fixa (Unitários por filial) + grid
// mensal (CPRB, Reajuste, Receita Bodyshop) agrupado por filial.
// ---------------------------------------------------------------
const FAT_TIPOS = ['TEMPO LOGADO', 'POSIÇÃO', 'MINUTAGEM', 'EVENTO'];
const UNITARIO_FIELDS = [
  { key: 'unitario_g3', label: 'Unitário G3', format: 'currency' },
  { key: 'abandono', label: 'Abandono', format: 'percent' },
  { key: 'shortcalls', label: 'Shortcalls', format: 'percent' },
];

async function renderReceitaDetail(container, operacao, meta) {
  const unitariosAll = await Api.get('/api/flat/tb_unitarios');
  const filiais = meta.filiais;

  container.innerHTML = `
    <div class="section-title">Unitário de Faturamento (por filial)</div>
    <div class="panel" style="margin-bottom:18px"><table class="grid" id="unit-table"></table></div>
    <div class="section-title">Mensal (CPRB, Reajuste, Receita Bodyshop)</div>
    <div id="monthly-host"></div>
  `;

  const unitTable = container.querySelector('#unit-table');

  function recFor(f) {
    return unitariosAll.find(u => u.filial === f && u.operacao === operacao)
      || { filial: f, operacao, unitario_g3: null, abandono: null, shortcalls: null, tipo_faturamento: null };
  }

  function drawUnitTable() {
    unitTable.innerHTML = `<thead><tr><th>Filial</th><th>Unitário G3</th><th>Abandono</th><th>Shortcalls</th><th>Tipo Faturamento</th><th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const f of filiais) {
      const rec = recFor(f);
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML = `<td class="id-col">${escapeHtml(f)}</td>` +
        UNITARIO_FIELDS.map(uf => `<td>${escapeHtml(Fmt.display(rec[uf.key], uf.format))}</td>`).join('') +
        `<td>${escapeHtml(rec.tipo_faturamento || '')}</td>`;
      tr.onclick = (e) => { if (!e.target.closest('button')) openUnitarioForm(f); };
      const tdAction = document.createElement('td');
      tdAction.className = 'actions-col';
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.innerHTML = Icon('pencil');
      editBtn.title = 'Editar';
      editBtn.onclick = () => openUnitarioForm(f);
      tdAction.appendChild(editBtn);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    }
    unitTable.appendChild(tbody);
  }

  function openUnitarioForm(f) {
    const rec = { ...recFor(f) };
    openModal(`Unitário de Faturamento · ${f} · ${operacao}`, (body, close) => {
      body.innerHTML = `
        <div class="field-grid">
          <label class="field-label">Filial <input class="field-input" type="text" value="${escapeHtml(f)}" disabled></label>
          ${UNITARIO_FIELDS.map(uf => `
            <label class="field-label">${labelWithUnit(uf)}
              <input class="field-input" type="text" data-key="${uf.key}" value="${Fmt.toEdit(rec[uf.key], uf.format)}">
            </label>
          `).join('')}
          <label class="field-label">Tipo Faturamento
            <select class="field-input" data-key="tipo_faturamento">
              <option value="">—</option>
              ${FAT_TIPOS.map(t => `<option value="${t}" ${rec.tipo_faturamento === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="modal-actions">
          <button id="unit-cancel">Cancelar</button>
          <button class="primary" id="unit-save">${Icon('check')} Salvar</button>
        </div>
      `;
      body.querySelector('#unit-cancel').onclick = close;
      body.querySelector('#unit-save').onclick = async () => {
        UNITARIO_FIELDS.forEach(uf => {
          rec[uf.key] = Fmt.fromEdit(body.querySelector(`[data-key="${uf.key}"]`).value, uf.format);
        });
        rec.tipo_faturamento = body.querySelector('[data-key="tipo_faturamento"]').value || null;
        try {
          const already = unitariosAll.some(u => u.filial === rec.filial && u.operacao === rec.operacao);
          if (already) await Api.put('/api/flat/tb_unitarios', rec);
          else { await Api.post('/api/flat/tb_unitarios', rec); unitariosAll.push(rec); }
          toast('Salvo.');
          close();
          drawUnitTable();
        } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  drawUnitTable();

  await renderMetricGridFormDetail(container.querySelector('#monthly-host'), operacao, RECEITA_MONTHLY_METRICS, meta);
}

// ---------------------------------------------------------------
// Cadastro Distribuição (Volume & HC): linhas=meses, colunas=filiais,
// com total e validação de 100%.
// ---------------------------------------------------------------
async function renderDistribuicaoDetail(container, operacao, meta) {
  const filiais = meta.filiais;
  container.innerHTML = `
    <div class="section-title">Distribuição de Volume (%)</div>
    <div id="dist-volume"></div>
    <div class="section-title">Distribuição de HC (%)</div>
    <div id="dist-hc"></div>
  `;
  await renderDistribGrid(container.querySelector('#dist-volume'), operacao, 'tb_distribuicao_volume', filiais);
  await renderDistribGrid(container.querySelector('#dist-hc'), operacao, 'tb_distribuicao_hc', filiais);
}

function totalOf(row, filiais) {
  return filiais.reduce((s, f) => s + (Number(row[f]) || 0), 0);
}

async function renderDistribGrid(container, operacao, table, filiais) {
  const res = await Api.get(`/api/wide/${table}`);
  let rows = res.rows.filter(r => r.nom_operacao === operacao).sort((a, b) => a.referencia < b.referencia ? -1 : 1);

  container.innerHTML = `
    <div class="toolbar">
      <span class="small">${rows.length} mês(es) cadastrado(s)</span>
      <button class="primary btn-new-distrib">${Icon('plus')} Novo registro</button>
    </div>
    <div class="panel"><table class="grid"></table></div>
  `;
  const tableEl = container.querySelector('table.grid');

  function draw() {
    tableEl.innerHTML = `<thead><tr><th>Mês</th>${filiais.map(f => `<th>${escapeHtml(f)} (%)</th>`).join('')}<th>Total (%)</th><th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${filiais.length + 3}"><div class="empty-state">Nenhum mês cadastrado ainda. Use "Novo registro" para começar.</div></td></tr>`;
    }
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      const total = totalOf(row, filiais);
      tr.innerHTML = `<td class="id-col">${Fmt.mes(row.referencia)}</td>` +
        filiais.map(f => `<td>${escapeHtml(Fmt.display(row[f], 'percent'))}</td>`).join('') +
        `<td class="${Math.abs(total - 1) < 0.001 ? 'total-ok' : 'total-bad'}">${(total * 100).toFixed(1)}%</td>`;
      tr.onclick = (e) => { if (!e.target.closest('button')) openDistribForm(row, false); };

      const tdAction = document.createElement('td');
      tdAction.className = 'actions-col';
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.innerHTML = Icon('pencil');
      editBtn.title = 'Editar';
      editBtn.onclick = () => openDistribForm(row, false);
      tdAction.appendChild(editBtn);

      const replBtn = document.createElement('button');
      replBtn.className = 'icon-btn';
      replBtn.innerHTML = Icon('arrow-right');
      replBtn.title = 'Replicar para o próximo mês';
      replBtn.onclick = async () => {
        const proximo = nextMonthStr(row.referencia);
        await Api.post(`/api/wide/${table}/row`, { referencia: proximo, nom_operacao: operacao });
        const cells = filiais.filter(f => row[f] != null).map(f => ({ referencia: proximo, nom_operacao: operacao, unidade: f, valor: row[f] }));
        if (cells.length) await Api.put(`/api/wide/${table}`, { cells });
        let dest = rows.find(r => r.referencia === proximo);
        if (!dest) { dest = { referencia: proximo, nom_operacao: operacao }; rows.push(dest); }
        filiais.forEach(f => { if (row[f] != null) dest[f] = row[f]; });
        rows.sort((a, b) => a.referencia < b.referencia ? -1 : 1);
        toast(`Réplicado para ${Fmt.mes(proximo)}.`);
        draw();
      };
      tdAction.appendChild(replBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'danger icon-btn';
      delBtn.innerHTML = Icon('trash-2');
      delBtn.title = 'Excluir este mês';
      delBtn.onclick = async () => {
        if (!confirm(`Excluir ${Fmt.mes(row.referencia)}?`)) return;
        await Api.del(`/api/wide/${table}/row`, { referencia: row.referencia, nom_operacao: operacao });
        rows = rows.filter(r => r !== row);
        toast(`Mês ${Fmt.mes(row.referencia)} excluído.`);
        draw();
      };
      tdAction.appendChild(delBtn);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    }
    tableEl.appendChild(tbody);
  }

  function openDistribForm(rec, isNew) {
    openModal(isNew ? `Novo registro · ${operacao}` : `Editar · ${Fmt.mes(rec.referencia)} · ${operacao}`, (body, close) => {
      body.innerHTML = `
        ${isNew ? `<label class="field-label" style="max-width:220px;margin-bottom:16px">Mês <input class="field-input" type="month" id="distrib-mes"></label>` : ''}
        <div class="field-grid">
          ${filiais.map(f => `
            <label class="field-label">${escapeHtml(f)} (%)
              <input class="field-input" type="text" data-filial="${escapeHtml(f)}" value="${isNew ? '' : Fmt.toEdit(rec[f], 'percent')}">
            </label>
          `).join('')}
        </div>
        <div class="small" id="distrib-total" style="margin-bottom:16px"></div>
        <div class="modal-actions">
          <button id="distrib-cancel">Cancelar</button>
          <button class="primary" id="distrib-save">${Icon('check')} Salvar</button>
        </div>
      `;
      const totalEl = body.querySelector('#distrib-total');
      function updateTotal() {
        let total = 0;
        body.querySelectorAll('[data-filial]').forEach(inp => { total += Fmt.fromEdit(inp.value, 'percent') || 0; });
        totalEl.innerHTML = `Total: <strong class="${Math.abs(total - 1) < 0.001 ? 'total-ok' : 'total-bad'}" style="padding:2px 8px;border-radius:4px">${(total * 100).toFixed(1)}%</strong>`;
      }
      body.querySelectorAll('[data-filial]').forEach(inp => inp.addEventListener('input', updateTotal));
      updateTotal();

      body.querySelector('#distrib-cancel').onclick = close;
      body.querySelector('#distrib-save').onclick = async () => {
        let targetMes = rec.referencia;
        if (isNew) {
          const val = body.querySelector('#distrib-mes').value;
          if (!val) { toast('Informe o mês.', true); return; }
          targetMes = `${val}-01`;
          if (rows.some(r => r.referencia === targetMes)) { toast('Esse mês já existe — edite-o na tabela.', true); return; }
        }
        try {
          await Api.post(`/api/wide/${table}/row`, { referencia: targetMes, nom_operacao: operacao });
          const cells = [];
          body.querySelectorAll('[data-filial]').forEach(inp => {
            const valor = Fmt.fromEdit(inp.value, 'percent');
            if (valor == null) return;
            cells.push({ referencia: targetMes, nom_operacao: operacao, unidade: inp.dataset.filial, valor });
          });
          if (cells.length) await Api.put(`/api/wide/${table}`, { cells });
          let destRow = rows.find(r => r.referencia === targetMes);
          if (!destRow) { destRow = { referencia: targetMes, nom_operacao: operacao }; rows.push(destRow); }
          cells.forEach(c => { destRow[c.unidade] = c.valor; });
          rows.sort((a, b) => a.referencia < b.referencia ? -1 : 1);
          toast(isNew ? 'Registro criado.' : 'Registro atualizado.');
          close();
          draw();
        } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  container.querySelector('.btn-new-distrib').onclick = () => openDistribForm({ referencia: '' }, true);

  draw();
}

// ---------------------------------------------------------------
// Cadastro Ajuste Premissas (sem filial, mesma granularidade do
// Dimensionamento): % de incremento/redução a aplicar sobre Volume, TMA e
// Pausa em cada mês projetado da operação, quebrando a herança estática do
// mês-base na cadeia de projeção. Mesmo modelo do Cadastro Dimensionamento.
// ---------------------------------------------------------------
const AJUSTE_FIELDS = [
  { key: 'ajuste_volume', label: 'Ajuste Volume', format: 'percent' },
  { key: 'ajuste_tma', label: 'Ajuste TMA', format: 'percent' },
  { key: 'ajuste_pausa', label: 'Ajuste Pausa', format: 'percent' },
];

// Mês-base de uma operação: o mês mais recente com Volume ou HC Contratado
// preenchido em Dimensionamento (mesma regra usada em calc.js/buildForecast).
// Ajustes só têm efeito em meses POSTERIORES a este (meses projetados);
// o mês-base e os meses anteriores são dados reais, não recalculados.
async function resolveMesBase(operacao) {
  const premissas = (await Api.get('/api/flat/tb_premissas_dimens')).filter(r => r.nom_operacao === operacao);
  const preenchidas = premissas.filter(r => r.referencia != null && (((r.volume ?? 0) !== 0) || ((r.hc_contratado ?? 0) !== 0)));
  if (preenchidas.length === 0) return null;
  return preenchidas.reduce((max, r) => (r.referencia > max ? r.referencia : max), preenchidas[0].referencia);
}

async function renderAjusteDetail(container, operacao) {
  let rows = (await Api.get('/api/flat/tb_ajuste_premissas')).filter(r => r.nom_operacao === operacao);
  rows.sort((a, b) => a.referencia < b.referencia ? -1 : 1);
  const mesBase = await resolveMesBase(operacao);
  const semEfeito = (mes) => mesBase == null || mes <= mesBase;

  container.innerHTML = `
    <div class="toolbar">
      <span class="small">${rows.length} mês(es) cadastrado(s)</span>
      <button class="primary" id="btn-new-ajuste">${Icon('plus')} Novo registro</button>
    </div>
    ${mesBase ? `<div class="empty-state" style="text-align:left;margin-bottom:12px">${Icon('circle-alert')} Ajustes só têm efeito nos meses <strong>projetados</strong> (após ${Fmt.mes(mesBase)}). ${Fmt.mes(mesBase)} e meses anteriores são dados reais e ignoram o ajuste.</div>` : ''}
    <div class="panel"><table class="grid" id="ajuste-table"></table></div>
  `;
  applyIcons(container);

  function draw() {
    const table = container.querySelector('#ajuste-table');
    table.innerHTML = `<thead><tr><th>Mês</th>${AJUSTE_FIELDS.map(f => `<th>${labelWithUnit(f)}</th>`).join('')}<th></th><th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${AJUSTE_FIELDS.length + 3}"><div class="empty-state">Nenhum mês cadastrado ainda. Use "Novo registro" para começar.</div></td></tr>`;
    }
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML = `<td class="id-col">${Fmt.mes(row.referencia)}</td>` +
        AJUSTE_FIELDS.map(f => `<td>${escapeHtml(Fmt.display(row[f.key], f.format))}</td>`).join('') +
        `<td class="small">${semEfeito(row.referencia) ? 'Sem efeito (mês real)' : ''}</td>`;
      tr.onclick = (e) => { if (!e.target.closest('button')) openAjusteForm(row, false); };

      const tdAction = document.createElement('td');
      tdAction.className = 'actions-col';
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.innerHTML = Icon('pencil');
      editBtn.title = 'Editar';
      editBtn.onclick = () => openAjusteForm(row, false);
      tdAction.appendChild(editBtn);

      const replBtn = document.createElement('button');
      replBtn.className = 'icon-btn';
      replBtn.innerHTML = Icon('arrow-right');
      replBtn.title = 'Replicar para o próximo mês';
      replBtn.onclick = async () => {
        const proximo = nextMonthStr(row.referencia);
        const novo = { ...row, referencia: proximo };
        try {
          await Api.post('/api/flat/tb_ajuste_premissas', novo);
          rows.push(novo);
          rows.sort((a, b) => a.referencia < b.referencia ? -1 : 1);
          toast(`Réplicado para ${Fmt.mes(proximo)}.`);
          draw();
        } catch (e) { toast('Erro ao replicar (talvez esse mês já exista): ' + e.message, true); }
      };
      tdAction.appendChild(replBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'danger icon-btn';
      delBtn.innerHTML = Icon('trash-2');
      delBtn.title = 'Excluir este mês';
      delBtn.onclick = async () => {
        if (!confirm(`Excluir ${Fmt.mes(row.referencia)}?`)) return;
        try {
          await Api.del('/api/flat/tb_ajuste_premissas', row);
          rows = rows.filter(r => r !== row);
          toast('Mês excluído.');
          draw();
        } catch (e) { toast('Erro ao excluir: ' + e.message, true); }
      };
      tdAction.appendChild(delBtn);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  function openAjusteForm(rec, isNew) {
    const draft = { ...rec };
    openModal(isNew ? `Novo registro · ${operacao}` : `Editar · ${Fmt.mes(rec.referencia)} · ${operacao}`, (body, close) => {
      const monthVal = draft.referencia ? draft.referencia.slice(0, 7) : '';
      body.innerHTML = `
        <div class="field-grid">
          <label class="field-label">Mês
            <input class="field-input" type="month" data-key="referencia" value="${monthVal}" ${isNew ? '' : 'disabled'}>
          </label>
          <label class="field-label">Operação
            <input class="field-input" type="text" value="${escapeHtml(operacao)}" disabled>
          </label>
          ${AJUSTE_FIELDS.map(f => `
            <label class="field-label">${labelWithUnit(f)}
              <input class="field-input" type="text" data-key="${f.key}" value="${Fmt.toEdit(draft[f.key], f.format)}">
            </label>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button id="ajuste-cancel">Cancelar</button>
          <button class="primary" id="ajuste-save">${Icon('check')} Salvar</button>
        </div>
      `;

      body.querySelector('#ajuste-cancel').onclick = close;
      body.querySelector('#ajuste-save').onclick = async () => {
        const payload = isNew ? { nom_operacao: operacao } : { ...rec };
        if (isNew) {
          const monthInput = body.querySelector('[data-key="referencia"]').value;
          if (!monthInput) { toast('Informe o mês.', true); return; }
          payload.referencia = `${monthInput}-01`;
        }
        AJUSTE_FIELDS.forEach(f => {
          const el = body.querySelector(`[data-key="${f.key}"]`);
          payload[f.key] = Fmt.fromEdit(el.value, f.format);
        });
        try {
          if (isNew) {
            await Api.post('/api/flat/tb_ajuste_premissas', payload);
            rows.push(payload);
            rows.sort((a, b) => a.referencia < b.referencia ? -1 : 1);
            toast('Registro criado.');
          } else {
            await Api.put('/api/flat/tb_ajuste_premissas', payload);
            Object.assign(rec, payload);
            toast('Registro atualizado.');
          }
          if (semEfeito(payload.referencia)) {
            toast(`Aviso: ${Fmt.mes(payload.referencia)} é mês-base ou anterior (dado real) — este ajuste não altera nenhum cálculo.`, true);
          }
          close();
          draw();
        } catch (e) { toast('Erro ao salvar (talvez esse mês já exista): ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  container.querySelector('#btn-new-ajuste').onclick = () => {
    const blank = { referencia: '', nom_operacao: operacao };
    AJUSTE_FIELDS.forEach(f => { blank[f.key] = null; });
    openAjusteForm(blank, true);
  };

  draw();
}

// ---------------------------------------------------------------
// Páginas de topo (lista + abertura do modal)
// ---------------------------------------------------------------
function renderCadastroDimensionamento(container, meta) {
  renderOperationList(container, meta, (operacao) => {
    openModal(`Dimensionamento · ${operacao}`, (body) => renderDimensDetail(body, operacao));
  });
}
function renderCadastroOverstaff(container, meta) {
  renderOperationList(container, meta, (operacao) => {
    openModal(`Premissas Overstaff · ${operacao}`, (body) => renderMetricGridFormDetail(body, operacao, OVERSTAFF_METRICS, meta));
  });
}
function renderCadastroReceita(container, meta) {
  renderOperationList(container, meta, (operacao) => {
    openModal(`Premissas Receita · ${operacao}`, (body) => renderReceitaDetail(body, operacao, meta));
  });
}
function renderCadastroAdicionais(container, meta) {
  renderOperationList(container, meta, (operacao) => {
    openModal(`Premissas Adicionais · ${operacao}`, (body) => renderMetricGridFormDetail(body, operacao, ADICIONAIS_METRICS, meta));
  });
}
function renderCadastroDistribuicao(container, meta) {
  renderOperationList(container, meta, (operacao) => {
    openModal(`Distribuição (Volume & HC) · ${operacao}`, (body) => renderDistribuicaoDetail(body, operacao, meta));
  });
}
function renderCadastroAjustePremissas(container, meta) {
  renderOperationList(container, meta, (operacao) => {
    openModal(`Ajuste Premissas · ${operacao}`, (body) => renderAjusteDetail(body, operacao));
  });
}
