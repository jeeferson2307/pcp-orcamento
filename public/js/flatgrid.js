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

  // Centros de custo para o campo "cc-select", ordenados pela descrição (é por
  // ela que o usuário procura). A descrição NÃO é única — há códigos
  // diferentes com a mesma descrição — por isso o código aparece junto no
  // rótulo e é ele que fica guardado.
  async function getCentrosCusto() {
    const lista = await Api.get('/api/flat/d_centro_custo');
    return lista.slice().sort((a, b) =>
      String(a.desc_centro_de_custo ?? '').localeCompare(String(b.desc_centro_de_custo ?? '')));
  }

  // Campos vindos do centro de custo: a grade e o formulário mostram, mas
  // quem manda neles é o cadastro de Centro de Custo.
  const CAMPOS_HERDADOS_CC = ['desc_centro_de_custo', 'cliente', 'cod_empresa', 'cod_filial',
                              'un_dre', 'diretoria', 'gerente', 'responsavel_pcp', 'responsavel_fpa'];

  container.innerHTML = `
    <div class="toolbar">
      <div class="search-input" id="flat-search-wrap" style="max-width:320px"><span data-icon="search"></span><input type="text" id="flat-search" placeholder="Buscar…"></div>
      <span class="small" id="flat-count">${rows.length} registro(s)</span>
      <button class="primary" id="btn-new-record">${Icon('plus')} Novo registro</button>
    </div>
    <div class="panel"><table class="grid" id="flat-table"></table></div>
  `;
  applyIcons(container);

  // Busca em qualquer coluna visível (mesmo campo/rótulo mostrado na grade),
  // sem distinguir maiúsculas/minúsculas — mesmo princípio do Analítico.
  let filtered = rows;
  function applyFilter() {
    const q = container.querySelector('#flat-search').value.trim().toLowerCase();
    filtered = !q ? rows : rows.filter(rec => fields.some(f => String(rec[f.key] ?? '').toLowerCase().includes(q)));
    container.querySelector('#flat-count').textContent = `${filtered.length} registro(s)`;
    draw();
  }
  container.querySelector('#flat-search').oninput = applyFilter;

  function draw() {
    const table_ = container.querySelector('#flat-table');
    table_.innerHTML = `<thead><tr>${fields.map(f => `<th>${escapeHtml(f.label)}</th>`).join('')}<th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${fields.length + 1}"><div class="empty-state">${rows.length === 0 ? 'Nenhum registro ainda. Use "Novo registro" para começar.' : 'Nenhum registro encontrado.'}</div></td></tr>`;
    }
    for (const rec of filtered) {
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
          toast('Registro excluído.');
          await recarregar();
        } catch (e) { toast('Erro ao excluir: ' + e.message, true); }
      };
      tdActions.appendChild(delBtn);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }
    table_.appendChild(tbody);
  }

  // Recarrega do banco em vez de remendar o array local: a tela de Operações
  // mostra colunas que vêm de outra tabela por join, e elas só aparecem
  // corretas vindo da consulta.
  async function recarregar() {
    rows = await Api.get(`/api/flat/${table}`);
    applyFilter();
  }

  async function openRecordForm(rec, isNew) {
    const lookup = fields.some(f => f.type === 'filial-select') ? await getFiliaisLookup() : null;
    const centros = fields.some(f => f.type === 'cc-select') ? await getCentrosCusto() : null;
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
        if (f.type === 'cc-select') {
          const opts = centros.map(c => {
            const rotulo = `${c.desc_centro_de_custo ?? '(sem descrição)'} · ${c.cod_centro_de_custo}`;
            const sel = String(draft[f.key] ?? '') === String(c.cod_centro_de_custo) ? 'selected' : '';
            return `<option value="${escapeHtml(c.cod_centro_de_custo)}" ${sel}>${escapeHtml(rotulo)}</option>`;
          }).join('');
          return `<label class="field-label">${escapeHtml(f.label)}
            <select class="field-input" data-key="${f.key}" ${locked ? 'disabled' : ''}>
              <option value="">—</option>${opts}
            </select>
          </label>`;
        }
        if (f.readOnly) {
          return `<label class="field-label">${escapeHtml(f.label)}
            <input class="field-input" type="text" data-herdado="${f.key}" value="${escapeHtml(draft[f.key] ?? '')}" disabled
                   title="Vem do Centro de Custo selecionado — edite no cadastro de Centro de Custo">
          </label>`;
        }
        if (f.type === 'select') {
          const opts = (f.options || []).map(o => `<option value="${escapeHtml(o)}" ${draft[f.key] === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
          return `<label class="field-label">${escapeHtml(f.label)}
            <select class="field-input" data-key="${f.key}" ${locked ? 'disabled' : ''}>
              <option value="">—</option>${opts}
            </select>
          </label>`;
        }
        return `<label class="field-label">${escapeHtml(f.label)}
          <input class="field-input" type="${f.type === 'number' ? 'number' : 'text'}" data-key="${f.key}" value="${escapeHtml(draft[f.key] ?? '')}" ${locked ? 'disabled' : ''}
                 ${f.type === 'codigo' ? 'inputmode="numeric"' : ''}>
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
          // Só preenche o que a própria tabela guarda; onde cod_empresa/cod_filial
          // são herdados do centro de custo, quem manda é o cc-select.
          for (const chave of ['cod_empresa', 'cod_filial']) {
            const el = body.querySelector(`[data-key="${chave}"]`);
            if (el && !el.disabled) el.value = fil[chave] ?? '';
          }
        };
      }

      // Escolher o centro de custo preenche na hora os campos herdados, para o
      // usuário ver o relacionamento antes de salvar.
      const ccSelect = body.querySelector('select[data-key="cod_centro_de_custo"]');
      if (ccSelect && centros) {
        const preencherHerdados = () => {
          const cc = centros.find(c => String(c.cod_centro_de_custo) === String(ccSelect.value));
          for (const chave of CAMPOS_HERDADOS_CC) {
            const el = body.querySelector(`[data-herdado="${chave}"]`);
            if (el) el.value = cc ? (cc[chave] ?? '') : '';
          }
        };
        ccSelect.onchange = preencherHerdados;
        preencherHerdados();
        enhanceCombobox(ccSelect);
      }

      body.querySelector('#rec-cancel').onclick = close;
      body.querySelector('#rec-save').onclick = async () => {
        const payload = isNew ? {} : { ...rec };
        fields.forEach(f => {
          const el = body.querySelector(`[data-key="${f.key}"]`);
          // campos herdados não têm data-key: nunca entram na gravação
          if (!el || el.disabled) return;
          payload[f.key] = TIPOS_TEXTUAIS.has(f.type) ? (el.value || null) : coerce(el.value);
        });
        try {
          if (isNew) {
            await Api.post(`/api/flat/${table}`, payload);
            toast('Registro criado.');
          } else {
            await Api.put(`/api/flat/${table}`, payload);
            toast('Registro atualizado.');
          }
          close();
          await recarregar();
        } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  container.querySelector('#btn-new-record').onclick = () => {
    const blank = {};
    fields.forEach(f => { blank[f.key] = null; });
    openRecordForm(blank, true);
  };

  applyFilter();
}

// Código é identificador, não quantidade: "113381" tem que ser gravado como
// texto. Sem isso o mesmo campo entrava no banco ora como texto ora como
// número (dependendo da tela), e o histórico de alterações registrava o valor
// antigo numa coluna e o novo noutra.
const TIPOS_TEXTUAIS = new Set(['codigo', 'cc-select']);

function coerce(v) {
  if (v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}


// ---------------------------------------------------------------
// Tela de Centro de Custo: a grade genérica, mais o aviso da normalização.
// Quando os dados vinham denormalizados dentro de cadastro_operacoes, o mesmo
// código podia aparecer com atributos diferentes em operações diferentes. A
// migração escolheu a combinação mais frequente de cada código e guardou o
// que foi descartado — isso precisa chegar aos olhos de quem cadastra, não
// ficar escondido num log.
// ---------------------------------------------------------------
async function renderCentroCustoPage(container, meta) {
  const aviso = document.createElement('div');
  container.appendChild(aviso);
  const grade = document.createElement('div');
  container.appendChild(grade);
  await renderFlatGrid(grade, 'd_centro_custo', meta);
  await desenharAvisoMigracaoCc(aviso);
}

async function desenharAvisoMigracaoCc(host) {
  let relatorio = null;
  try {
    const { texto } = await Api.get('/api/config/migracao_centro_custo');
    if (!texto) return;
    const ciente = await Api.get('/api/config/migracao_centro_custo_ciente');
    if (ciente.texto === '1') return;
    relatorio = JSON.parse(texto);
  } catch (e) { return; }
  if (!relatorio || !relatorio.conflitos || !relatorio.conflitos.length) return;

  const linhas = relatorio.conflitos.map(c => {
    const campos = c.campos_divergentes.map(k => {
      const descartados = c.descartados.map(d => d.valores[k]).filter(v => String(v) !== String(c.adotado[k]));
      return `<li><strong>${escapeHtml(k)}</strong>: adotado <em>${escapeHtml(String(c.adotado[k] ?? '—'))}</em>`
        + (descartados.length ? ` — descartado ${descartados.map(v => `<em>${escapeHtml(String(v ?? '—'))}</em>`).join(', ')}` : '')
        + `</li>`;
    }).join('');
    const ondes = c.descartados.flatMap(d => d.exemplos).slice(0, 4).join('; ');
    return `<li style="margin-bottom:8px">Código <strong>${escapeHtml(c.cod)}</strong>
      <ul style="margin:4px 0 0 0">${campos}</ul>
      ${ondes ? `<span class="small">vinha divergente em: ${escapeHtml(ondes)}</span>` : ''}</li>`;
  }).join('');

  host.innerHTML = `
    <div class="aviso-versao" style="display:block">
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
        ${Icon('circle-alert')}
        <div><strong>${relatorio.conflitos.length} código(s) de centro de custo vinham com dados divergentes</strong>
        entre as operações e foram unificados. Confira os valores abaixo e corrija aqui se algum estiver errado.</div>
      </div>
      <ul style="margin:0 0 10px 18px">${linhas}</ul>
      <button id="cc-aviso-ok">Conferi, ocultar este aviso</button>
    </div>
  `;
  host.querySelector('#cc-aviso-ok').onclick = async () => {
    await Api.put('/api/config/migracao_centro_custo_ciente', { texto: '1' });
    host.innerHTML = '';
    toast('Aviso ocultado. O relatório continua guardado no banco.');
  };
}
