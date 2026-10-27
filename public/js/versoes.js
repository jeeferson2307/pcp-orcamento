// Telas de versionamento: Versões, Comparativo e Histórico de Alterações.
// A lógica toda mora em versionamento.js; aqui é só apresentação, sempre
// falando com o Store através do Api (mesmo padrão das outras páginas).

const VERSAO_TRABALHO = 'trabalho';

function fmtMomento(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
}

// Valor cru -> texto, respeitando o formato do campo de origem (um
// absenteísmo de 0.065 precisa aparecer como 6,50%, não como 0.065).
function fmtValorVersao(v, formato) {
  if (v == null || v === '') return '—';
  if (formato === 'texto') return String(v);
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return Fmt.display(n, formato);
}

function fmtDelta(v, formato) {
  if (v == null) return '—';
  const n = Number(v);
  if (!n) return fmtValorVersao(0, formato);
  const txt = fmtValorVersao(Math.abs(n), formato);
  return (n > 0 ? '+' : '−') + txt;
}

// pct null = a base era zero (não existe variação percentual de zero).
function fmtPct(pct) {
  if (pct == null) return 'novo';
  if (!pct) return '0,00%';
  const n = pct * 100;
  return (n > 0 ? '+' : '−') + Math.abs(n).toFixed(2).replace('.', ',') + '%';
}

function classeDelta(v) {
  if (v == null || !v) return 'delta-zero';
  return v > 0 ? 'delta-pos' : 'delta-neg';
}

function rotuloVersao(v) {
  return `#${v.id} · ${v.nome} · ${fmtMomento(v.criado_em)}`;
}

function opcoesVersao(versoes, { incluirTrabalho = true } = {}) {
  const base = versoes.map(v => `<option value="${v.id}">${escapeHtml(rotuloVersao(v))}</option>`).join('');
  const trabalho = incluirTrabalho
    ? `<option value="${VERSAO_TRABALHO}">Versão de trabalho (estado atual)</option>` : '';
  return trabalho + base;
}

// ===================================================================
// Tela: Versões
// ===================================================================
async function renderVersoesPage(container) {
  async function load() {
    const { versoes, contexto, engine, pendentes, anoPadrao } = await Api.get('/api/versoes');

    container.innerHTML = `
      <div class="toolbar">
        <span class="small">${versoes.length} versão(ões) · motor de cálculo ${escapeHtml(engine)}</span>
        <button class="primary" id="btn-nova-versao">${Icon('plus')} Criar versão</button>
      </div>
      ${pendentes > 0
        ? `<div class="aviso-versao">${Icon('circle-alert')} <strong>${pendentes}</strong> alteração(ões) ainda não fazem parte de nenhuma versão. Crie uma versão para congelar o estado atual.</div>`
        : `<div class="aviso-versao aviso-ok">${Icon('circle-check')} Nenhuma alteração pendente — a versão mais recente reflete o estado atual.</div>`}
      <div class="panel"><table class="grid" id="versoes-table"></table></div>
      <p class="small" style="margin-top:14px">
        Uma versão é um marco no histórico: guarda o ponto de corte, congela os indicadores calculados naquele momento
        e registra o motor de cálculo usado. Restaurar uma versão <strong>não apaga histórico</strong> — as reversões
        entram no log como alterações novas e geram uma versão nova.
      </p>
    `;
    applyIcons(container);

    const table = container.querySelector('#versoes-table');
    table.innerHTML = `<thead><tr>
      <th>#</th><th>Nome</th><th>Criada em</th><th>Autor</th>
      <th>Alterações</th><th>Ano projetado</th><th>Motor</th><th></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    if (versoes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">Nenhuma versão criada ainda. Use "Criar versão" para marcar o estado atual como ponto de referência.</div></td></tr>`;
    }
    for (const v of versoes) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="id-col">${v.id}</td>
        <td><strong>${escapeHtml(v.nome)}</strong>${v.descricao ? `<br><span class="small">${escapeHtml(v.descricao)}</span>` : ''}</td>
        <td>${fmtMomento(v.criado_em)}</td>
        <td>${escapeHtml(v.criado_por || '—')}</td>
        <td>${v.qtd_alteracoes}</td>
        <td>${v.ano_projecao ?? '—'}</td>
        <td class="${v.engine_versao === engine ? '' : 'delta-neg'}">${escapeHtml(v.engine_versao || '—')}</td>
      `;
      const tdAcoes = document.createElement('td');
      tdAcoes.className = 'actions-col';

      const btnComparar = document.createElement('button');
      btnComparar.className = 'icon-btn';
      btnComparar.innerHTML = Icon('table');
      btnComparar.title = 'Comparar esta versão com o estado atual';
      btnComparar.onclick = () => { location.hash = `comparativo?a=${v.id}&b=${VERSAO_TRABALHO}`; };
      tdAcoes.appendChild(btnComparar);

      const btnRestaurar = document.createElement('button');
      btnRestaurar.className = 'icon-btn';
      btnRestaurar.innerHTML = Icon('refresh-cw');
      btnRestaurar.title = 'Restaurar este estado';
      btnRestaurar.onclick = () => confirmarRestauracao(v, load);
      tdAcoes.appendChild(btnRestaurar);

      const btnExcluir = document.createElement('button');
      btnExcluir.className = 'danger icon-btn';
      btnExcluir.innerHTML = Icon('trash-2');
      btnExcluir.title = 'Excluir o marco (o histórico de alterações é preservado)';
      btnExcluir.onclick = async () => {
        if (!confirm(`Excluir a versão "${v.nome}"?\n\nO marco e os indicadores congelados são removidos. O histórico de alterações NÃO é apagado — as alterações voltam a ficar sem versão.`)) return;
        try {
          await Api.del('/api/versoes', { id: v.id });
          toast('Versão excluída.');
          await load();
        } catch (e) { toast('Erro ao excluir: ' + e.message, true); }
      };
      tdAcoes.appendChild(btnExcluir);

      tr.appendChild(tdAcoes);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    container.querySelector('#btn-nova-versao').onclick = () => openNovaVersaoModal(contexto, anoPadrao, load);
  }

  function openNovaVersaoModal(contexto, anoPadrao, reload) {
    openModal('Criar versão', (body, close) => {
      const hoje = new Date().toLocaleDateString('pt-BR');
      body.innerHTML = `
        <p>Marca o estado atual como uma versão: congela os indicadores calculados e fecha o bloco de alterações pendentes.</p>
        <label class="field-label">Nome da versão
          <input class="field-input" type="text" id="nv-nome" value="Orçamento ${hoje}" autofocus>
        </label>
        <label class="field-label">Descrição (o que mudou nesta rodada)
          <input class="field-input" type="text" id="nv-desc" placeholder="opcional">
        </label>
        <label class="field-label" style="max-width:220px">Ano projetado
          <input class="field-input" type="number" id="nv-ano" value="${anoPadrao}">
        </label>
        <p class="small">Autor: <strong>${escapeHtml(contexto.autor || '(não informado)')}</strong> — altere na barra de contexto, no topo da tela.</p>
        <div class="modal-actions">
          <button id="nv-cancel">Cancelar</button>
          <button class="primary" id="nv-save">${Icon('check')} Criar versão</button>
        </div>
      `;
      const input = body.querySelector('#nv-nome');
      input.select();
      body.querySelector('#nv-cancel').onclick = close;
      body.querySelector('#nv-save').onclick = async () => {
        const nome = input.value.trim();
        if (!nome) { toast('Informe um nome.', true); return; }
        try {
          const v = await Api.post('/api/versoes', {
            nome,
            descricao: body.querySelector('#nv-desc').value.trim() || null,
            ano: Number(body.querySelector('#nv-ano').value) || null,
          });
          toast(`Versão #${v.id} criada (${v.linhas_resultado} linhas de indicadores congeladas).`);
          close();
          await reload();
        } catch (e) { toast('Erro ao criar versão: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  function confirmarRestauracao(v, reload) {
    openModal(`Restaurar "${v.nome}"`, (body, close) => {
      body.innerHTML = `
        <p>Os dados de trabalho voltam a ficar exatamente como estavam na versão <strong>#${v.id} · ${escapeHtml(v.nome)}</strong>
        (${fmtMomento(v.criado_em)}).</p>
        <p class="small">Nada é apagado: cada reversão é registrada no histórico como uma alteração nova, com motivo
        automático, e ao final é criada uma versão nova com o estado restaurado. Dá para voltar atrás restaurando a versão anterior.</p>
        <div class="modal-actions">
          <button id="rs-cancel">Cancelar</button>
          <button class="primary" id="rs-ok">${Icon('refresh-cw')} Restaurar</button>
        </div>
      `;
      body.querySelector('#rs-cancel').onclick = close;
      body.querySelector('#rs-ok').onclick = async () => {
        try {
          const r = await Api.post('/api/versoes/restaurar', { id: v.id });
          toast(`${r.desfeitas} alteração(ões) desfeita(s). Nova versão #${r.versao.id} criada.`);
          close();
          await reload();
        } catch (e) { toast('Erro ao restaurar: ' + e.message, true); }
      };
    }, { size: 'form' });
  }

  await load();
}

// ===================================================================
// Tela: Comparativo
// ===================================================================
const comparativoState = { a: null, b: VERSAO_TRABALHO, groupBy: 'diretoria', indicador: 'receita_bruta', recalcular: false, mes: '' };

async function renderComparativoPage(container) {
  // Permite chegar aqui já com as versões escolhidas (link da tela de Versões)
  const hash = location.hash || '';
  const qs = hash.includes('?') ? new URLSearchParams(hash.slice(hash.indexOf('?') + 1)) : null;
  if (qs) {
    if (qs.get('a')) comparativoState.a = qs.get('a');
    if (qs.get('b')) comparativoState.b = qs.get('b');
  }

  const { versoes } = await Api.get('/api/versoes');
  if (versoes.length === 0) {
    container.innerHTML = `<div class="empty-state">
      ${Icon('circle-alert')} Ainda não há versões para comparar.<br>
      Crie uma versão na guia <strong>Versões</strong> — ela congela os indicadores de hoje e passa a servir de base de comparação.
    </div>`;
    applyIcons(container);
    return;
  }
  if (!comparativoState.a) comparativoState.a = String(versoes[0].id);

  const gruposOpcoes = Object.entries({
    diretoria: 'Diretoria', site: 'Site / Filial', cliente: 'Cliente', operacao: 'Operação',
    referencia: 'Mês', un_dre: 'UN DRE', desc_centro_custo: 'Centro de Custo', gerente: 'Gerente',
  }).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  container.innerHTML = `
    <div class="filter-grid">
      <label>Versão base (A)<select id="cmp-a">${opcoesVersao(versoes)}</select></label>
      <label>Comparar com (B)<select id="cmp-b">${opcoesVersao(versoes)}</select></label>
      <label>Agrupar por<select id="cmp-group">${gruposOpcoes}</select></label>
      <label>Mês<select id="cmp-mes"><option value="">Todos</option></select></label>
      <label class="filtro-check">
        <span>Motor de cálculo</span>
        <span class="check-inline"><input type="checkbox" id="cmp-recalc"> <span>Recalcular ambas com o motor atual</span></span>
      </label>
    </div>
    <div id="cmp-avisos"></div>
    <div class="section-title">Totais — todos os indicadores</div>
    <div class="panel"><table class="grid" id="cmp-totais"></table></div>
    <div class="section-title" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span>Por grupo</span>
      <select id="cmp-indicador" class="field-input" style="max-width:260px"></select>
      <button class="icon-btn" id="cmp-export" title="Exportar este comparativo em CSV">${Icon('download')}</button>
    </div>
    <div class="panel"><table class="grid" id="cmp-grupos"></table></div>
    <div class="section-title">O que mudou entre as duas versões</div>
    <div class="toolbar">
      <div class="search-input" style="min-width:260px"><span data-icon="search"></span><input type="text" id="cmp-busca-alt" placeholder="Filtrar por operação, campo, solicitante…"></div>
      <span class="small" id="cmp-alt-count"></span>
      <button class="icon-btn" id="cmp-export-alt" title="Exportar as alterações em CSV">${Icon('download')}</button>
    </div>
    <div class="panel"><table class="grid" id="cmp-alteracoes"></table></div>
  `;
  applyIcons(container);

  const selA = container.querySelector('#cmp-a');
  const selB = container.querySelector('#cmp-b');
  const selGroup = container.querySelector('#cmp-group');
  const selMes = container.querySelector('#cmp-mes');
  const selInd = container.querySelector('#cmp-indicador');
  const chkRecalc = container.querySelector('#cmp-recalc');
  selA.value = comparativoState.a;
  selB.value = comparativoState.b;
  selGroup.value = comparativoState.groupBy;
  chkRecalc.checked = comparativoState.recalcular;
  [selA, selB].forEach(enhanceCombobox);

  let ultimo = null;

  async function load() {
    comparativoState.a = selA.value;
    comparativoState.b = selB.value;
    comparativoState.groupBy = selGroup.value;
    comparativoState.recalcular = chkRecalc.checked;
    comparativoState.mes = selMes.value;

    if (comparativoState.a === comparativoState.b) {
      container.querySelector('#cmp-avisos').innerHTML =
        `<div class="aviso-versao">${Icon('circle-alert')} Escolha duas versões diferentes.</div>`;
      applyIcons(container.querySelector('#cmp-avisos'));
      return;
    }

    const url = `/api/comparativo?a=${encodeURIComponent(comparativoState.a)}&b=${encodeURIComponent(comparativoState.b)}`
      + `&groupBy=${encodeURIComponent(comparativoState.groupBy)}&recalcular=${comparativoState.recalcular ? 1 : 0}`
      + (comparativoState.mes ? `&mes=${encodeURIComponent(comparativoState.mes)}` : '');
    let res;
    try { res = await Api.get(url); }
    catch (e) { container.querySelector('#cmp-avisos').innerHTML = `<div class="aviso-versao">${escapeHtml(e.message)}</div>`; return; }
    ultimo = res;

    // opções de mês (preserva a escolha)
    const mesAtual = selMes.value;
    selMes.innerHTML = `<option value="">Todos</option>` + res.meses.map(m => `<option value="${m}">${Fmt.mes(m)}</option>`).join('');
    selMes.value = res.meses.includes(mesAtual) ? mesAtual : '';

    // indicadores (preserva a escolha)
    if (!selInd.options.length) {
      selInd.innerHTML = res.total.map(i => `<option value="${i.key}">${escapeHtml(i.label)}</option>`).join('');
      selInd.value = comparativoState.indicador;
    }

    desenharAvisos(res);
    desenharTotais(res);
    desenharGrupos(res);
    desenharAlteracoes(res);
  }

  function desenharAvisos(res) {
    const avisos = [];
    if (res.engineDivergente && !res.recalculado) {
      avisos.push(`${Icon('circle-alert')} As duas versões foram geradas por <strong>motores de cálculo diferentes</strong>
        (${escapeHtml(res.versaoA?.engine_versao || '—')} × ${escapeHtml(res.versaoB?.engine_versao || '—')}).
        Parte da diferença pode vir da fórmula, não do dado — marque <em>"Recalcular ambas com o motor atual"</em> para isolar a mudança de dado.`);
    }
    if (res.mesesSoEmA.length) {
      avisos.push(`${Icon('circle-alert')} Meses presentes só na versão A: <strong>${res.mesesSoEmA.map(Fmt.mes).join(', ')}</strong> — entram no total de A e não no de B.`);
    }
    if (res.mesesSoEmB.length) {
      avisos.push(`${Icon('circle-alert')} Meses presentes só na versão B: <strong>${res.mesesSoEmB.map(Fmt.mes).join(', ')}</strong> — entram no total de B e não no de A.`);
    }
    if (!res.diffDisponivel) {
      avisos.push(`${Icon('circle-alert')} As duas referências apontam para o mesmo ponto do histórico — não há alterações de cadastro entre elas.`);
    }
    const host = container.querySelector('#cmp-avisos');
    host.innerHTML = avisos.map(a => `<div class="aviso-versao">${a}</div>`).join('');
  }

  function nomeRef(ref, versao) {
    return ref === VERSAO_TRABALHO ? 'Trabalho' : (versao ? `#${versao.id} ${versao.nome}` : ref);
  }

  function desenharTotais(res) {
    const table = container.querySelector('#cmp-totais');
    const rotA = nomeRef(comparativoState.a, res.versaoA);
    const rotB = nomeRef(comparativoState.b, res.versaoB);
    table.innerHTML = `<thead><tr><th>Indicador</th><th>${escapeHtml(rotA)}</th><th>${escapeHtml(rotB)}</th><th>Δ absoluto</th><th>Δ %</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    tbody.innerHTML = res.total.map(i => `
      <tr>
        <td class="id-col">${escapeHtml(i.label)}</td>
        <td>${fmtValorVersao(i.a, i.format)}</td>
        <td>${fmtValorVersao(i.b, i.format)}</td>
        <td class="${classeDelta(i.delta)}">${fmtDelta(i.delta, i.format)}</td>
        <td class="${classeDelta(i.delta)}">${fmtPct(i.pct)}</td>
      </tr>`).join('');
    table.appendChild(tbody);
  }

  function desenharGrupos(res) {
    const key = selInd.value || comparativoState.indicador;
    comparativoState.indicador = key;
    const table = container.querySelector('#cmp-grupos');
    const rotA = nomeRef(comparativoState.a, res.versaoA);
    const rotB = nomeRef(comparativoState.b, res.versaoB);
    const rotuloGrupo = selGroup.options[selGroup.selectedIndex].textContent;
    table.innerHTML = `<thead><tr><th>${escapeHtml(rotuloGrupo)}</th><th>${escapeHtml(rotA)}</th><th>${escapeHtml(rotB)}</th><th>Δ absoluto</th><th>Δ %</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    const linhas = res.grupos.map(g => ({ chave: g.chave, ind: g.indicadores.find(i => i.key === key), soA: g.soA, soB: g.soB }))
      .filter(l => l.ind)
      .sort((a, b) => Math.abs(b.ind.delta) - Math.abs(a.ind.delta));
    if (!linhas.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">Nada a comparar com os filtros atuais.</div></td></tr>`;
    }
    tbody.innerHTML += linhas.map(l => {
      const marca = l.soA ? ' <span class="small">(só em A)</span>' : l.soB ? ' <span class="small">(só em B)</span>' : '';
      const chave = l.chave === '(sem valor)' ? '(sem valor)' : (comparativoState.groupBy === 'referencia' ? Fmt.mes(l.chave) : l.chave);
      return `<tr>
        <td class="id-col">${escapeHtml(String(chave))}${marca}</td>
        <td>${fmtValorVersao(l.ind.a, l.ind.format)}</td>
        <td>${fmtValorVersao(l.ind.b, l.ind.format)}</td>
        <td class="${classeDelta(l.ind.delta)}">${fmtDelta(l.ind.delta, l.ind.format)}</td>
        <td class="${classeDelta(l.ind.delta)}">${fmtPct(l.ind.pct)}</td>
      </tr>`;
    }).join('');
    table.appendChild(tbody);
  }

  function alteracoesFiltradas(res) {
    const busca = (container.querySelector('#cmp-busca-alt').value || '').toLowerCase();
    if (!busca) return res.alteracoes;
    return res.alteracoes.filter(a => [a.rotulo_tabela, a.rotulo_campo, a.nom_operacao, a.unidade, a.solicitantes, a.motivos]
      .some(v => (v || '').toLowerCase().includes(busca)));
  }

  function desenharAlteracoes(res) {
    const table = container.querySelector('#cmp-alteracoes');
    const linhas = alteracoesFiltradas(res);
    container.querySelector('#cmp-alt-count').textContent =
      `${linhas.length} alteração(ões) de cadastro entre as duas versões`;
    table.innerHTML = `<thead><tr>
      <th>Cadastro</th><th>Campo</th><th>Operação</th><th>Mês</th><th>Filial</th>
      <th>Antes</th><th>Depois</th><th>Solicitante</th><th>Motivo</th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    if (!linhas.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">Nenhuma alteração de cadastro entre essas versões.</div></td></tr>`;
    }
    tbody.innerHTML += linhas.map(a => `<tr>
      <td class="id-col">${escapeHtml(a.rotulo_tabela)}</td>
      <td>${escapeHtml(a.rotulo_campo)}</td>
      <td>${escapeHtml(a.nom_operacao || '—')}</td>
      <td>${a.referencia ? Fmt.mes(a.referencia) : '—'}</td>
      <td>${escapeHtml(a.unidade || '—')}</td>
      <td class="delta-neg">${escapeHtml(fmtValorVersao(a.antes, a.formato))}</td>
      <td class="delta-pos">${escapeHtml(fmtValorVersao(a.depois, a.formato))}</td>
      <td>${escapeHtml(a.solicitantes || '—')}</td>
      <td>${escapeHtml(a.motivos || '—')}</td>
    </tr>`).join('');
    table.appendChild(tbody);
  }

  selA.onchange = load;
  selB.onchange = load;
  selGroup.onchange = load;
  selMes.onchange = load;
  chkRecalc.onchange = load;
  selInd.onchange = () => { if (ultimo) desenharGrupos(ultimo); };
  container.querySelector('#cmp-busca-alt').oninput = () => { if (ultimo) desenharAlteracoes(ultimo); };

  container.querySelector('#cmp-export').onclick = () => {
    if (!ultimo) return;
    const rotA = nomeRef(comparativoState.a, ultimo.versaoA);
    const rotB = nomeRef(comparativoState.b, ultimo.versaoB);
    const rows = [['Grupo', 'Indicador', rotA, rotB, 'Delta', 'Delta %']];
    for (const g of ultimo.grupos) {
      for (const i of g.indicadores) {
        rows.push([g.chave, i.label, i.a, i.b, i.delta, i.pct == null ? '' : i.pct]);
      }
    }
    ExportUtil.downloadCsv('comparativo_indicadores.csv', rows);
    toast('Comparativo exportado.');
  };

  container.querySelector('#cmp-export-alt').onclick = () => {
    if (!ultimo) return;
    const rows = [['Cadastro', 'Campo', 'Operacao', 'Mes', 'Filial', 'Antes', 'Depois', 'Solicitante', 'Motivo', 'Edicoes']];
    for (const a of alteracoesFiltradas(ultimo)) {
      rows.push([a.rotulo_tabela, a.rotulo_campo, a.nom_operacao || '', a.referencia || '', a.unidade || '',
                 fmtValorVersao(a.antes, a.formato), fmtValorVersao(a.depois, a.formato),
                 a.solicitantes || '', a.motivos || '', a.edicoes]);
    }
    ExportUtil.downloadCsv('comparativo_alteracoes.csv', rows);
    toast('Alterações exportadas.');
  };

  await load();
}

// ===================================================================
// Tela: Histórico de Alterações
// ===================================================================
const historicoState = { versao: '', operacao: '', solicitante: '', busca: '' };

async function renderHistoricoPage(container, meta) {
  container.innerHTML = `
    <div class="filter-grid">
      <label>Versão<select id="h-versao"></select></label>
      <label>Operação<select id="h-operacao"></select></label>
      <label>Solicitante<select id="h-solicitante"></select></label>
      <label>Buscar<input type="text" id="h-busca" class="field-input" placeholder="motivo, autor, operação…"></label>
    </div>
    <div class="toolbar">
      <span class="small" id="h-count"></span>
      <button class="icon-btn" id="h-export" title="Exportar o histórico filtrado em CSV">${Icon('download')}</button>
    </div>
    <div class="panel"><table class="grid" id="h-table"></table></div>
    <p class="small" style="margin-top:14px">
      O histórico é somente leitura e nunca é reescrito. Restaurar uma versão acrescenta linhas de reversão em vez de apagar as originais.
    </p>
  `;
  applyIcons(container);

  const selVersao = container.querySelector('#h-versao');
  const selOperacao = container.querySelector('#h-operacao');
  const selSolicitante = container.querySelector('#h-solicitante');
  const inputBusca = container.querySelector('#h-busca');
  let linhas = [];

  selOperacao.innerHTML = `<option value="">Todas</option>` + meta.operacoes.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  [selOperacao].forEach(enhanceCombobox);

  async function load() {
    historicoState.versao = selVersao.value;
    historicoState.operacao = selOperacao.value;
    historicoState.solicitante = selSolicitante.value;
    historicoState.busca = inputBusca.value.trim();

    const params = new URLSearchParams();
    if (historicoState.versao) params.set('versao', historicoState.versao);
    if (historicoState.operacao) params.set('operacao', historicoState.operacao);
    if (historicoState.solicitante) params.set('solicitante', historicoState.solicitante);
    if (historicoState.busca) params.set('busca', historicoState.busca);
    const res = await Api.get('/api/historico?' + params.toString());
    linhas = res.linhas;

    // Opções que dependem dos dados (preservam a escolha atual)
    const versaoAtual = selVersao.value;
    selVersao.innerHTML = `<option value="">Todas</option><option value="trabalho">Não versionadas (rascunho)</option>`
      + res.versoes.map(v => `<option value="${v.id}">${escapeHtml(rotuloVersao(v))}</option>`).join('');
    selVersao.value = versaoAtual;
    const solicAtual = selSolicitante.value;
    selSolicitante.innerHTML = `<option value="">Todos</option>` + res.solicitantes.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    selSolicitante.value = res.solicitantes.includes(solicAtual) ? solicAtual : '';

    container.querySelector('#h-count').textContent = `${linhas.length} alteração(ões)${linhas.length >= 500 ? ' (mostrando as 500 mais recentes)' : ''}`;

    const table = container.querySelector('#h-table');
    table.innerHTML = `<thead><tr>
      <th>Quando</th><th>Autor</th><th>Solicitante</th><th>Motivo</th>
      <th>Cadastro</th><th>Campo</th><th>Operação</th><th>Mês</th><th>Filial</th>
      <th>Antes</th><th>Depois</th><th>Versão</th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    if (!linhas.length) {
      tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state">Nenhuma alteração registrada com esses filtros.</div></td></tr>`;
    }
    tbody.innerHTML += linhas.map(a => {
      const formato = Versionamento.formatoDe(a.tabela, a.campo);
      const antes = a.valor_antes != null ? a.valor_antes : a.texto_antes;
      const depois = a.valor_depois != null ? a.valor_depois : a.texto_depois;
      const acao = a.acao === 'criou' ? '<span class="tag-acao tag-criou">criou</span>'
        : a.acao === 'excluiu' ? '<span class="tag-acao tag-excluiu">excluiu</span>' : '';
      return `<tr>
        <td class="id-col">${fmtMomento(a.momento)}</td>
        <td>${escapeHtml(a.autor || '—')}</td>
        <td>${escapeHtml(a.solicitante || '—')}</td>
        <td>${escapeHtml(a.motivo || '—')}</td>
        <td>${escapeHtml(Versionamento.rotuloTabela(a.tabela))} ${acao}</td>
        <td>${escapeHtml(Versionamento.rotuloCampo(a.tabela, a.campo))}</td>
        <td>${escapeHtml(a.nom_operacao || '—')}</td>
        <td>${a.referencia ? Fmt.mes(a.referencia) : '—'}</td>
        <td>${escapeHtml(a.unidade || '—')}</td>
        <td class="delta-neg">${escapeHtml(fmtValorVersao(antes, formato))}</td>
        <td class="delta-pos">${escapeHtml(fmtValorVersao(depois, formato))}</td>
        <td>${a.versao_id ? '#' + a.versao_id : '<span class="small">rascunho</span>'}</td>
      </tr>`;
    }).join('');
    table.appendChild(tbody);
  }

  selVersao.onchange = load;
  selOperacao.onchange = load;
  selSolicitante.onchange = load;
  let debounce = null;
  inputBusca.oninput = () => { clearTimeout(debounce); debounce = setTimeout(load, 250); };

  container.querySelector('#h-export').onclick = () => {
    const rows = [['Quando', 'Autor', 'Solicitante', 'Motivo', 'Acao', 'Cadastro', 'Campo', 'Operacao', 'Mes', 'Filial', 'Antes', 'Depois', 'Versao']];
    for (const a of linhas) {
      const formato = Versionamento.formatoDe(a.tabela, a.campo);
      const antes = a.valor_antes != null ? a.valor_antes : a.texto_antes;
      const depois = a.valor_depois != null ? a.valor_depois : a.texto_depois;
      rows.push([fmtMomento(a.momento), a.autor || '', a.solicitante || '', a.motivo || '', a.acao,
                 Versionamento.rotuloTabela(a.tabela), Versionamento.rotuloCampo(a.tabela, a.campo),
                 a.nom_operacao || '', a.referencia || '', a.unidade || '',
                 fmtValorVersao(antes, formato), fmtValorVersao(depois, formato), a.versao_id || 'rascunho']);
    }
    ExportUtil.downloadCsv('historico_alteracoes.csv', rows);
    toast('Histórico exportado.');
  };

  await load();
}
