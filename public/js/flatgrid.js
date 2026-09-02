// Grade CRUD genérica para tabelas "chatas" (dimensões, premissas, unitários).
// Layout: tabela somente-leitura com títulos amigáveis + edição/criação via
// formulário em janela (modal), em vez de edição inline nas células.

function humanizeLabel(col) {
  return col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fieldsFor(table, columns, flatCfg) {
  if (flatCfg.fields) return flatCfg.fields;
  return columns.map(c => ({ key: c, label: humanizeLabel(c), type: 'text' }));
}

async function renderFlatGrid(container, table, meta) {
  const flatCfg = meta.flatTables[table];
  let rows = await Api.get(`/api/flat/${table}`);
  const columns = flatCfg.columns;
  const fields = fieldsFor(table, columns, flatCfg);

  // usado pelo campo "filial-select": mapa unidade -> {cod_empresa, cod_filial}.
  // Busca direto na tabela D_FILIAIS a cada abertura do formulário (sem cache),
  // para sempre refletir o cadastro de filiais mais atual.
  async function getFiliaisLookup() {
    const filiaisRows = await Api.get('/api/flat/d_filiais');
    return new Map(filiaisRows.map(f => [f.unidade, f]));
  }

  container.innerHTML = `
    <div class="toolbar">
      <span class="small">${rows.length} registro(s)</span>
      <button class="primary" id="btn-new-record">${Icon('plus')} Novo registro</button>
    </div>
    <div class="panel"><table class="grid" id="flat-table"></table></div>
  `;

  function draw() {
    const table_ = container.querySelector('#flat-table');
    table_.innerHTML = `<thead><tr>${fields.map(f => `<th>${escapeHtml(f.label)}</th>`).join('')}<th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${fields.length + 1}"><div class="empty-state">Nenhum registro ainda. Use "Novo registro" para começar.</div></td></tr>`;
    }
    for (const rec of rows) {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML = fields.map(f => `<td>${escapeHtml(rec[f.key] ?? '')}</td>`).join('');
      tr.onclick = (e) => { if (!e.target.closest('button')) openRecordForm(rec, false); };
      const tdActions = document.createElement('td');
      tdActions.className = 'actions-col';
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.title = 'Editar';
      editBtn.innerHTML = Icon('pencil');
      editBtn.onclick = () => openRecordForm(rec, false);
      tdActions.appendChild(editBtn);
      const delBtn = document.createElement('button');
      delBtn.className = 'danger icon-btn';
      delBtn.title = 'Excluir';
      delBtn.innerHTML = Icon('trash-2');
      delBtn.onclick = async () => {
        if (!confirm('Excluir este registro?')) return;
        try {
          await Api.del(`/api/flat/${table}`, rec);
          rows = rows.filter(r => r !== rec);
          toast('Registro excluído.');
          draw();
        } catch (e) { toast('Erro ao excluir: ' + e.message, true); }
      };
      tdActions.appendChild(delBtn);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }
    table_.appendChild(tbody);
  }

  async function openRecordForm(rec, isNew) {
    const lookup = fields.some(f => f.type === 'filial-select') ? await getFiliaisLookup() : null;
    openModal(isNew ? `Novo registro · ${flatCfg.label}` : `Editar · ${flatCfg.label}`, (body, close) => {
      const draft = { ...rec };
      body.innerHTML = `<div class="field-grid">` + fields.map(f => {
        const locked = !isNew && flatCfg.pk.includes(f.key);
        if (f.type === 'filial-select') {
          // carregado direto e de forma distinta da tabela D_FILIAIS (campo Unidade/Site),
          // não do cache de meta — sempre reflete o cadastro de filiais mais atual.
          const unidades = [...lookup.keys()];
          const opts = unidades.map(u => `<option value="${escapeHtml(u)}" ${draft[f.key] === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('');
          return `<label class="field-label">${escapeHtml(f.label)}
            <select class="field-input" data-key="${f.key}" ${locked ? 'disabled' : ''}>
              <option value="">—</option>${opts}
            </select>
          </label>`;
        }
        return `<label class="field-label">${escapeHtml(f.label)}
          <input class="field-input" type="${f.type === 'number' ? 'number' : 'text'}" data-key="${f.key}" value="${escapeHtml(draft[f.key] ?? '')}" ${locked ? 'disabled' : ''}>
        </label>`;
      }).join('') + `</div>
        <div class="modal-actions">
          <button id="rec-cancel">Cancelar</button>
          <button class="primary" id="rec-save">${Icon('check')} Salvar</button>
        </div>
      `;

      const filialSelect = body.querySelector('[data-key="filial"]');
      if (filialSelect && filialSelect.tagName === 'SELECT') {
        filialSelect.onchange = () => {
          const fil = lookup.get(filialSelect.value);
          if (!fil) return;
          const codEmpresa = body.querySelector('[data-key="cod_empresa"]');
          const codFilial = body.querySelector('[data-key="cod_filial"]');
          if (codEmpresa) codEmpresa.value = fil.cod_empresa ?? '';
          if (codFilial) codFilial.value = fil.cod_filial ?? '';
        };
      }

      body.querySelector('#rec-cancel').onclick = close;
      body.querySelector('#rec-save').onclick = async () => {
        const payload = isNew ? {} : { ...rec };
        fields.forEach(f => {
          const el = body.querySelector(`[data-key="${f.key}"]`);
          if (el.disabled) return;
          payload[f.key] = coerce(el.value);
        });
        try {
          if (isNew) {
            await Api.post(`/api/flat/${table}`, payload);
            rows.push(payload);
            toast('Registro criado.');
          } else {
            await Api.put(`/api/flat/${table}`, payload);
            Object.assign(rec, payload);
            toast('Registro atualizado.');
          }
          close();
          draw();
        } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  container.querySelector('#btn-new-record').onclick = () => {
    const blank = {};
    fields.forEach(f => { blank[f.key] = null; });
    openRecordForm(blank, true);
  };

  draw();
}

function coerce(v) {
  if (v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}
