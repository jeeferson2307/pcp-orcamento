// Grade estilo Excel para as tabelas de entrada "largas" (REFERENCIA x OPERAÇÃO x FILIAIS)
async function renderWideGrid(container, table, meta) {
  const data = await Api.get(`/api/wide/${table}`);
  const { config, idCols, filiais, rows } = data;

  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = `<span class="small">${rows.length} linha(s) · valores em ${
    config.format === 'percent' ? '%' : config.format === 'currency' ? 'R$' : 'número'
  }</span>`;
  const addBtn = document.createElement('button');
  addBtn.className = 'primary';
  addBtn.innerHTML = Icon('plus') + ' Nova linha';
  toolbar.appendChild(addBtn);
  container.appendChild(toolbar);

  const formWrap = document.createElement('div');
  formWrap.className = 'new-row-form';
  formWrap.style.display = 'none';
  formWrap.innerHTML = `
    <label>Mês <input type="month" id="nr-mes"></label>
    ${config.hasTipoDimens ? `<label>Tipo <input type="text" id="nr-tipo" list="tiposDimensList" placeholder="ex: RECEPTIVO"></label>` : ''}
    <label>Operação <input type="text" id="nr-op" list="operacoesList" placeholder="Nome da operação"></label>
    <button class="primary" id="nr-save">Adicionar</button>
    <button id="nr-cancel">Cancelar</button>
  `;
  container.appendChild(formWrap);

  if (!document.getElementById('operacoesList')) {
    const dl = document.createElement('datalist');
    dl.id = 'operacoesList';
    dl.innerHTML = (meta.operacoes || []).map(o => `<option value="${escapeHtml(o)}">`).join('');
    document.body.appendChild(dl);
    const dl2 = document.createElement('datalist');
    dl2.id = 'tiposDimensList';
    dl2.innerHTML = (meta.tiposDimens || []).map(o => `<option value="${escapeHtml(o)}">`).join('');
    document.body.appendChild(dl2);
  }

  addBtn.onclick = () => { formWrap.style.display = formWrap.style.display === 'none' ? 'flex' : 'none'; };
  formWrap.querySelector('#nr-cancel').onclick = () => { formWrap.style.display = 'none'; };
  formWrap.querySelector('#nr-save').onclick = async () => {
    const mesVal = formWrap.querySelector('#nr-mes').value; // yyyy-mm
    const op = formWrap.querySelector('#nr-op').value.trim();
    const tipo = config.hasTipoDimens ? formWrap.querySelector('#nr-tipo').value.trim() : undefined;
    if (!mesVal || !op || (config.hasTipoDimens && !tipo)) { toast('Preencha todos os campos.', true); return; }
    const referencia = `${mesVal}-01`;
    try {
      await Api.post(`/api/wide/${table}/row`, { referencia, tipo_dimens: tipo, nom_operacao: op });
      toast('Linha adicionada.');
      renderWideGrid(container, table, meta);
    } catch (e) { toast('Erro ao adicionar linha: ' + e.message, true); }
  };

  const panel = document.createElement('div');
  panel.className = 'panel';
  const tableEl = document.createElement('table');
  tableEl.className = 'grid';

  const theadCols = [
    'Mês',
    ...(config.hasTipoDimens ? ['Tipo'] : []),
    'Operação',
    ...filiais,
    '',
  ];
  tableEl.innerHTML = `<thead><tr>${theadCols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`;

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    let idCells = `<td class="id-col">${Fmt.mes(row.referencia)}</td>`;
    if (config.hasTipoDimens) idCells += `<td class="id-col">${escapeHtml(row.tipo_dimens || '')}</td>`;
    idCells += `<td class="id-col">${escapeHtml(row.nom_operacao || '')}</td>`;
    tr.innerHTML = idCells;

    for (const filial of filiais) {
      const td = document.createElement('td');
      td.className = 'num-cell';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = Fmt.toEdit(row[filial], config.format);
      input.dataset.original = input.value;
      input.addEventListener('input', () => {
        input.classList.remove('saved');
        input.classList.toggle('dirty', input.value !== input.dataset.original);
      });
      input.addEventListener('blur', async () => {
        if (input.value === input.dataset.original) return;
        const valor = Fmt.fromEdit(input.value, config.format);
        const cell = { referencia: row.referencia, nom_operacao: row.nom_operacao, unidade: filial, valor };
        if (config.hasTipoDimens) cell.tipo_dimens = row.tipo_dimens;
        try {
          await Api.put(`/api/wide/${table}`, { cells: [cell] });
          input.dataset.original = input.value;
          input.classList.remove('dirty');
          input.classList.add('saved');
          setTimeout(() => input.classList.remove('saved'), 900);
        } catch (e) {
          toast('Erro ao salvar: ' + e.message, true);
        }
      });
      td.appendChild(input);
      tr.appendChild(td);
    }

    const tdActions = document.createElement('td');
    tdActions.className = 'actions-col';
    const delBtn = document.createElement('button');
    delBtn.className = 'danger icon-btn';
    delBtn.innerHTML = Icon('trash-2');
    delBtn.title = 'Remover linha';
    delBtn.onclick = async () => {
      if (!confirm('Remover esta linha de todas as filiais?')) return;
      try {
        await Api.del(`/api/wide/${table}/row`, {
          referencia: row.referencia, tipo_dimens: row.tipo_dimens, nom_operacao: row.nom_operacao,
        });
        renderWideGrid(container, table, meta);
      } catch (e) { toast('Erro ao remover: ' + e.message, true); }
    };
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }
  tableEl.appendChild(tbody);
  panel.appendChild(tableEl);
  container.appendChild(panel);

  if (rows.length === 0) {
    panel.innerHTML = '<div class="empty-state">Nenhum dado ainda. Use "Nova linha" para começar.</div>';
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.innerHTML = Icon(isError ? 'circle-alert' : 'check') + '<span>' + escapeHtml(msg) + '</span>';
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 3000);
}
