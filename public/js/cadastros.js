// Cadastros com navegação por operação: lista vertical -> clique abre uma
// janela (modal) com o detalhe mês a mês da operação selecionada.

const OVERSTAFF_METRICS = [
  { key: 'abs', table: 'tb_abs', label: 'Absenteísmo', format: 'percent', hasTipoDimens: true },
  { key: 'to', table: 'tb_to', label: 'Turnover', format: 'percent', hasTipoDimens: true },
  { key: 'ferias', table: 'tb_ferias', label: 'Férias', format: 'percent', hasTipoDimens: true },
  { key: 'folga', table: 'tb_folga', label: 'Folga Extra', format: 'percent', hasTipoDimens: true },
  { key: 'evasoes', table: 'tb_evasoes', label: 'Evasão Treinamento', format: 'percent', hasTipoDimens: true },
  // Só informativo (aparece no Analítico) — não entra em nenhum cálculo,
  // diferente do Feriado Nacional, que virou um peso global na guia Calendário.
  { key: 'ferloc', table: 'tb_esc_feriados_loc', label: 'Feriado Local', format: 'percent', hasTipoDimens: false },
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

// Lista de meses de `mesInicio` até `mesFim`, ambos inclusive (formato
// 'YYYY-MM-01'). Base da replicação por intervalo.
function monthRange(mesInicio, mesFim) {
  const meses = [];
  let m = mesInicio;
  while (m <= mesFim) {
    meses.push(m);
    m = nextMonthStr(m);
  }
  return meses;
}

function byReferencia(a, b) {
  return a.referencia < b.referencia ? -1 : a.referencia > b.referencia ? 1 : 0;
}

// Filiais relacionadas a uma operação. Cada linha de Cadastro Operações é a
// operação dentro de uma filial, então esse conjunto é a lista de filiais em
// que a operação de fato existe. Os cadastros de premissas passam a mostrar
// só essas colunas em vez de todas as filiais da empresa — uma operação que
// roda em 2 sites não precisa de 15 colunas vazias para preencher.
// Mantém a ordem de d_filiais (meta.filiais) para as colunas não dançarem de
// uma tela para outra. Se a operação não tiver nenhuma filial que também
// esteja cadastrada em Filiais/Unidades, cai para a lista completa: uma grade
// sem nenhuma coluna seria inutilizável, e nesse caso o que está errado é o
// cadastro, não a tela.
function filiaisDaOperacao(meta, operacao) {
  const relacionadas = new Set((meta.filiaisPorOperacao || {})[operacao] || []);
  const filtradas = meta.filiais.filter(f => relacionadas.has(f));
  return filtradas.length ? filtradas : meta.filiais;
}

// Texto do shell de indicadores avisando que a grade mostra só as filiais da
// operação (silencioso quando são todas mesmo).
function hintFiliais(filiais, meta) {
  if (filiais.length >= meta.filiais.length) return '';
  return `${filiais.length} de ${meta.filiais.length} filiais — só as cadastradas nesta operação`;
}

// Teto de meses que uma replicação pode gerar de uma vez: um ano digitado
// errado (2099 em vez de 2026) criaria centenas de gravações mês x filial e
// travaria a tela. 10 anos é folgado para qualquer orçamento real.
const MAX_MESES_REPLICACAO = 120;

// Popup de replicação: em vez de copiar só para o mês seguinte, pergunta até
// qual mês replicar e chama `onConfirm(meses)` com a lista de destinos — do
// mês seguinte ao de origem até o escolhido, inclusive.
function openReplicarModal(mesOrigem, onConfirm) {
  const primeiro = nextMonthStr(mesOrigem);
  openModal(`Replicar ${Fmt.mes(mesOrigem)}`, (body, close) => {
    body.innerHTML = `
      <p>Copia os valores de <strong>${Fmt.mes(mesOrigem)}</strong> para os meses seguintes, até o mês escolhido (inclusive). Meses que já existirem são <strong>sobrescritos</strong>.</p>
      <label class="field-label" style="max-width:260px">Replicar até o mês
        <input class="field-input" type="month" id="repl-ate" value="${primeiro.slice(0, 7)}" min="${primeiro.slice(0, 7)}">
      </label>
      <div class="small" id="repl-resumo" style="margin-bottom:16px"></div>
      <div class="modal-actions">
        <button id="repl-cancel">Cancelar</button>
        <button class="primary" id="repl-confirm">${Icon('arrow-right')} Replicar</button>
      </div>
    `;
    const input = body.querySelector('#repl-ate');
    const resumoEl = body.querySelector('#repl-resumo');
    const confirmBtn = body.querySelector('#repl-confirm');

    function mesesDestino() {
      if (!input.value) return null;
      const ate = `${input.value}-01`;
      return ate < primeiro ? [] : monthRange(primeiro, ate);
    }
    function atualizarResumo() {
      const meses = mesesDestino();
      confirmBtn.disabled = true;
      if (meses == null) { resumoEl.textContent = 'Informe o mês final.'; return; }
      if (meses.length === 0) { resumoEl.textContent = `O mês final precisa ser ${Fmt.mes(primeiro)} ou posterior.`; return; }
      if (meses.length > MAX_MESES_REPLICACAO) {
        resumoEl.textContent = `${meses.length} meses é demais para uma replicação só (máximo ${MAX_MESES_REPLICACAO}) — confira o ano digitado.`;
        return;
      }
      resumoEl.textContent = meses.length === 1
        ? `1 mês será preenchido: ${Fmt.mes(meses[0])}.`
        : `${meses.length} meses serão preenchidos: ${Fmt.mes(meses[0])} a ${Fmt.mes(meses[meses.length - 1])}.`;
      confirmBtn.disabled = false;
    }
    input.addEventListener('input', atualizarResumo);
    atualizarResumo();

    body.querySelector('#repl-cancel').onclick = close;
    confirmBtn.onclick = async () => {
      const meses = mesesDestino();
      if (!meses || !meses.length || meses.length > MAX_MESES_REPLICACAO) return;
      confirmBtn.disabled = true;
      try {
        await onConfirm(meses);
        close();
      } catch (e) {
        confirmBtn.disabled = false;
        toast('Erro ao replicar: ' + e.message, true);
      }
    };
  }, { size: 'form' });
}

// Célula de ações padrão das grades mês a mês (editar / replicar / excluir),
// igual nos quatro cadastros que têm uma linha por mês.
function buildAcoesMes({ onEdit, onReplicar, onExcluir }) {
  const td = document.createElement('td');
  td.className = 'actions-col';
  const add = (className, icon, title, handler) => {
    const b = document.createElement('button');
    b.className = className;
    b.innerHTML = Icon(icon);
    b.title = title;
    b.onclick = handler;
    td.appendChild(b);
  };
  add('icon-btn', 'pencil', 'Editar', onEdit);
  add('icon-btn', 'arrow-right', 'Replicar para os próximos meses', onReplicar);
  add('danger icon-btn', 'trash-2', 'Excluir este mês', onExcluir);
  return td;
}

// ---------------------------------------------------------------
// Shell comum dos cadastros por indicador: um combo com os indicadores do
// cadastro e, logo abaixo, a grade só do indicador selecionado.
// Substitui o layout antigo, que empilhava todos os indicadores lado a lado
// numa tabela única (no Overstaff eram 6 indicadores x N filiais de colunas,
// ilegível sem rolagem horizontal).
// `onRender(indicador, host)` desenha a grade do indicador escolhido.
// Devolve { reload } para redesenhar o indicador atual (ex.: depois de um
// import de planilha) sem perder a escolha do combo.
// ---------------------------------------------------------------
function renderIndicadorShell(container, { indicadores, hint, template, onRender }) {
  const templateHtml = template ? `
      <span class="indicador-actions">
        <button class="icon-btn" id="ind-download" title="Baixar modelo de planilha">${Icon('download')}</button>
        <button class="icon-btn" id="ind-upload" title="Importar planilha preenchida">${Icon('upload')}</button>
      </span>` : '';
  container.innerHTML = `
    <div class="toolbar indicador-bar">
      <label class="field-label indicador-field">Indicador
        <select class="field-input" id="ind-select">
          ${indicadores.map((ind, i) => `<option value="${i}">${escapeHtml(ind.label)}</option>`).join('')}
        </select>
      </label>
      ${hint ? `<span class="small indicador-hint">${escapeHtml(hint)}</span>` : ''}
      ${templateHtml}
    </div>
    <div id="ind-host"></div>
  `;
  const select = container.querySelector('#ind-select');
  const host = container.querySelector('#ind-host');
  if (template) {
    container.querySelector('#ind-download').onclick = template.onDownload;
    container.querySelector('#ind-upload').onclick = template.onUpload;
  }
  async function reload() {
    host.innerHTML = '<div class="empty-state">Carregando…</div>';
    await onRender(indicadores[Number(select.value)], host);
  }
  select.onchange = reload;
  return { reload };
}

// ---------------------------------------------------------------
// Meses cadastrados por operação — resumo mostrado em cada item da lista
// vertical (renderOperationList), para o usuário enxergar de relance quais
// operações ainda não têm nada cadastrado naquele cadastro específico.
// ---------------------------------------------------------------
function buildMesesMap(rows, opKey, mesKey) {
  const byOp = new Map();
  for (const r of rows) {
    const op = r[opKey];
    const mes = r[mesKey];
    if (!op || !mes) continue;
    if (!byOp.has(op)) byOp.set(op, new Set());
    byOp.get(op).add(mes);
  }
  const out = new Map();
  for (const [op, set] of byOp) {
    const meses = [...set].sort();
    out.set(op, { count: meses.length, min: meses[0], max: meses[meses.length - 1] });
  }
  return out;
}

// Tabelas "largas" (wide) já vêm agrupadas por (referencia [+tipo_dimens],
// nom_operacao) em res.rows — um mês conta se aparece em QUALQUER uma das
// métricas daquele cadastro (a união dos indicadores do combo).
async function mesesMapFromMetricTables(metrics) {
  const allRows = [];
  for (const m of metrics) {
    const res = await Api.get(`/api/wide/${m.table}`);
    allRows.push(...res.rows);
  }
  return buildMesesMap(allRows, 'nom_operacao', 'referencia');
}

// `info.onlyUnitarios` (usado só pelo Cadastro Premissas Receita): a operação
// não tem nenhum mês na grade mensal (CPRB/Reajuste/Bodyshop), mas já tem
// Unitário de Faturamento cadastrado por filial — evita o aviso de "nenhum
// mês cadastrado" quando na verdade já existe alguma premissa preenchida.
function mesInfoLabel(info) {
  if (!info) return null;
  if (info.onlyUnitarios) return 'Unitário de faturamento cadastrado (nenhum mês mensal ainda)';
  if (info.count === 0) return null;
  if (info.count === 1) return `1 mês cadastrado · ${Fmt.mes(info.min)}`;
  return `${info.count} meses cadastrados · ${Fmt.mes(info.min)} a ${Fmt.mes(info.max)}`;
}

// ---------------------------------------------------------------
// Lista vertical de operações (comum a todos os cadastros abaixo).
// `mesesPorOperacao` (opcional): Map operação -> {count, min, max} — quando
// presente, mostra abaixo do nome da operação um resumo dos meses
// cadastrados (ou um aviso quando não há nenhum). Baixar/importar modelo de
// planilha fica dentro do frame de cada operação (ver render*Detail abaixo).
// ---------------------------------------------------------------
function renderOperationList(container, meta, onSelect, mesesPorOperacao) {
  container.innerHTML = `
    <div class="search-input op-search"><span data-icon="search"></span><input type="text" id="op-search-input" placeholder="Buscar operação…"></div>
    <div class="op-list" id="op-list"></div>
  `;
  applyIcons(container);
  const listEl = container.querySelector('#op-list');
  function draw(filter) {
    const ops = meta.operacoes.filter(o => !filter || o.toLowerCase().includes(filter.toLowerCase()));
    listEl.innerHTML = ops.map(o => {
      let mesesHtml = '';
      if (mesesPorOperacao) {
        const info = mesesPorOperacao.get(o);
        const label = mesInfoLabel(info);
        mesesHtml = label
          ? `<span class="op-list-meses">${label}</span>`
          : `<span class="op-list-meses op-list-meses-vazio">${Icon('circle-alert', { size: 12 })} Nenhum mês cadastrado</span>`;
      }
      return `<div class="op-list-item" data-op="${escapeHtml(o)}">
        <div class="op-list-main"><span class="op-list-nome">${escapeHtml(o)}</span>${mesesHtml}</div>
        <span class="chev">${Icon('chevron-right')}</span>
      </div>`;
    }).join('') || '<div class="empty-state">Nenhuma operação encontrada.</div>';
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
// Grade de UM indicador "largo" (tabela REFERENCIA x FILIAL): linhas = meses,
// colunas = as filiais relacionadas à operação. Edição/criação de um mês em
// janela (todas as filiais juntas), replicação por intervalo e exclusão.
// Usada por Overstaff, Adicionais e a parte mensal de Receita — o indicador
// vem do combo do renderIndicadorShell, uma grade por vez.
// ---------------------------------------------------------------
async function renderMetricMonthGrid(host, { operacao, metric, filiais, tipoFor }) {
  const res = await Api.get(`/api/wide/${metric.table}`);
  let rows = res.rows.filter(r => r.nom_operacao === operacao).sort(byReferencia);
  // tipo_dimens só existe nas tabelas que o têm na chave primária; nas outras
  // vai undefined e a camada Store ignora.
  const tipoPara = (mes) => (metric.hasTipoDimens ? tipoFor(mes) : undefined);

  host.innerHTML = `
    <div class="toolbar">
      <span class="small" id="mg-count"></span>
      <button class="primary" id="btn-new-metric">${Icon('plus')} Novo mês</button>
    </div>
    <div class="panel"><table class="grid" id="mg-table"></table></div>
  `;
  const table = host.querySelector('#mg-table');
  const countEl = host.querySelector('#mg-count');

  function findRow(mes) { return rows.find(r => r.referencia === mes); }

  // Grava o mês inteiro (todas as filiais visíveis), inclusive os campos
  // deixados em branco — que viram NULL. Antes um campo apagado era ignorado
  // e o valor antigo continuava no banco, sem jeito de limpar pela tela.
  // Filiais fora da lista da operação não são tocadas.
  async function gravarMes(mes, valoresPorFilial) {
    const tipo = tipoPara(mes);
    await Api.post(`/api/wide/${metric.table}/row`, { referencia: mes, tipo_dimens: tipo, nom_operacao: operacao });
    const cells = filiais.map(f => ({
      referencia: mes, tipo_dimens: tipo, nom_operacao: operacao,
      unidade: f, valor: valoresPorFilial[f] ?? null,
    }));
    await Api.put(`/api/wide/${metric.table}`, { cells });
    let destino = findRow(mes);
    if (!destino) {
      destino = { referencia: mes, nom_operacao: operacao, tipo_dimens: tipo };
      rows.push(destino);
      rows.sort(byReferencia);
    }
    filiais.forEach(f => { destino[f] = valoresPorFilial[f] ?? null; });
  }

  async function replicar(mesOrigem, mesesDestino) {
    const origem = findRow(mesOrigem);
    if (!origem) return;
    const valores = {};
    filiais.forEach(f => { valores[f] = origem[f] ?? null; });
    for (const destino of mesesDestino) await gravarMes(destino, valores);
    draw();
    toast(mesesDestino.length === 1
      ? `Replicado para ${Fmt.mes(mesesDestino[0])}.`
      : `Replicado para ${mesesDestino.length} meses (${Fmt.mes(mesesDestino[0])} a ${Fmt.mes(mesesDestino[mesesDestino.length - 1])}).`);
  }

  async function excluirMes(mes) {
    if (!confirm(`Excluir ${Fmt.mes(mes)} de ${metric.label} nesta operação?`)) return;
    try {
      await Api.del(`/api/wide/${metric.table}/row`, { referencia: mes, tipo_dimens: tipoPara(mes), nom_operacao: operacao });
      rows = rows.filter(r => r.referencia !== mes);
      toast(`Mês ${Fmt.mes(mes)} excluído.`);
      draw();
    } catch (e) { toast('Erro ao excluir: ' + e.message, true); }
  }

  function draw() {
    countEl.textContent = `${rows.length} mês(es) cadastrado(s) · ${metric.label}`;
    table.innerHTML = `<thead><tr><th>Mês</th>${filiais.map(f => `<th>${escapeHtml(f)}${unitSuffix(metric.format)}</th>`).join('')}<th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${filiais.length + 2}"><div class="empty-state">Nenhum mês cadastrado em ${escapeHtml(metric.label)}. Use "Novo mês" para começar.</div></td></tr>`;
    }
    for (const row of rows) {
      const mes = row.referencia;
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML = `<td class="id-col">${Fmt.mes(mes)}</td>` +
        filiais.map(f => `<td>${escapeHtml(Fmt.display(row[f], metric.format))}</td>`).join('');
      tr.onclick = (e) => { if (!e.target.closest('button')) openForm(mes, false); };
      tr.appendChild(buildAcoesMes({
        onEdit: () => openForm(mes, false),
        onReplicar: () => openReplicarModal(mes, (meses) => replicar(mes, meses)),
        onExcluir: () => excluirMes(mes),
      }));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  function openForm(mes, isNew) {
    const titulo = isNew
      ? `Novo mês · ${metric.label} · ${operacao}`
      : `${Fmt.mes(mes)} · ${metric.label} · ${operacao}`;
    openModal(titulo, (body, close) => {
      body.innerHTML = `
        ${isNew ? `<label class="field-label" style="max-width:220px">Mês <input class="field-input" type="month" id="mgf-mes"></label>` : ''}
        <div class="panel"><table class="grid" id="mgf-table"></table></div>
        <div class="modal-actions" style="margin-top:16px">
          <button id="mgf-cancel">Cancelar</button>
          <button class="primary" id="mgf-save">${Icon('check')} Salvar</button>
        </div>
      `;
      const formTable = body.querySelector('#mgf-table');
      const origem = isNew ? null : findRow(mes);
      formTable.innerHTML = `<thead><tr><th>Filial</th><th>${labelWithUnit(metric)}</th></tr></thead>`;
      const tb = document.createElement('tbody');
      for (const f of filiais) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="id-col">${escapeHtml(f)}</td>`;
        const td = document.createElement('td');
        td.className = 'num-cell';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = origem ? Fmt.toEdit(origem[f], metric.format) : '';
        input.dataset.filial = f;
        td.appendChild(input);
        tr.appendChild(td);
        tb.appendChild(tr);
      }
      formTable.appendChild(tb);

      body.querySelector('#mgf-cancel').onclick = close;
      body.querySelector('#mgf-save').onclick = async () => {
        let alvo = mes;
        if (isNew) {
          const val = body.querySelector('#mgf-mes').value;
          if (!val) { toast('Informe o mês.', true); return; }
          alvo = `${val}-01`;
          if (findRow(alvo)) { toast('Esse mês já existe — edite-o na tabela.', true); return; }
        }
        const valores = {};
        formTable.querySelectorAll('input').forEach(inp => {
          valores[inp.dataset.filial] = Fmt.fromEdit(inp.value, metric.format);
        });
        try {
          await gravarMes(alvo, valores);
          toast(isNew ? 'Mês criado.' : 'Mês atualizado.');
          close();
          draw();
        } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  host.querySelector('#btn-new-metric').onclick = () => openForm(null, true);
  draw();
}

// ---------------------------------------------------------------
// Cadastro de premissas "largas" por indicador (Overstaff e Adicionais):
// combo de indicadores + grade mês x filial do indicador selecionado.
// Os botões de modelo de planilha continuam cobrindo TODOS os indicadores do
// cadastro de uma vez (é uma operação em lote — fatiar por indicador só
// multiplicaria o número de arquivos), por isso ficam no shell, fora da grade.
// ---------------------------------------------------------------
async function renderCadastroWidePorIndicador(container, operacao, metrics, meta, templateOpts) {
  const filiais = filiaisDaOperacao(meta, operacao);
  const needsTipo = metrics.some(m => m.hasTipoDimens);
  const tipoDimensMap = needsTipo ? await resolveTipoDimensMap(operacao) : null;
  const tipoFor = (mes) => (tipoDimensMap ? tipoDimensMap.get(mes) : undefined);

  const shell = renderIndicadorShell(container, {
    indicadores: metrics,
    hint: hintFiliais(filiais, meta),
    template: templateOpts ? {
      onDownload: () => downloadMetricGridTemplate(operacao, metrics, filiais, templateOpts.filenamePrefix),
      onUpload: async () => {
        const file = await pickFile('.csv');
        if (file) await importMetricGridTemplate(operacao, file, metrics, meta, () => shell.reload());
      },
    } : null,
    onRender: (metric, host) => renderMetricMonthGrid(host, { operacao, metric, filiais, tipoFor }),
  });
  await shell.reload();
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
  // Só faz sentido (e só é editável) quando há HC Contratado (faturamento por
  // Tempo Logado/Posição, PA fixa) — ver dependsOn abaixo.
  { key: 'ocupacao_garantia', label: 'Ocupação Garantia', format: 'percent', dependsOn: 'hc_contratado' },
];

async function renderDimensDetail(container, operacao) {
  async function load() {
    let rows = (await Api.get('/api/flat/tb_premissas_dimens')).filter(r => r.nom_operacao === operacao);
    rows.sort((a, b) => a.referencia < b.referencia ? -1 : 1);

    container.innerHTML = `
      <div class="toolbar">
        <span class="small">${rows.length} mês(es) cadastrado(s)</span>
        <button class="primary" id="btn-new-dimens">${Icon('plus')} Novo registro</button>
        <button class="icon-btn" id="btn-download-dimens" title="Baixar modelo de planilha">${Icon('download')}</button>
        <button class="icon-btn" id="btn-upload-dimens" title="Importar planilha preenchida">${Icon('upload')}</button>
      </div>
      <div class="panel"><table class="grid" id="dim-table"></table></div>
    `;
    container.querySelector('#btn-download-dimens').onclick = () => downloadDimensTemplate(operacao);
    container.querySelector('#btn-upload-dimens').onclick = async () => {
      const file = await pickFile('.csv');
      if (file) await importDimensTemplate(operacao, file, load);
    };

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

      tr.appendChild(buildAcoesMes({
        onEdit: () => openDimensForm(row, false),
        // Replicacao por intervalo: cada mes de destino e criado ou, se ja
        // existir com o mesmo TIPO_DIMENS, atualizado (a PK de
        // tb_premissas_dimens inclui tipo_dimens, entao meses com mais de um
        // tipo mantem uma linha por tipo).
        onReplicar: () => openReplicarModal(row.referencia, async (meses) => {
          for (const destino of meses) {
            const novo = { ...row, referencia: destino };
            const existente = rows.find(r => r.referencia === destino && r.tipo_dimens === row.tipo_dimens);
            if (existente) { await Api.put('/api/flat/tb_premissas_dimens', novo); Object.assign(existente, novo); }
            else { await Api.post('/api/flat/tb_premissas_dimens', novo); rows.push(novo); }
          }
          rows.sort(byReferencia);
          toast(meses.length === 1
            ? `Replicado para ${Fmt.mes(meses[0])}.`
            : `Replicado para ${meses.length} meses (${Fmt.mes(meses[0])} a ${Fmt.mes(meses[meses.length - 1])}).`);
          draw();
        }),
        onExcluir: async () => {
          if (!confirm(`Excluir ${Fmt.mes(row.referencia)}?`)) return;
          try {
            await Api.del('/api/flat/tb_premissas_dimens', row);
            rows = rows.filter(r => r !== row);
            toast('Mes excluido.');
            draw();
          } catch (e) { toast('Erro ao excluir: ' + e.message, true); }
        },
      }));
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
          ${DIMENS_FIELDS.map(f => {
            const bloqueado = f.dependsOn && !(draft[f.dependsOn] != null && draft[f.dependsOn] !== 0);
            const valor = bloqueado ? '' : Fmt.toEdit(draft[f.key], f.format);
            return `<label class="field-label">${labelWithUnit(f)}
              <input class="field-input" type="text" data-key="${f.key}" value="${valor}" ${bloqueado ? 'disabled title="Só pode ser preenchido quando HC Contratado tiver um valor"' : ''}>
            </label>`;
          }).join('')}
        </div>
        <div class="modal-actions">
          <button id="dim-cancel">Cancelar</button>
          <button class="primary" id="dim-save">${Icon('check')} Salvar</button>
        </div>
      `;

      // Campos com dependsOn só ficam editáveis enquanto o campo do qual
      // dependem tiver valor preenchido (ex.: Ocupação Garantia exige HC
      // Contratado) — limpa e desabilita assim que a dependência esvazia.
      DIMENS_FIELDS.filter(f => f.dependsOn).forEach(f => {
        const depInput = body.querySelector(`[data-key="${f.dependsOn}"]`);
        const depField = DIMENS_FIELDS.find(x => x.key === f.dependsOn);
        const targetInput = body.querySelector(`[data-key="${f.key}"]`);
        depInput.addEventListener('input', () => {
          const val = Fmt.fromEdit(depInput.value, depField ? depField.format : 'number');
          const habilitado = val != null && val !== 0;
          targetInput.disabled = !habilitado;
          if (!habilitado) targetInput.value = '';
        });
      });

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

  await load();
}

// ---------------------------------------------------------------
// Cadastro Premissas Receita: combo de indicadores — Unitário de Faturamento
// (fixo por filial, sem mês) + CPRB / Reajuste / Receita Bodyshop (mensais).
// ---------------------------------------------------------------
const FAT_TIPOS = ['TEMPO LOGADO', 'POSIÇÃO', 'MINUTAGEM', 'EVENTO'];
const UNITARIO_FIELDS = [
  { key: 'unitario_g3', label: 'Unitário G3', format: 'currency' },
  { key: 'abandono', label: 'Abandono', format: 'percent' },
  { key: 'shortcalls', label: 'Shortcalls', format: 'percent' },
];

// Indicadores do combo de Premissas Receita: o Unitário de Faturamento é
// fixo por filial (não tem mês), os outros três são mensais — o combo trata
// os dois casos como "indicador", igual aos demais cadastros.
const RECEITA_INDICADORES = [
  { key: 'unitarios', label: 'Unitário de Faturamento', kind: 'unitarios' },
  ...RECEITA_MONTHLY_METRICS.map(m => ({ ...m, kind: 'mensal' })),
];

async function renderReceitaDetail(container, operacao, meta) {
  const filiais = filiaisDaOperacao(meta, operacao);
  const shell = renderIndicadorShell(container, {
    indicadores: RECEITA_INDICADORES,
    hint: hintFiliais(filiais, meta),
    template: {
      onDownload: () => downloadReceitaTemplate(operacao, filiais),
      onUpload: async () => {
        const file = await pickFile('.csv');
        if (file) await importReceitaTemplate(operacao, file, meta, () => shell.reload());
      },
    },
    onRender: (ind, host) => (ind.kind === 'unitarios'
      ? renderUnitariosTable(host, operacao, filiais)
      : renderMetricMonthGrid(host, { operacao, metric: ind, filiais, tipoFor: () => undefined })),
  });
  await shell.reload();
}

// Unitário de Faturamento: uma linha por filial da operação, sem dimensão de
// mês (tb_unitarios tem PK filial+operacao).
async function renderUnitariosTable(host, operacao, filiais) {
  const unitariosAll = await Api.get('/api/flat/tb_unitarios');

  host.innerHTML = `
    <div class="toolbar"><span class="small">${filiais.length} filial(is) desta operação · valores fixos (não variam por mês)</span></div>
    <div class="panel"><table class="grid" id="unit-table"></table></div>
  `;
  const unitTable = host.querySelector('#unit-table');

  function recFor(f) {
    return unitariosAll.find(u => u.filial === f && u.operacao === operacao)
      || { filial: f, operacao, unitario_g3: null, abandono: null, shortcalls: null, tipo_faturamento: null };
  }

  function draw() {
    unitTable.innerHTML = `<thead><tr><th>Filial</th>${UNITARIO_FIELDS.map(uf => `<th>${labelWithUnit(uf)}</th>`).join('')}<th>Tipo Faturamento</th><th></th></tr></thead>`;
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
          draw();
        } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  draw();
}

// ---------------------------------------------------------------
// Cadastro Distribuição (Volume & HC): um indicador por vez no combo
// (antes as duas grades vinham empilhadas na mesma janela). Linhas = meses,
// colunas = filiais da operação, com total e validação de 100%.
// ---------------------------------------------------------------
const DISTRIBUICAO_INDICADORES = [
  { key: 'volume', table: 'tb_distribuicao_volume', label: 'Distribuição de Volume' },
  { key: 'hc', table: 'tb_distribuicao_hc', label: 'Distribuição de HC' },
];

async function renderDistribuicaoDetail(container, operacao, meta) {
  const filiais = filiaisDaOperacao(meta, operacao);
  const shell = renderIndicadorShell(container, {
    indicadores: DISTRIBUICAO_INDICADORES,
    hint: hintFiliais(filiais, meta),
    template: {
      onDownload: () => downloadDistribuicaoTemplate(operacao, filiais),
      onUpload: async () => {
        const file = await pickFile('.csv');
        if (file) await importDistribuicaoTemplate(operacao, file, meta, () => shell.reload());
      },
    },
    onRender: (ind, host) => renderDistribGrid(host, operacao, ind, filiais),
  });
  await shell.reload();
}

function totalOf(row, filiais) {
  return filiais.reduce((s, f) => s + (Number(row[f]) || 0), 0);
}

async function renderDistribGrid(host, operacao, indicador, filiais) {
  const table = indicador.table;
  const res = await Api.get(`/api/wide/${table}`);
  let rows = res.rows.filter(r => r.nom_operacao === operacao).sort(byReferencia);

  host.innerHTML = `
    <div class="toolbar">
      <span class="small" id="dist-count"></span>
      <button class="primary" id="btn-new-distrib">${Icon('plus')} Novo mês</button>
    </div>
    <div class="panel"><table class="grid" id="dist-table"></table></div>
  `;
  const tableEl = host.querySelector('#dist-table');
  const countEl = host.querySelector('#dist-count');

  function findRow(mes) { return rows.find(r => r.referencia === mes); }

  // Mesma regra do renderMetricMonthGrid: grava todas as filiais visíveis,
  // inclusive as deixadas em branco (viram NULL), para que apagar um % pela
  // tela realmente apague.
  async function gravarMes(mes, valoresPorFilial) {
    await Api.post(`/api/wide/${table}/row`, { referencia: mes, nom_operacao: operacao });
    const cells = filiais.map(f => ({ referencia: mes, nom_operacao: operacao, unidade: f, valor: valoresPorFilial[f] ?? null }));
    await Api.put(`/api/wide/${table}`, { cells });
    let destino = findRow(mes);
    if (!destino) { destino = { referencia: mes, nom_operacao: operacao }; rows.push(destino); rows.sort(byReferencia); }
    filiais.forEach(f => { destino[f] = valoresPorFilial[f] ?? null; });
  }

  async function replicar(mesOrigem, mesesDestino) {
    const origem = findRow(mesOrigem);
    if (!origem) return;
    const valores = {};
    filiais.forEach(f => { valores[f] = origem[f] ?? null; });
    for (const destino of mesesDestino) await gravarMes(destino, valores);
    draw();
    toast(mesesDestino.length === 1
      ? `Replicado para ${Fmt.mes(mesesDestino[0])}.`
      : `Replicado para ${mesesDestino.length} meses (${Fmt.mes(mesesDestino[0])} a ${Fmt.mes(mesesDestino[mesesDestino.length - 1])}).`);
  }

  async function excluirMes(mes) {
    if (!confirm(`Excluir ${Fmt.mes(mes)} de ${indicador.label} nesta operação?`)) return;
    try {
      await Api.del(`/api/wide/${table}/row`, { referencia: mes, nom_operacao: operacao });
      rows = rows.filter(r => r.referencia !== mes);
      toast(`Mês ${Fmt.mes(mes)} excluído.`);
      draw();
    } catch (e) { toast('Erro ao excluir: ' + e.message, true); }
  }

  function draw() {
    countEl.textContent = `${rows.length} mês(es) cadastrado(s) · ${indicador.label}`;
    tableEl.innerHTML = `<thead><tr><th>Mês</th>${filiais.map(f => `<th>${escapeHtml(f)} (%)</th>`).join('')}<th>Total (%)</th><th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${filiais.length + 3}"><div class="empty-state">Nenhum mês cadastrado em ${escapeHtml(indicador.label)}. Use "Novo mês" para começar.</div></td></tr>`;
    }
    for (const row of rows) {
      const mes = row.referencia;
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      const total = totalOf(row, filiais);
      tr.innerHTML = `<td class="id-col">${Fmt.mes(mes)}</td>` +
        filiais.map(f => `<td>${escapeHtml(Fmt.display(row[f], 'percent'))}</td>`).join('') +
        `<td class="${Math.abs(total - 1) < 0.001 ? 'total-ok' : 'total-bad'}">${(total * 100).toFixed(1)}%</td>`;
      tr.onclick = (e) => { if (!e.target.closest('button')) openDistribForm(mes, false); };
      tr.appendChild(buildAcoesMes({
        onEdit: () => openDistribForm(mes, false),
        onReplicar: () => openReplicarModal(mes, (meses) => replicar(mes, meses)),
        onExcluir: () => excluirMes(mes),
      }));
      tbody.appendChild(tr);
    }
    tableEl.appendChild(tbody);
  }

  function openDistribForm(mes, isNew) {
    const origem = isNew ? null : findRow(mes);
    const titulo = isNew
      ? `Novo mês · ${indicador.label} · ${operacao}`
      : `${Fmt.mes(mes)} · ${indicador.label} · ${operacao}`;
    openModal(titulo, (body, close) => {
      body.innerHTML = `
        ${isNew ? `<label class="field-label" style="max-width:220px;margin-bottom:16px">Mês <input class="field-input" type="month" id="distrib-mes"></label>` : ''}
        <div class="field-grid">
          ${filiais.map(f => `
            <label class="field-label">${escapeHtml(f)} (%)
              <input class="field-input" type="text" data-filial="${escapeHtml(f)}" value="${origem ? Fmt.toEdit(origem[f], 'percent') : ''}">
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
        let alvo = mes;
        if (isNew) {
          const val = body.querySelector('#distrib-mes').value;
          if (!val) { toast('Informe o mês.', true); return; }
          alvo = `${val}-01`;
          if (findRow(alvo)) { toast('Esse mês já existe — edite-o na tabela.', true); return; }
        }
        const valores = {};
        body.querySelectorAll('[data-filial]').forEach(inp => {
          valores[inp.dataset.filial] = Fmt.fromEdit(inp.value, 'percent');
        });
        try {
          await gravarMes(alvo, valores);
          toast(isNew ? 'Mês criado.' : 'Mês atualizado.');
          close();
          draw();
        } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  host.querySelector('#btn-new-distrib').onclick = () => openDistribForm(null, true);
  draw();
}

// ---------------------------------------------------------------
// Cadastro Ajuste Premissas (sem filial, mesma granularidade do
// Dimensionamento): % de incremento/redução a aplicar sobre Volume, TMA e
// Pausa em cada mês projetado da operação, quebrando a herança estática do
// mês-base na cadeia de projeção. Um ajuste por vez no combo de indicadores.
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
  const mesBase = await resolveMesBase(operacao);
  const shell = renderIndicadorShell(container, {
    indicadores: AJUSTE_FIELDS,
    hint: mesBase ? `Só tem efeito nos meses projetados, depois de ${Fmt.mes(mesBase)}` : '',
    template: {
      onDownload: () => downloadAjusteTemplate(operacao),
      onUpload: async () => {
        const file = await pickFile('.csv');
        if (file) await importAjusteTemplate(operacao, file, () => shell.reload());
      },
    },
    onRender: (campo, host) => renderAjusteGrid(host, operacao, campo, mesBase),
  });
  await shell.reload();
}

// Grade de UM ajuste (Volume, TMA ou Pausa). Diferente dos outros cadastros,
// Ajuste de Premissas não tem dimensão de filial — tb_ajuste_premissas tem
// PK (referencia, nom_operacao) — então a grade é mês x valor.
// Os três ajustes de um mês moram na MESMA linha do banco: gravar um deles
// preserva os outros dois (leitura-alteração-gravação), e excluir o mês
// remove os três de uma vez.
async function renderAjusteGrid(host, operacao, campo, mesBase) {
  let rows = (await Api.get('/api/flat/tb_ajuste_premissas'))
    .filter(r => r.nom_operacao === operacao)
    .sort(byReferencia);
  const semEfeito = (mes) => mesBase == null || mes <= mesBase;

  host.innerHTML = `
    <div class="toolbar">
      <span class="small" id="aj-count"></span>
      <button class="primary" id="btn-new-ajuste">${Icon('plus')} Novo mês</button>
    </div>
    ${mesBase ? `<div class="empty-state" style="text-align:left;margin-bottom:12px">${Icon('circle-alert')} Ajustes só têm efeito nos meses <strong>projetados</strong> (após ${Fmt.mes(mesBase)}). ${Fmt.mes(mesBase)} e meses anteriores são dados reais e ignoram o ajuste.</div>` : ''}
    <div class="panel"><table class="grid" id="aj-table"></table></div>
  `;
  const tableEl = host.querySelector('#aj-table');
  const countEl = host.querySelector('#aj-count');

  function findRow(mes) { return rows.find(r => r.referencia === mes); }

  async function gravarCampo(mes, valor) {
    const existente = findRow(mes);
    if (existente) {
      const payload = { ...existente, [campo.key]: valor };
      await Api.put('/api/flat/tb_ajuste_premissas', payload);
      Object.assign(existente, payload);
    } else {
      const payload = { referencia: mes, nom_operacao: operacao };
      AJUSTE_FIELDS.forEach(f => { payload[f.key] = null; });
      payload[campo.key] = valor;
      await Api.post('/api/flat/tb_ajuste_premissas', payload);
      rows.push(payload);
      rows.sort(byReferencia);
    }
  }

  async function replicar(mesOrigem, mesesDestino) {
    const origem = findRow(mesOrigem);
    if (!origem) return;
    const valor = origem[campo.key] ?? null;
    for (const destino of mesesDestino) await gravarCampo(destino, valor);
    draw();
    toast(mesesDestino.length === 1
      ? `Replicado para ${Fmt.mes(mesesDestino[0])}.`
      : `Replicado para ${mesesDestino.length} meses (${Fmt.mes(mesesDestino[0])} a ${Fmt.mes(mesesDestino[mesesDestino.length - 1])}).`);
  }

  async function excluirMes(mes) {
    if (!confirm(`Excluir ${Fmt.mes(mes)}? Remove os três ajustes (Volume, TMA e Pausa) desse mês.`)) return;
    try {
      await Api.del('/api/flat/tb_ajuste_premissas', { referencia: mes, nom_operacao: operacao });
      rows = rows.filter(r => r.referencia !== mes);
      toast('Mês excluído.');
      draw();
    } catch (e) { toast('Erro ao excluir: ' + e.message, true); }
  }

  function draw() {
    countEl.textContent = `${rows.length} mês(es) cadastrado(s) · ${campo.label}`;
    tableEl.innerHTML = `<thead><tr><th>Mês</th><th>${labelWithUnit(campo)}</th><th></th><th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">Nenhum mês cadastrado. Use "Novo mês" para começar.</div></td></tr>`;
    }
    for (const row of rows) {
      const mes = row.referencia;
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML = `<td class="id-col">${Fmt.mes(mes)}</td>` +
        `<td>${escapeHtml(Fmt.display(row[campo.key], campo.format))}</td>` +
        `<td class="small">${semEfeito(mes) ? 'Sem efeito (mês real)' : ''}</td>`;
      tr.onclick = (e) => { if (!e.target.closest('button')) openAjusteForm(mes, false); };
      tr.appendChild(buildAcoesMes({
        onEdit: () => openAjusteForm(mes, false),
        onReplicar: () => openReplicarModal(mes, (meses) => replicar(mes, meses)),
        onExcluir: () => excluirMes(mes),
      }));
      tbody.appendChild(tr);
    }
    tableEl.appendChild(tbody);
  }

  function openAjusteForm(mes, isNew) {
    const origem = isNew ? null : findRow(mes);
    const titulo = isNew
      ? `Novo mês · ${campo.label} · ${operacao}`
      : `${Fmt.mes(mes)} · ${campo.label} · ${operacao}`;
    openModal(titulo, (body, close) => {
      body.innerHTML = `
        <div class="field-grid">
          ${isNew ? `<label class="field-label">Mês <input class="field-input" type="month" id="aj-mes"></label>` : ''}
          <label class="field-label">${labelWithUnit(campo)}
            <input class="field-input" type="text" id="aj-valor" value="${origem ? Fmt.toEdit(origem[campo.key], campo.format) : ''}">
          </label>
        </div>
        <div class="modal-actions">
          <button id="aj-cancel">Cancelar</button>
          <button class="primary" id="aj-save">${Icon('check')} Salvar</button>
        </div>
      `;
      body.querySelector('#aj-cancel').onclick = close;
      body.querySelector('#aj-save').onclick = async () => {
        let alvo = mes;
        if (isNew) {
          const val = body.querySelector('#aj-mes').value;
          if (!val) { toast('Informe o mês.', true); return; }
          alvo = `${val}-01`;
        }
        const valor = Fmt.fromEdit(body.querySelector('#aj-valor').value, campo.format);
        try {
          await gravarCampo(alvo, valor);
          toast(isNew ? 'Mês criado.' : 'Mês atualizado.');
          if (semEfeito(alvo)) {
            toast(`Aviso: ${Fmt.mes(alvo)} é mês-base ou anterior (dado real) — este ajuste não altera nenhum cálculo.`, true);
          }
          close();
          draw();
        } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  host.querySelector('#btn-new-ajuste').onclick = () => openAjusteForm(null, true);
  draw();
}

// ---------------------------------------------------------------
// Modelo de planilha (download/upload) por operação — permite cadastrar
// vários meses de uma vez, em vez de mês a mês pelo formulário. Os botões
// ficam dentro do frame de cada operação (toolbar dos render*Detail acima),
// não na lista de operações.
//
// Baixar modelo: gera um .csv (abre direto no Excel) com o layout esperado
// (cabeçalho) e, quando já há dados cadastrados para a operação, com todos
// eles — nunca um recorte por período.
// Importar planilha: lê o .csv escolhido, valida linha a linha (formato de
// mês, tipos numéricos, colunas esperadas) e só grava alguma coisa se NÃO
// houver nenhum erro — em caso de erro, lista tudo ao usuário e não
// executa nenhuma gravação.
// ---------------------------------------------------------------
function sanitizeFileName(s) {
  return s.replace(/[\\/:*?"<>|]+/g, '_');
}

// Abre o seletor de arquivo do sistema operacional e resolve com o File
// escolhido (ou null se o usuário cancelar — o evento 'cancel' nem sempre
// dispara em todos os navegadores, então isso fica pendente até o próximo
// clique nesse caso raro, sem efeito colateral).
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files[0] || null);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

function showImportErrors(title, errors) {
  openModal(title, (body, close) => {
    body.innerHTML = `
      <div class="empty-state" style="text-align:left;margin-bottom:16px">${Icon('circle-alert')} A planilha não está no padrão esperado. Corrija os itens abaixo e importe novamente — nada foi salvo.</div>
      <ul class="import-error-list">${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
      <div class="modal-actions"><button class="primary" id="import-err-close">Fechar</button></div>
    `;
    body.querySelector('#import-err-close').onclick = close;
  }, { size: 'form' });
}

function csvCell(row, idx) {
  return row && row[idx] != null ? String(row[idx]).trim() : '';
}

// "AAAA-MM" (texto do modelo) <-> "AAAA-MM-01" (referencia salva no banco).
function parseMonthCell(text) {
  const s = (text || '').trim();
  const m = s.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}
function monthCellText(referencia) {
  return referencia ? referencia.slice(0, 7) : '';
}

// Mesma convenção de Fmt.fromEdit (percentual digitado como "5,5" -> 0.055),
// mas reporta erro em vez de engolir silenciosamente um texto não numérico.
function parseNumberCell(text, format) {
  const s = (text || '').trim();
  if (s === '') return { value: null, error: null };
  const n = Number(s.replace(',', '.'));
  if (Number.isNaN(n)) return { value: undefined, error: `valor numérico inválido: "${s}"` };
  return { value: format === 'percent' ? n / 100 : n, error: null };
}

// Separa um CSV com várias tabelas em uma seção por marcador de linha
// "## NOME" (usado por Receita e Distribuição, que têm mais de uma grade).
function splitCsvSections(rows) {
  const sections = {};
  let current = null;
  for (const row of rows) {
    const first = csvCell(row, 0);
    if (first.startsWith('## ')) { current = first.slice(3).trim(); sections[current] = []; continue; }
    if (current) sections[current].push(row);
  }
  return sections;
}

// ---- Grade métrica x filial (Overstaff, Adicionais, parte mensal de Receita) ----
// Cabeçalho em duas linhas: linha 1 = rótulo da métrica (só na 1ª coluna do
// grupo), linha 2 = filial. O modelo de planilha continua trazendo TODOS os
// indicadores do cadastro de uma vez, mesmo a tela mostrando um por vez.
function buildMetricGridTemplateRows(metrics, filiais, dataByMetric, months) {
  const row1 = ['Mês (AAAA-MM)'];
  const row2 = [''];
  metrics.forEach(m => {
    filiais.forEach((f, i) => {
      row1.push(i === 0 ? labelWithUnit(m) : '');
      row2.push(f);
    });
  });
  const dataRows = months.map(mes => {
    const row = [monthCellText(mes)];
    metrics.forEach(m => {
      const rec = dataByMetric[m.key].find(r => r.referencia === mes);
      filiais.forEach(f => row.push(rec ? Fmt.toEdit(rec[f], m.format) : ''));
    });
    return row;
  });
  return [row1, row2, ...dataRows];
}

function parseMetricGridRows(rows, metrics, filiais, sectionLabel) {
  const prefix = sectionLabel ? `${sectionLabel} · ` : '';
  const errors = [];
  if (rows.length < 2) return { errors: [`${prefix}faltam as linhas de cabeçalho esperadas (métrica e filial).`], byMonth: [] };
  const row1 = rows[0], row2 = rows[1];
  const width = Math.max(row1.length, row2.length);
  const cols = [];
  let currentMetricLabel = '';
  for (let c = 1; c < width; c++) {
    if (csvCell(row1, c)) currentMetricLabel = csvCell(row1, c);
    const filial = csvCell(row2, c);
    if (!currentMetricLabel && !filial) continue;
    const metric = metrics.find(m => labelWithUnit(m) === currentMetricLabel);
    if (!metric) { errors.push(`${prefix}coluna ${c + 1}: métrica "${currentMetricLabel}" não reconhecida.`); continue; }
    if (!filial) { errors.push(`${prefix}coluna ${c + 1}: falta o nome da filial abaixo de "${currentMetricLabel}".`); continue; }
    if (!filiais.includes(filial)) { errors.push(`${prefix}coluna ${c + 1}: filial "${filial}" não cadastrada.`); continue; }
    cols.push({ index: c, metric, filial });
  }
  if (errors.length) return { errors, byMonth: [] };

  const dataRows = rows.slice(2);
  const byMonth = [];
  const seen = new Set();
  dataRows.forEach((row, idx) => {
    const lineNo = idx + 3;
    const mesText = csvCell(row, 0);
    const isBlank = !mesText && cols.every(cc => !csvCell(row, cc.index));
    if (isBlank) return;
    const referencia = parseMonthCell(mesText);
    if (!referencia) { errors.push(`${prefix}linha ${lineNo}: mês inválido "${mesText}" (use o formato AAAA-MM).`); return; }
    if (seen.has(referencia)) { errors.push(`${prefix}linha ${lineNo}: mês ${mesText} duplicado no arquivo.`); return; }
    seen.add(referencia);
    const cells = {};
    cols.forEach(cc => {
      const { value, error } = parseNumberCell(csvCell(row, cc.index), cc.metric.format);
      if (error) { errors.push(`${prefix}linha ${lineNo}, coluna "${labelWithUnit(cc.metric)} / ${cc.filial}": ${error}`); return; }
      if (value == null) return;
      if (!cells[cc.metric.key]) cells[cc.metric.key] = {};
      cells[cc.metric.key][cc.filial] = value;
    });
    byMonth.push({ referencia, cells });
  });
  return { errors, byMonth };
}

async function loadMetricGridData(metrics, operacao) {
  const dataByMetric = {};
  const monthsSet = new Set();
  for (const m of metrics) {
    const res = await Api.get(`/api/wide/${m.table}`);
    dataByMetric[m.key] = res.rows.filter(r => r.nom_operacao === operacao);
    dataByMetric[m.key].forEach(r => monthsSet.add(r.referencia));
  }
  return { dataByMetric, monthsSet };
}

async function downloadMetricGridTemplate(operacao, metrics, filiais, filenamePrefix) {
  const { dataByMetric, monthsSet } = await loadMetricGridData(metrics, operacao);
  const months = [...monthsSet].sort();
  const csvRows = buildMetricGridTemplateRows(metrics, filiais, dataByMetric, months);
  ExportUtil.downloadCsv(`modelo_${filenamePrefix}_${sanitizeFileName(operacao)}.csv`, csvRows);
  toast('Modelo baixado.');
}

async function importMetricGridTemplate(operacao, file, metrics, meta, reload) {
  const text = await file.text();
  const { errors, byMonth } = parseMetricGridRows(ExportUtil.parseCsv(text), metrics, meta.filiais);
  if (errors.length) { showImportErrors(`Erros na planilha · ${operacao}`, errors); return; }
  if (!byMonth.length) { toast('Nenhum registro para importar (planilha sem dados preenchidos).', true); return; }

  const needsTipo = metrics.some(m => m.hasTipoDimens);
  const tipoDimensMap = needsTipo ? await resolveTipoDimensMap(operacao) : null;
  if (needsTipo) {
    const tipoErrors = [];
    byMonth.forEach(({ referencia, cells }) => {
      const precisaTipo = metrics.some(m => m.hasTipoDimens && cells[m.key] && Object.keys(cells[m.key]).length);
      if (precisaTipo && tipoDimensMap.get(referencia) == null) {
        tipoErrors.push(`Mês ${monthCellText(referencia)}: não há TIPO_DIMENS cadastrado em Dimensionamento para esse mês — cadastre o Dimensionamento desta operação antes de importar.`);
      }
    });
    if (tipoErrors.length) { showImportErrors(`Erros na planilha · ${operacao}`, tipoErrors); return; }
  }

  if (!confirm(`Importar ${byMonth.length} mês(es) para "${operacao}"? Meses já cadastrados serão atualizados.`)) return;
  try {
    for (const { referencia, cells } of byMonth) {
      for (const m of metrics) {
        const filialValues = cells[m.key];
        if (!filialValues || !Object.keys(filialValues).length) continue;
        const tipo = m.hasTipoDimens ? tipoDimensMap.get(referencia) : undefined;
        await Api.post(`/api/wide/${m.table}/row`, { referencia, tipo_dimens: tipo, nom_operacao: operacao });
        const putCells = Object.entries(filialValues).map(([unidade, valor]) => ({ referencia, tipo_dimens: tipo, nom_operacao: operacao, unidade, valor }));
        await Api.put(`/api/wide/${m.table}`, { cells: putCells });
      }
    }
    toast(`${byMonth.length} mês(es) importado(s).`);
    await reload();
  } catch (e) { toast('Erro ao importar: ' + e.message, true); }
}

// ---- Grade filial única (Distribuição de Volume e de HC) ----
function buildSingleFilialGridRows(filiais, rowsData, months) {
  const header = ['Mês (AAAA-MM)', ...filiais.map(f => `${f} (%)`)];
  const dataRows = months.map(mes => {
    const rec = rowsData.find(r => r.referencia === mes);
    return [monthCellText(mes), ...filiais.map(f => (rec ? Fmt.toEdit(rec[f], 'percent') : ''))];
  });
  return [header, ...dataRows];
}

function parseSingleFilialGridRows(rows, filiais, sectionLabel) {
  const prefix = sectionLabel ? `${sectionLabel} · ` : '';
  const errors = [];
  if (rows.length < 1) return { errors: [`${prefix}falta a linha de cabeçalho.`], byMonth: [] };
  const header = rows[0];
  const cols = [];
  for (let c = 1; c < header.length; c++) {
    const raw = csvCell(header, c).replace(/\s*\(%\)\s*$/, '').trim();
    if (!raw) continue;
    if (!filiais.includes(raw)) { errors.push(`${prefix}coluna ${c + 1}: filial "${raw}" não cadastrada.`); continue; }
    cols.push({ index: c, filial: raw });
  }
  if (errors.length) return { errors, byMonth: [] };

  const dataRows = rows.slice(1);
  const byMonth = [];
  const seen = new Set();
  dataRows.forEach((row, idx) => {
    const lineNo = idx + 2;
    const mesText = csvCell(row, 0);
    const isBlank = !mesText && cols.every(cc => !csvCell(row, cc.index));
    if (isBlank) return;
    const referencia = parseMonthCell(mesText);
    if (!referencia) { errors.push(`${prefix}linha ${lineNo}: mês inválido "${mesText}" (use o formato AAAA-MM).`); return; }
    if (seen.has(referencia)) { errors.push(`${prefix}linha ${lineNo}: mês ${mesText} duplicado no arquivo.`); return; }
    seen.add(referencia);
    const cells = {};
    cols.forEach(cc => {
      const { value, error } = parseNumberCell(csvCell(row, cc.index), 'percent');
      if (error) { errors.push(`${prefix}linha ${lineNo}, coluna "${cc.filial}": ${error}`); return; }
      if (value != null) cells[cc.filial] = value;
    });
    byMonth.push({ referencia, cells });
  });
  return { errors, byMonth };
}

async function importSingleFilialGrid(table, operacao, byMonth) {
  for (const { referencia, cells } of byMonth) {
    if (!Object.keys(cells).length) continue;
    await Api.post(`/api/wide/${table}/row`, { referencia, nom_operacao: operacao });
    const putCells = Object.entries(cells).map(([unidade, valor]) => ({ referencia, nom_operacao: operacao, unidade, valor }));
    await Api.put(`/api/wide/${table}`, { cells: putCells });
  }
}

// ---- Cadastro Dimensionamento (flat, várias linhas por mês via tipo_dimens) ----
// Sem filtro de ano: exporta o layout esperado (cabeçalho) e, se já houver
// dados cadastrados, todos eles — nunca um recorte.
function buildDimensTemplateRows(rows) {
  const header = ['Mês (AAAA-MM)', 'Tipo (TIPO_DIMENS)', ...DIMENS_FIELDS.map(labelWithUnit)];
  const sorted = rows.slice().sort((a, b) => (a.referencia < b.referencia ? -1 : a.referencia > b.referencia ? 1 : (a.tipo_dimens < b.tipo_dimens ? -1 : 1)));
  const dataRows = sorted.map(r => [monthCellText(r.referencia), r.tipo_dimens, ...DIMENS_FIELDS.map(f => Fmt.toEdit(r[f.key], f.format))]);
  return [header, ...dataRows];
}

async function downloadDimensTemplate(operacao) {
  const rows = (await Api.get('/api/flat/tb_premissas_dimens')).filter(r => r.nom_operacao === operacao);
  ExportUtil.downloadCsv(`modelo_dimensionamento_${sanitizeFileName(operacao)}.csv`, buildDimensTemplateRows(rows));
  toast('Modelo baixado.');
}

function parseDimensTemplate(text) {
  const rows = ExportUtil.parseCsv(text);
  if (rows.length < 1) return { errors: ['Arquivo vazio ou ilegível.'], records: [] };
  const dataRows = rows.slice(1);
  const errors = [];
  const records = [];
  const seen = new Set();
  dataRows.forEach((row, idx) => {
    const lineNo = idx + 2;
    const mesText = csvCell(row, 0);
    const tipo = csvCell(row, 1);
    const isBlank = !mesText && !tipo && DIMENS_FIELDS.every((f, i) => !csvCell(row, 2 + i));
    if (isBlank) return;
    const referencia = parseMonthCell(mesText);
    if (!referencia) { errors.push(`Linha ${lineNo}: mês inválido "${mesText}" (use o formato AAAA-MM).`); return; }
    if (!tipo) { errors.push(`Linha ${lineNo}: falta o Tipo (TIPO_DIMENS).`); return; }
    const key = `${referencia}|${tipo}`;
    if (seen.has(key)) { errors.push(`Linha ${lineNo}: mês ${mesText} + tipo "${tipo}" duplicado no arquivo.`); return; }
    seen.add(key);
    const rec = { referencia, tipo_dimens: tipo };
    DIMENS_FIELDS.forEach((f, i) => {
      const { value, error } = parseNumberCell(csvCell(row, 2 + i), f.format);
      if (error) errors.push(`Linha ${lineNo}, coluna "${labelWithUnit(f)}": ${error}`);
      else rec[f.key] = value;
    });
    if (rec.ocupacao_garantia != null && !(rec.hc_contratado != null && rec.hc_contratado !== 0)) rec.ocupacao_garantia = null;
    records.push(rec);
  });
  return { errors, records };
}

async function importDimensTemplate(operacao, file, reload) {
  const text = await file.text();
  const { errors, records } = parseDimensTemplate(text);
  if (errors.length) { showImportErrors(`Erros na planilha · ${operacao}`, errors); return; }
  if (!records.length) { toast('Nenhum registro para importar (planilha sem dados preenchidos).', true); return; }
  if (!confirm(`Importar ${records.length} mês(es) para "${operacao}"? Meses já cadastrados serão atualizados.`)) return;
  try {
    const existing = (await Api.get('/api/flat/tb_premissas_dimens')).filter(r => r.nom_operacao === operacao);
    const existingKeys = new Set(existing.map(r => `${r.referencia}|${r.tipo_dimens}`));
    for (const rec of records) {
      const payload = { ...rec, nom_operacao: operacao };
      if (existingKeys.has(`${rec.referencia}|${rec.tipo_dimens}`)) await Api.put('/api/flat/tb_premissas_dimens', payload);
      else await Api.post('/api/flat/tb_premissas_dimens', payload);
    }
    toast(`${records.length} mês(es) importado(s).`);
    await reload();
  } catch (e) { toast('Erro ao importar: ' + e.message, true); }
}

// ---- Cadastro Premissas Receita (Unitários por filial + grade mensal) ----
async function downloadReceitaTemplate(operacao, filiais) {
  const unitariosAll = await Api.get('/api/flat/tb_unitarios');
  const unitRows = filiais.map(f => {
    const rec = unitariosAll.find(u => u.filial === f && u.operacao === operacao) || {};
    return [f, ...UNITARIO_FIELDS.map(uf => Fmt.toEdit(rec[uf.key], uf.format)), rec.tipo_faturamento || ''];
  });
  const { dataByMetric, monthsSet } = await loadMetricGridData(RECEITA_MONTHLY_METRICS, operacao);
  const months = [...monthsSet].sort();

  const csvRows = [
    ['## UNITARIOS'],
    ['Filial', ...UNITARIO_FIELDS.map(labelWithUnit), 'Tipo Faturamento'],
    ...unitRows,
    [],
    ['## MENSAL'],
    ...buildMetricGridTemplateRows(RECEITA_MONTHLY_METRICS, filiais, dataByMetric, months),
  ];
  ExportUtil.downloadCsv(`modelo_premissas_receita_${sanitizeFileName(operacao)}.csv`, csvRows);
  toast('Modelo baixado.');
}

function parseReceitaTemplate(text, filiais) {
  const rows = ExportUtil.parseCsv(text);
  const sections = splitCsvSections(rows);
  const errors = [];
  if (!sections['UNITARIOS'] || !sections['MENSAL']) {
    return { errors: ['Arquivo não contém as seções "## UNITARIOS" e "## MENSAL" esperadas — baixe o modelo novamente e preencha por cima dele.'], unitarios: [], mensal: { byMonth: [] } };
  }
  const uRows = sections['UNITARIOS'].slice(1);
  const unitarios = [];
  const seenFil = new Set();
  uRows.forEach((row, idx) => {
    const filial = csvCell(row, 0);
    if (!filial) return;
    const lineNo = idx + 1;
    if (!filiais.includes(filial)) { errors.push(`UNITARIOS · linha ${lineNo}: filial "${filial}" não cadastrada.`); return; }
    if (seenFil.has(filial)) { errors.push(`UNITARIOS · linha ${lineNo}: filial "${filial}" duplicada.`); return; }
    seenFil.add(filial);
    const rec = { filial };
    UNITARIO_FIELDS.forEach((uf, i) => {
      const { value, error } = parseNumberCell(csvCell(row, 1 + i), uf.format);
      if (error) errors.push(`UNITARIOS · linha ${lineNo}, coluna "${labelWithUnit(uf)}": ${error}`);
      else rec[uf.key] = value;
    });
    const tipoFat = csvCell(row, 1 + UNITARIO_FIELDS.length);
    if (tipoFat && !FAT_TIPOS.includes(tipoFat)) errors.push(`UNITARIOS · linha ${lineNo}: Tipo Faturamento "${tipoFat}" inválido (use um destes: ${FAT_TIPOS.join(', ')}).`);
    else rec.tipo_faturamento = tipoFat || null;
    unitarios.push(rec);
  });

  const { errors: mErrors, byMonth } = parseMetricGridRows(sections['MENSAL'], RECEITA_MONTHLY_METRICS, filiais, 'MENSAL');
  errors.push(...mErrors);
  return { errors, unitarios, mensal: { byMonth } };
}

async function importReceitaTemplate(operacao, file, meta, reload) {
  const text = await file.text();
  const { errors, unitarios, mensal } = parseReceitaTemplate(text, meta.filiais);
  if (errors.length) { showImportErrors(`Erros na planilha · ${operacao}`, errors); return; }
  if (!unitarios.length && !mensal.byMonth.length) { toast('Nenhum registro para importar (planilha sem dados preenchidos).', true); return; }
  if (!confirm(`Importar ${unitarios.length} filial(is) de Unitários e ${mensal.byMonth.length} mês(es) da grade mensal para "${operacao}"? Dados já cadastrados serão atualizados.`)) return;
  try {
    const unitariosAll = await Api.get('/api/flat/tb_unitarios');
    for (const rec of unitarios) {
      const payload = { ...rec, operacao };
      const already = unitariosAll.some(u => u.filial === rec.filial && u.operacao === operacao);
      if (already) await Api.put('/api/flat/tb_unitarios', payload);
      else await Api.post('/api/flat/tb_unitarios', payload);
    }
    for (const { referencia, cells } of mensal.byMonth) {
      for (const m of RECEITA_MONTHLY_METRICS) {
        const filialValues = cells[m.key];
        if (!filialValues || !Object.keys(filialValues).length) continue;
        await Api.post(`/api/wide/${m.table}/row`, { referencia, nom_operacao: operacao });
        const putCells = Object.entries(filialValues).map(([unidade, valor]) => ({ referencia, nom_operacao: operacao, unidade, valor }));
        await Api.put(`/api/wide/${m.table}`, { cells: putCells });
      }
    }
    toast('Premissas de Receita importadas.');
    await reload();
  } catch (e) { toast('Erro ao importar: ' + e.message, true); }
}

// ---- Cadastro Distribuição (Volume % + HC %, por filial e por mês) ----
async function downloadDistribuicaoTemplate(operacao, filiais) {
  const [vol, hc] = await Promise.all([
    Api.get('/api/wide/tb_distribuicao_volume'),
    Api.get('/api/wide/tb_distribuicao_hc'),
  ]);
  const volRows = vol.rows.filter(r => r.nom_operacao === operacao);
  const hcRows = hc.rows.filter(r => r.nom_operacao === operacao);
  const monthsSet = new Set([...volRows, ...hcRows].map(r => r.referencia));
  const months = [...monthsSet].sort();

  const csvRows = [
    ['## VOLUME'],
    ...buildSingleFilialGridRows(filiais, volRows, months),
    [],
    ['## HC'],
    ...buildSingleFilialGridRows(filiais, hcRows, months),
  ];
  ExportUtil.downloadCsv(`modelo_distribuicao_${sanitizeFileName(operacao)}.csv`, csvRows);
  toast('Modelo baixado.');
}

function parseDistribuicaoTemplate(text, filiais) {
  const rows = ExportUtil.parseCsv(text);
  const sections = splitCsvSections(rows);
  if (!sections['VOLUME'] || !sections['HC']) {
    return { errors: ['Arquivo não contém as seções "## VOLUME" e "## HC" esperadas — baixe o modelo novamente e preencha por cima dele.'], volume: [], hc: [] };
  }
  const { errors: vErr, byMonth: volume } = parseSingleFilialGridRows(sections['VOLUME'], filiais, 'VOLUME');
  const { errors: hErr, byMonth: hc } = parseSingleFilialGridRows(sections['HC'], filiais, 'HC');
  return { errors: [...vErr, ...hErr], volume, hc };
}

async function importDistribuicaoTemplate(operacao, file, meta, reload) {
  const text = await file.text();
  const { errors, volume, hc } = parseDistribuicaoTemplate(text, meta.filiais);
  if (errors.length) { showImportErrors(`Erros na planilha · ${operacao}`, errors); return; }
  const total = volume.length + hc.length;
  if (!total) { toast('Nenhum registro para importar (planilha sem dados preenchidos).', true); return; }
  if (!confirm(`Importar ${volume.length} mês(es) de Volume e ${hc.length} mês(es) de HC para "${operacao}"? Meses já cadastrados serão atualizados.`)) return;
  try {
    await importSingleFilialGrid('tb_distribuicao_volume', operacao, volume);
    await importSingleFilialGrid('tb_distribuicao_hc', operacao, hc);
    toast('Distribuição importada.');
    await reload();
  } catch (e) { toast('Erro ao importar: ' + e.message, true); }
}

// ---- Cadastro Ajuste de Premissas (flat, uma linha por mês) ----
function buildAjusteTemplateRows(rows) {
  const header = ['Mês (AAAA-MM)', ...AJUSTE_FIELDS.map(labelWithUnit)];
  const dataRows = rows.slice().sort((a, b) => (a.referencia < b.referencia ? -1 : 1))
    .map(r => [monthCellText(r.referencia), ...AJUSTE_FIELDS.map(f => Fmt.toEdit(r[f.key], f.format))]);
  return [header, ...dataRows];
}

async function downloadAjusteTemplate(operacao) {
  const rows = (await Api.get('/api/flat/tb_ajuste_premissas')).filter(r => r.nom_operacao === operacao);
  ExportUtil.downloadCsv(`modelo_ajuste_premissas_${sanitizeFileName(operacao)}.csv`, buildAjusteTemplateRows(rows));
  toast('Modelo baixado.');
}

function parseAjusteTemplate(text) {
  const rows = ExportUtil.parseCsv(text);
  if (rows.length < 1) return { errors: ['Arquivo vazio ou ilegível.'], records: [] };
  const dataRows = rows.slice(1);
  const errors = [];
  const records = [];
  const seen = new Set();
  dataRows.forEach((row, idx) => {
    const lineNo = idx + 2;
    const mesText = csvCell(row, 0);
    const isBlank = !mesText && AJUSTE_FIELDS.every((f, i) => !csvCell(row, 1 + i));
    if (isBlank) return;
    const referencia = parseMonthCell(mesText);
    if (!referencia) { errors.push(`Linha ${lineNo}: mês inválido "${mesText}" (use o formato AAAA-MM).`); return; }
    if (seen.has(referencia)) { errors.push(`Linha ${lineNo}: mês ${mesText} duplicado no arquivo.`); return; }
    seen.add(referencia);
    const rec = { referencia };
    AJUSTE_FIELDS.forEach((f, i) => {
      const { value, error } = parseNumberCell(csvCell(row, 1 + i), f.format);
      if (error) errors.push(`Linha ${lineNo}, coluna "${labelWithUnit(f)}": ${error}`);
      else rec[f.key] = value;
    });
    records.push(rec);
  });
  return { errors, records };
}

async function importAjusteTemplate(operacao, file, reload) {
  const text = await file.text();
  const { errors, records } = parseAjusteTemplate(text);
  if (errors.length) { showImportErrors(`Erros na planilha · ${operacao}`, errors); return; }
  if (!records.length) { toast('Nenhum registro para importar (planilha sem dados preenchidos).', true); return; }
  if (!confirm(`Importar ${records.length} mês(es) para "${operacao}"? Meses já cadastrados serão atualizados.`)) return;
  try {
    const existing = (await Api.get('/api/flat/tb_ajuste_premissas')).filter(r => r.nom_operacao === operacao);
    const existingSet = new Set(existing.map(r => r.referencia));
    for (const rec of records) {
      const payload = { ...rec, nom_operacao: operacao };
      if (existingSet.has(rec.referencia)) await Api.put('/api/flat/tb_ajuste_premissas', payload);
      else await Api.post('/api/flat/tb_ajuste_premissas', payload);
    }
    toast(`${records.length} mês(es) importado(s).`);
    await reload();
  } catch (e) { toast('Erro ao importar: ' + e.message, true); }
}

// ---------------------------------------------------------------
// Páginas de topo (lista + abertura do modal)
// ---------------------------------------------------------------
// Evita que o reload disparado pelo fechamento do frame (opts.onClose)
// sobrescreva outra página: o modal fica sobre #page-body mas não é
// destruído se o usuário navegar para outra tela antes de fechá-lo.
function isCurrentRoute(route) {
  return (location.hash || '').slice(1) === route;
}

// Preserva o texto buscado na lista de operações através de um reload (ver
// `onClose` abaixo): sem isso, reabrir a lista limparia o campo de busca.
function currentOpFilter(container) {
  const el = container.querySelector('#op-search-input');
  return el ? el.value : '';
}
function restoreOpFilter(container, value) {
  if (!value) return;
  const el = container.querySelector('#op-search-input');
  if (el) { el.value = value; el.dispatchEvent(new Event('input')); }
}

// Cada cadastro recarrega a lista (resumo de meses por operação) sempre que
// o frame de uma operação fecha — via `opts.onClose` do openModal — para que
// "Nenhum mês cadastrado" atualize assim que o usuário registra algo, sem
// precisar navegar para outra página e voltar.
async function renderCadastroDimensionamento(container, meta) {
  async function load() {
    if (!isCurrentRoute('cadastro:dimensionamento')) return;
    const filtro = currentOpFilter(container);
    const rows = await Api.get('/api/flat/tb_premissas_dimens');
    const mesesMap = buildMesesMap(rows, 'nom_operacao', 'referencia');
    renderOperationList(container, meta, (operacao) => {
      openModal(`Dimensionamento · ${operacao}`, (body) => renderDimensDetail(body, operacao), { onClose: load, size: 'cadastro' });
    }, mesesMap);
    restoreOpFilter(container, filtro);
  }
  await load();
}
async function renderCadastroOverstaff(container, meta) {
  async function load() {
    if (!isCurrentRoute('cadastro:overstaff')) return;
    const filtro = currentOpFilter(container);
    const mesesMap = await mesesMapFromMetricTables(OVERSTAFF_METRICS);
    renderOperationList(container, meta, (operacao) => {
      openModal(`Premissas Overstaff · ${operacao}`, (body) => renderCadastroWidePorIndicador(body, operacao, OVERSTAFF_METRICS, meta, { filenamePrefix: 'overstaff' }), { onClose: load, size: 'cadastro' });
    }, mesesMap);
    restoreOpFilter(container, filtro);
  }
  await load();
}
// Além dos meses da grade mensal (CPRB/Reajuste/Bodyshop), marca com
// `onlyUnitarios` as operações que já têm Unitário de Faturamento
// preenchido por filial mas ainda nenhum mês na grade — evita mostrar
// "Nenhum mês cadastrado" quando na verdade já existe alguma premissa.
async function receitaMesesMap() {
  const mesesMap = await mesesMapFromMetricTables(RECEITA_MONTHLY_METRICS);
  const unitariosAll = await Api.get('/api/flat/tb_unitarios');
  const temUnitario = (u) => UNITARIO_FIELDS.some(f => u[f.key] != null) || !!u.tipo_faturamento;
  for (const u of unitariosAll) {
    if (!temUnitario(u)) continue;
    if (!mesesMap.has(u.operacao)) mesesMap.set(u.operacao, { onlyUnitarios: true });
  }
  return mesesMap;
}
async function renderCadastroReceita(container, meta) {
  async function load() {
    if (!isCurrentRoute('cadastro:receita')) return;
    const filtro = currentOpFilter(container);
    const mesesMap = await receitaMesesMap();
    renderOperationList(container, meta, (operacao) => {
      openModal(`Premissas Receita · ${operacao}`, (body) => renderReceitaDetail(body, operacao, meta), { onClose: load, size: 'cadastro' });
    }, mesesMap);
    restoreOpFilter(container, filtro);
  }
  await load();
}
async function renderCadastroAdicionais(container, meta) {
  async function load() {
    if (!isCurrentRoute('cadastro:adicionais')) return;
    const filtro = currentOpFilter(container);
    const mesesMap = await mesesMapFromMetricTables(ADICIONAIS_METRICS);
    renderOperationList(container, meta, (operacao) => {
      openModal(`Premissas Adicionais · ${operacao}`, (body) => renderCadastroWidePorIndicador(body, operacao, ADICIONAIS_METRICS, meta, { filenamePrefix: 'adicionais' }), { onClose: load, size: 'cadastro' });
    }, mesesMap);
    restoreOpFilter(container, filtro);
  }
  await load();
}
async function renderCadastroDistribuicao(container, meta) {
  async function load() {
    if (!isCurrentRoute('cadastro:distribuicao')) return;
    const filtro = currentOpFilter(container);
    const [vol, hc] = await Promise.all([
      Api.get('/api/wide/tb_distribuicao_volume'),
      Api.get('/api/wide/tb_distribuicao_hc'),
    ]);
    const mesesMap = buildMesesMap([...vol.rows, ...hc.rows], 'nom_operacao', 'referencia');
    renderOperationList(container, meta, (operacao) => {
      openModal(`Distribuição (Volume & HC) · ${operacao}`, (body) => renderDistribuicaoDetail(body, operacao, meta), { onClose: load, size: 'cadastro' });
    }, mesesMap);
    restoreOpFilter(container, filtro);
  }
  await load();
}
async function renderCadastroAjustePremissas(container, meta) {
  async function load() {
    if (!isCurrentRoute('cadastro:ajustePremissas')) return;
    const filtro = currentOpFilter(container);
    const rows = await Api.get('/api/flat/tb_ajuste_premissas');
    const mesesMap = buildMesesMap(rows, 'nom_operacao', 'referencia');
    renderOperationList(container, meta, (operacao) => {
      openModal(`Ajuste Premissas · ${operacao}`, (body) => renderAjusteDetail(body, operacao), { onClose: load, size: 'cadastro' });
    }, mesesMap);
    restoreOpFilter(container, filtro);
  }
  await load();
}
