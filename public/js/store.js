// Camada de dados local — equivalente a src/routes.js, mas como funções JS
// chamadas diretamente pela UI (sem HTTP, sem servidor).
// Toda operação que grava dados chama notifyChanged(), que o file-store.js
// usa para regravar o arquivo .sqlite em disco (debounced).

function notifyChanged() {
  if (window.onDbChanged) window.onDbChanged();
}

function columnsOf(table) {
  return DB.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

function wideIdCols(cfg) {
  return cfg.hasTipoDimens ? ['referencia', 'tipo_dimens', 'nom_operacao'] : ['referencia', 'nom_operacao'];
}

const Store = {
  getMeta() {
    const filiais = DB.prepare('SELECT unidade FROM d_filiais ORDER BY rowid').all().map(r => r.unidade);
    const operacoes = DB.prepare('SELECT DISTINCT operacao FROM cadastro_operacoes ORDER BY operacao').all().map(r => r.operacao);
    const tiposDimens = DB.prepare('SELECT DISTINCT tipo_dimens FROM tb_premissas_dimens ORDER BY tipo_dimens').all().map(r => r.tipo_dimens);
    const responsaveis = DB.prepare('SELECT DISTINCT responsavel_pcp FROM cadastro_operacoes WHERE responsavel_pcp IS NOT NULL ORDER BY responsavel_pcp').all().map(r => r.responsavel_pcp);
    const gerentes = DB.prepare('SELECT DISTINCT gerente FROM cadastro_operacoes WHERE gerente IS NOT NULL ORDER BY gerente').all().map(r => r.gerente);
    // Intervalo de anos para os filtros "Ano" (Painel Gerencial, Analítico,
    // Calendário): do ano mínimo cadastrado em Cadastro Dimensionamento até
    // um ano além do máximo cadastrado (o "próximo ano" a orçar). Dinâmico —
    // não depende da data do sistema, só do que já foi cadastrado.
    const anosDimens = DB.prepare('SELECT referencia FROM tb_premissas_dimens WHERE referencia IS NOT NULL').all()
      .map(r => Number(r.referencia.slice(0, 4))).filter(a => !Number.isNaN(a));
    const anoAtual = new Date().getFullYear();
    const anoMinDimens = anosDimens.length ? Math.min(...anosDimens) : anoAtual;
    const anoMaxDimens = anosDimens.length ? Math.max(...anosDimens) : anoAtual;
    return {
      filiais, operacoes, tiposDimens, responsaveis, gerentes,
      anoMinDimens, anoMaxDimens,
      wideTables: WIDE_TABLES,
      flatTables: Object.fromEntries(Object.entries(FLAT_TABLES).map(([k, v]) => [k, { ...v, columns: columnsOf(k) }])),
    };
  },

  getWide(table) {
    const cfg = WIDE_TABLES[table];
    if (!cfg) throw new Error('tabela desconhecida: ' + table);
    const idCols = wideIdCols(cfg);
    const rows = DB.prepare(`SELECT * FROM ${table}`).all();
    const filiais = DB.prepare('SELECT unidade FROM d_filiais ORDER BY rowid').all().map(r => r.unidade);

    const grouped = new Map();
    for (const r of rows) {
      const key = idCols.map(c => r[c]).join('|');
      if (!grouped.has(key)) {
        const base = {};
        idCols.forEach(c => { base[c] = r[c]; });
        grouped.set(key, base);
      }
      grouped.get(key)[r.unidade] = r.valor;
    }
    const out = [...grouped.values()].sort((a, b) => {
      for (const c of idCols) {
        if (a[c] < b[c]) return -1;
        if (a[c] > b[c]) return 1;
      }
      return 0;
    });
    return { config: cfg, idCols, filiais, rows: out };
  },

  putWideCells(table, cells) {
    const cfg = WIDE_TABLES[table];
    if (!cfg) throw new Error('tabela desconhecida: ' + table);
    const stmt = cfg.hasTipoDimens
      ? DB.prepare(`INSERT INTO ${table} (referencia, tipo_dimens, nom_operacao, unidade, valor) VALUES (?,?,?,?,?)
                    ON CONFLICT(referencia, tipo_dimens, nom_operacao, unidade) DO UPDATE SET valor = excluded.valor`)
      : DB.prepare(`INSERT INTO ${table} (referencia, nom_operacao, unidade, valor) VALUES (?,?,?,?)
                    ON CONFLICT(referencia, nom_operacao, unidade) DO UPDATE SET valor = excluded.valor`);
    const tx = DB.transaction((items) => {
      for (const c of items) {
        if (cfg.hasTipoDimens) stmt.run(c.referencia, c.tipo_dimens, c.nom_operacao, c.unidade, c.valor);
        else stmt.run(c.referencia, c.nom_operacao, c.unidade, c.valor);
      }
    });
    tx(cells);
    notifyChanged();
    return { ok: true, updated: cells.length };
  },

  postWideRow(table, { referencia, tipo_dimens, nom_operacao }) {
    const cfg = WIDE_TABLES[table];
    if (!cfg) throw new Error('tabela desconhecida: ' + table);
    if (!referencia || !nom_operacao || (cfg.hasTipoDimens && !tipo_dimens)) {
      throw new Error('referencia, nom_operacao (e tipo_dimens quando aplicável) são obrigatórios');
    }
    const filiais = DB.prepare('SELECT unidade FROM d_filiais ORDER BY rowid').all().map(r => r.unidade);
    const stmt = cfg.hasTipoDimens
      ? DB.prepare(`INSERT OR IGNORE INTO ${table} (referencia, tipo_dimens, nom_operacao, unidade, valor) VALUES (?,?,?,?,NULL)`)
      : DB.prepare(`INSERT OR IGNORE INTO ${table} (referencia, nom_operacao, unidade, valor) VALUES (?,?,?,NULL)`);
    const tx = DB.transaction(() => {
      for (const u of filiais) {
        if (cfg.hasTipoDimens) stmt.run(referencia, tipo_dimens, nom_operacao, u);
        else stmt.run(referencia, nom_operacao, u);
      }
    });
    tx();
    notifyChanged();
    return { ok: true };
  },

  deleteWideRow(table, { referencia, tipo_dimens, nom_operacao }) {
    const cfg = WIDE_TABLES[table];
    if (!cfg) throw new Error('tabela desconhecida: ' + table);
    if (cfg.hasTipoDimens) {
      DB.prepare(`DELETE FROM ${table} WHERE referencia=? AND tipo_dimens=? AND nom_operacao=?`).run(referencia, tipo_dimens, nom_operacao);
    } else {
      DB.prepare(`DELETE FROM ${table} WHERE referencia=? AND nom_operacao=?`).run(referencia, nom_operacao);
    }
    notifyChanged();
    return { ok: true };
  },

  getFlat(table) {
    if (!FLAT_TABLES[table]) throw new Error('tabela desconhecida: ' + table);
    return DB.prepare(`SELECT * FROM ${table}`).all();
  },

  postFlat(table, rec) {
    const cfg = FLAT_TABLES[table];
    if (!cfg) throw new Error('tabela desconhecida: ' + table);
    const cols = columnsOf(table);
    const placeholders = cols.map(() => '?').join(',');
    DB.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`).run(...cols.map(c => rec[c] ?? null));
    notifyChanged();
    return { ok: true };
  },

  putFlat(table, rec) {
    const cfg = FLAT_TABLES[table];
    if (!cfg) throw new Error('tabela desconhecida: ' + table);
    const cols = columnsOf(table);
    const setCols = cols.filter(c => !cfg.pk.includes(c));
    const setClause = setCols.map(c => `${c} = ?`).join(', ');
    const whereClause = cfg.pk.map(c => `${c} = ?`).join(' AND ');
    DB.prepare(`UPDATE ${table} SET ${setClause} WHERE ${whereClause}`)
      .run(...setCols.map(c => rec[c] ?? null), ...cfg.pk.map(c => rec[c]));
    notifyChanged();
    return { ok: true };
  },

  deleteFlat(table, rec) {
    const cfg = FLAT_TABLES[table];
    if (!cfg) throw new Error('tabela desconhecida: ' + table);
    const whereClause = cfg.pk.map(c => `${c} = ?`).join(' AND ');
    DB.prepare(`DELETE FROM ${table} WHERE ${whereClause}`).run(...cfg.pk.map(c => rec[c]));
    notifyChanged();
    return { ok: true };
  },

  // Parâmetros globais de configuração (chave/valor) — ex.: peso do feriado
  // nacional usado no cálculo de Faturamento 6x1 do Calendário.
  getParametro(chave, def = null) {
    const row = DB.prepare('SELECT valor FROM tb_parametros WHERE chave = ?').get(chave);
    return row ? row.valor : def;
  },

  setParametro(chave, valor) {
    const existe = DB.prepare('SELECT chave FROM tb_parametros WHERE chave = ?').get(chave);
    if (existe) DB.prepare('UPDATE tb_parametros SET valor = ? WHERE chave = ?').run(valor, chave);
    else DB.prepare('INSERT INTO tb_parametros (chave, valor) VALUES (?, ?)').run(chave, valor);
    notifyChanged();
    return { ok: true };
  },

  // Anotações livres do usuário (botão flutuante) — hoje uma única nota
  // global ("geral"), editável a qualquer momento.
  getAnotacao(chave = 'geral') {
    const row = DB.prepare('SELECT texto, atualizado_em FROM tb_anotacoes WHERE chave = ?').get(chave);
    return row || { texto: '', atualizado_em: null };
  },

  setAnotacao(chave, texto) {
    const agora = new Date().toISOString();
    const existe = DB.prepare('SELECT chave FROM tb_anotacoes WHERE chave = ?').get(chave);
    if (existe) DB.prepare('UPDATE tb_anotacoes SET texto = ?, atualizado_em = ? WHERE chave = ?').run(texto, agora, chave);
    else DB.prepare('INSERT INTO tb_anotacoes (chave, texto, atualizado_em) VALUES (?, ?, ?)').run(chave, texto, agora);
    notifyChanged();
    return { ok: true, atualizado_em: agora };
  },

  getResultado({ ano, responsavel, gerente, operacao, apenasComCusto }) {
    // buildFinal devolve real (todos os anos com dado histórico) + projetado
    // (até o ano pedido) — precisa filtrar aqui pelo ano pedido, senão meses
    // de anos anteriores (reais) vazam para a visão do Analítico.
    let rows = buildFinal(ano, { responsavelPcp: responsavel || null, apenasComCusto: apenasComCusto !== false });
    rows = rows.filter(r => r.referencia && r.referencia.startsWith(String(ano)));
    if (gerente) rows = rows.filter(r => r.gerente === gerente);
    if (operacao) rows = rows.filter(r => r.operacao === operacao);
    return { ano, count: rows.length, rows };
  },

  // Painel Gerencial: KPIs + tabela agrupável com drill-down por um campo
  // escolhido pelo usuário (Agrupar por / Drill) + série mensal para os
  // gráficos (Headcount, Volume/Chamadas, TMA e Receita Bruta x mês).
  getDashboard({ ano, groupBy, drillBy, responsavel, gerente, operacao }) {
    const allowed = new Set(['diretoria', 'site', 'cliente', 'referencia', 'operacao', 'desc_centro_custo']);
    const g = allowed.has(groupBy) ? groupBy : 'diretoria';
    const d = allowed.has(drillBy) ? drillBy : 'none';

    // Base sem os 3 filtros "relativos" (responsável/gerente/operação) — usada
    // para calcular, para cada combo, quais valores dos OUTROS filtros ainda
    // fazem sentido (slicers cruzados: escolher um nível restringe os demais).
    // Já filtrada pelo ano pedido: buildFinal devolve real (todos os anos com
    // dado histórico) + projetado (até o ano pedido), então sem esse filtro
    // os KPIs/tabela somariam meses de anos anteriores junto com o ano atual.
    const allRows = buildFinal(ano, { apenasComCusto: true }).filter(r => r.referencia && r.referencia.startsWith(String(ano)));
    const uniqSorted = (list, field) => [...new Set(list.map(r => r[field]).filter(Boolean))].sort();
    const filterOptions = {
      responsaveis: uniqSorted(allRows.filter(r => (!gerente || r.gerente === gerente) && (!operacao || r.operacao === operacao)), 'responsavel_pcp'),
      gerentes: uniqSorted(allRows.filter(r => (!responsavel || r.responsavel_pcp === responsavel) && (!operacao || r.operacao === operacao)), 'gerente'),
      operacoes: uniqSorted(allRows.filter(r => (!responsavel || r.responsavel_pcp === responsavel) && (!gerente || r.gerente === gerente)), 'operacao'),
    };

    let rows = allRows;
    if (responsavel) rows = rows.filter(r => r.responsavel_pcp === responsavel);
    if (gerente) rows = rows.filter(r => r.gerente === gerente);
    if (operacao) rows = rows.filter(r => r.operacao === operacao);

    // médias ponderadas por HC Dimensionado (uma linha com HC pequeno pesa menos
    // no indicador do que uma operação grande)
    function weighted(list, field) {
      let num = 0, den = 0;
      for (const r of list) {
        const w = r.hc_dim || 0;
        num += (r[field] || 0) * w;
        den += w;
      }
      return den > 0 ? num / den : 0;
    }

    function summarize(list) {
      const s = { qtd_linhas: list.length, hc_dim: 0, fte_financeiro: 0, receita_bruta: 0 };
      for (const r of list) {
        s.hc_dim += r.hc_dim || 0;
        s.fte_financeiro += r.fte_financeiro || 0;
        s.receita_bruta += r.receita_bruta || 0;
      }
      s.absenteismo = weighted(list, 'absenteismo');
      s.turnover = weighted(list, 'turnover');
      s.ferias = weighted(list, 'ferias');
      s.folga_extra = weighted(list, 'folga_extra');
      s.rob_financeiro = s.fte_financeiro > 0 ? s.receita_bruta / s.fte_financeiro : 0;
      return s;
    }

    const byGroup = new Map();
    for (const r of rows) {
      const key = r[g] ?? '(sem valor)';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(r);
    }
    const grupos = [...byGroup.entries()].map(([chave, list]) => {
      let drill = [];
      if (d !== 'none') {
        const byDrill = new Map();
        for (const r of list) {
          const dk = r[d] ?? '(sem valor)';
          if (!byDrill.has(dk)) byDrill.set(dk, []);
          byDrill.get(dk).push(r);
        }
        drill = [...byDrill.entries()]
          .map(([chave, l]) => ({ chave, ...summarize(l) }))
          .sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
      }
      return { chave, ...summarize(list), drill };
    }).sort(g === 'referencia'
      ? (a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0)
      : (a, b) => b.fte_financeiro - a.fte_financeiro);

    // Série mensal para os gráficos — independente do Agrupar por/Drill,
    // sempre respeita os filtros (ano, responsável, gerente, operação).
    // Restrita aos 12 meses do "Ano" selecionado (buildFinal devolve real +
    // projetado de vários anos; sem esse filtro os gráficos/estatísticas
    // mensais misturariam meses de anos diferentes).
    const byMes = new Map();
    for (const r of rows) {
      const mk = r.referencia;
      if (!mk || !mk.startsWith(String(ano))) continue;
      if (!byMes.has(mk)) byMes.set(mk, []);
      byMes.get(mk).push(r);
    }
    const porMes = [...byMes.entries()].map(([mes, list]) => {
      let volume = 0, volumeXTma = 0, hc = 0, receita = 0, fte = 0;
      for (const r of list) {
        const vol = r._volume_revisado || 0;
        volume += vol;
        volumeXTma += vol * (r._tma || 0);
        hc += r.hc_dim || 0;
        receita += r.receita_bruta || 0;
        fte += r.fte_financeiro || 0;
      }
      return {
        mes, hc, volume, receita, fte, tma: volume > 0 ? volumeXTma / volume : 0,
        rob: fte > 0 ? receita / fte : 0,
        absenteismo: weighted(list, 'absenteismo'),
        turnover: weighted(list, 'turnover'),
        ferias: weighted(list, 'ferias'),
        folga_extra: weighted(list, 'folga_extra'),
      };
    }).sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0));

    const totals = summarize(rows);
    return { ano, groupBy: g, drillBy: d, totals, grupos, porMes, filterOptions };
  },
};
