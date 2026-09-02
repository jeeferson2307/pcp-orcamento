const express = require('express');
const db = require('./db');
const { WIDE_TABLES } = require('./tablesConfig');
const { FLAT_TABLES } = require('./flatTablesConfig');
const { buildFinal } = require('./calc');

const router = express.Router();

function columnsOf(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

// ============================================================
// Metadados (para a UI montar menus, colunas de filial, etc.)
// ============================================================
router.get('/meta', (req, res) => {
  const filiais = db.prepare('SELECT unidade FROM d_filiais ORDER BY rowid').all().map(r => r.unidade);
  const operacoes = db.prepare('SELECT DISTINCT operacao FROM cadastro_operacoes ORDER BY operacao').all().map(r => r.operacao);
  const tiposDimens = db.prepare('SELECT DISTINCT tipo_dimens FROM tb_premissas_dimens ORDER BY tipo_dimens').all().map(r => r.tipo_dimens);
  const responsaveis = db.prepare('SELECT DISTINCT responsavel_pcp FROM cadastro_operacoes WHERE responsavel_pcp IS NOT NULL ORDER BY responsavel_pcp').all().map(r => r.responsavel_pcp);
  res.json({
    filiais,
    operacoes,
    tiposDimens,
    responsaveis,
    wideTables: WIDE_TABLES,
    flatTables: Object.fromEntries(Object.entries(FLAT_TABLES).map(([k, v]) => [k, { ...v, columns: columnsOf(k) }])),
  });
});

// ============================================================
// Tabelas largas (pivotadas): TB_ABS, TB_TO, TB_DISTRIBUICAO_*, etc.
// ============================================================
function wideIdCols(cfg) {
  return cfg.hasTipoDimens ? ['referencia', 'tipo_dimens', 'nom_operacao'] : ['referencia', 'nom_operacao'];
}

router.get('/wide/:table', (req, res) => {
  const { table } = req.params;
  const cfg = WIDE_TABLES[table];
  if (!cfg) return res.status(404).json({ error: 'tabela desconhecida' });

  const idCols = wideIdCols(cfg);
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  const filiais = db.prepare('SELECT unidade FROM d_filiais ORDER BY rowid').all().map(r => r.unidade);

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

  res.json({ config: cfg, idCols, filiais, rows: out });
});

// Upsert em lote de células: { cells: [{referencia, tipo_dimens?, nom_operacao, unidade, valor}] }
router.put('/wide/:table', (req, res) => {
  const { table } = req.params;
  const cfg = WIDE_TABLES[table];
  if (!cfg) return res.status(404).json({ error: 'tabela desconhecida' });
  const cells = req.body.cells;
  if (!Array.isArray(cells)) return res.status(400).json({ error: 'body.cells deve ser um array' });

  const stmt = cfg.hasTipoDimens
    ? db.prepare(`INSERT INTO ${table} (referencia, tipo_dimens, nom_operacao, unidade, valor) VALUES (?,?,?,?,?)
                  ON CONFLICT(referencia, tipo_dimens, nom_operacao, unidade) DO UPDATE SET valor = excluded.valor`)
    : db.prepare(`INSERT INTO ${table} (referencia, nom_operacao, unidade, valor) VALUES (?,?,?,?)
                  ON CONFLICT(referencia, nom_operacao, unidade) DO UPDATE SET valor = excluded.valor`);

  const tx = db.transaction((items) => {
    for (const c of items) {
      if (cfg.hasTipoDimens) stmt.run(c.referencia, c.tipo_dimens, c.nom_operacao, c.unidade, c.valor);
      else stmt.run(c.referencia, c.nom_operacao, c.unidade, c.valor);
    }
  });
  tx(cells);
  res.json({ ok: true, updated: cells.length });
});

// Cria uma nova linha (referencia + [tipo_dimens] + nom_operacao) com células vazias para cada filial
router.post('/wide/:table/row', (req, res) => {
  const { table } = req.params;
  const cfg = WIDE_TABLES[table];
  if (!cfg) return res.status(404).json({ error: 'tabela desconhecida' });
  const { referencia, tipo_dimens, nom_operacao } = req.body;
  if (!referencia || !nom_operacao || (cfg.hasTipoDimens && !tipo_dimens)) {
    return res.status(400).json({ error: 'referencia, nom_operacao (e tipo_dimens quando aplicável) são obrigatórios' });
  }
  const filiais = db.prepare('SELECT unidade FROM d_filiais ORDER BY rowid').all().map(r => r.unidade);
  const stmt = cfg.hasTipoDimens
    ? db.prepare(`INSERT OR IGNORE INTO ${table} (referencia, tipo_dimens, nom_operacao, unidade, valor) VALUES (?,?,?,?,NULL)`)
    : db.prepare(`INSERT OR IGNORE INTO ${table} (referencia, nom_operacao, unidade, valor) VALUES (?,?,?,NULL)`);
  const tx = db.transaction(() => {
    for (const u of filiais) {
      if (cfg.hasTipoDimens) stmt.run(referencia, tipo_dimens, nom_operacao, u);
      else stmt.run(referencia, nom_operacao, u);
    }
  });
  tx();
  res.json({ ok: true });
});

// Remove uma linha inteira (todas as filiais daquela referencia+[tipo_dimens]+nom_operacao)
router.delete('/wide/:table/row', (req, res) => {
  const { table } = req.params;
  const cfg = WIDE_TABLES[table];
  if (!cfg) return res.status(404).json({ error: 'tabela desconhecida' });
  const { referencia, tipo_dimens, nom_operacao } = req.body;
  if (cfg.hasTipoDimens) {
    db.prepare(`DELETE FROM ${table} WHERE referencia=? AND tipo_dimens=? AND nom_operacao=?`).run(referencia, tipo_dimens, nom_operacao);
  } else {
    db.prepare(`DELETE FROM ${table} WHERE referencia=? AND nom_operacao=?`).run(referencia, nom_operacao);
  }
  res.json({ ok: true });
});

// ============================================================
// Tabelas "chatas" (dimensões, premissas, unitários) - CRUD genérico por PK
// ============================================================
router.get('/flat/:table', (req, res) => {
  const { table } = req.params;
  if (!FLAT_TABLES[table]) return res.status(404).json({ error: 'tabela desconhecida' });
  res.json(db.prepare(`SELECT * FROM ${table}`).all());
});

router.post('/flat/:table', (req, res) => {
  const { table } = req.params;
  const cfg = FLAT_TABLES[table];
  if (!cfg) return res.status(404).json({ error: 'tabela desconhecida' });
  const cols = columnsOf(table);
  const rec = req.body;
  const placeholders = cols.map(() => '?').join(',');
  db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`).run(...cols.map(c => rec[c] ?? null));
  res.json({ ok: true });
});

router.put('/flat/:table', (req, res) => {
  const { table } = req.params;
  const cfg = FLAT_TABLES[table];
  if (!cfg) return res.status(404).json({ error: 'tabela desconhecida' });
  const cols = columnsOf(table);
  const rec = req.body;
  const setCols = cols.filter(c => !cfg.pk.includes(c));
  const setClause = setCols.map(c => `${c} = ?`).join(', ');
  const whereClause = cfg.pk.map(c => `${c} = ?`).join(' AND ');
  db.prepare(`UPDATE ${table} SET ${setClause} WHERE ${whereClause}`)
    .run(...setCols.map(c => rec[c] ?? null), ...cfg.pk.map(c => rec[c]));
  res.json({ ok: true });
});

router.delete('/flat/:table', (req, res) => {
  const { table } = req.params;
  const cfg = FLAT_TABLES[table];
  if (!cfg) return res.status(404).json({ error: 'tabela desconhecida' });
  const rec = req.body;
  const whereClause = cfg.pk.map(c => `${c} = ?`).join(' AND ');
  db.prepare(`DELETE FROM ${table} WHERE ${whereClause}`).run(...cfg.pk.map(c => rec[c]));
  res.json({ ok: true });
});

// ============================================================
// Resultado calculado (equivalente à aba ANALITICO)
// ============================================================
router.get('/resultado', (req, res) => {
  const ano = parseInt(req.query.ano, 10) || new Date().getFullYear();
  const responsavelPcp = req.query.responsavel || null;
  const apenasComCusto = req.query.apenasComCusto !== '0';
  try {
    const rows = buildFinal(ano, { responsavelPcp, apenasComCusto });
    res.json({ ano, count: rows.length, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Painel gerencial: agregações por dimensão escolhida
// ============================================================
router.get('/dashboard', (req, res) => {
  const ano = parseInt(req.query.ano, 10) || new Date().getFullYear();
  const groupBy = (req.query.groupBy || 'diretoria');
  const allowed = new Set(['diretoria', 'site', 'cliente', 'referencia', 'operacao', 'un_dre']);
  const g = allowed.has(groupBy) ? groupBy : 'diretoria';
  try {
    const rows = buildFinal(ano, { responsavelPcp: req.query.responsavel || null, apenasComCusto: true });
    const agg = new Map();
    for (const r of rows) {
      const key = r[g] ?? '(sem valor)';
      if (!agg.has(key)) agg.set(key, { chave: key, hc_dim: 0, fte_financeiro: 0, receita_bruta: 0, qtd_linhas: 0 });
      const a = agg.get(key);
      a.hc_dim += r.hc_dim || 0;
      a.fte_financeiro += r.fte_financeiro || 0;
      a.receita_bruta += r.receita_bruta || 0;
      a.qtd_linhas++;
    }
    const totals = rows.reduce((acc, r) => {
      acc.hc_dim += r.hc_dim || 0;
      acc.fte_financeiro += r.fte_financeiro || 0;
      acc.receita_bruta += r.receita_bruta || 0;
      return acc;
    }, { hc_dim: 0, fte_financeiro: 0, receita_bruta: 0 });
    res.json({ ano, groupBy: g, totals, grupos: [...agg.values()].sort((a, b) => b.fte_financeiro - a.fte_financeiro) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
