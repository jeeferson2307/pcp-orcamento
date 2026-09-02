// Importa os dados atuais do MODEL.xlsb para o SQLite local.
// Roda uma única vez (ou sempre que quiser re-carregar a base a partir da planilha original).
// Depois disso, toda edição passa a ser feita pelo próprio sistema web (não precisa reabrir o Excel).
const path = require('path');
const XLSX = require('xlsx');
const db = require('./db');
const { WIDE_TABLES } = require('./tablesConfig');

const SOURCE_XLSB = process.argv[2] || path.join(__dirname, '..', '..', 'MODEL.xlsb');

function toRefDate(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  }
  return String(v);
}

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Aba não encontrada no MODEL.xlsb: ${name}`);
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const headers = aoa[0];
  return aoa.slice(1).map(row => {
    const rec = {};
    headers.forEach((h, i) => {
      if (h != null && h !== '') rec[h] = row[i];
    });
    return rec;
  }).filter(rec => Object.keys(rec).length > 0 && !Object.values(rec).every(v => v == null));
}

function main() {
  console.log('Lendo', SOURCE_XLSB);
  const wb = XLSX.readFile(SOURCE_XLSB, { cellDates: true });

  db.exec('BEGIN');
  try {
    // ---------------- Dimensões ----------------
    db.exec('DELETE FROM d_filiais');
    const insFiliais = db.prepare(`INSERT INTO d_filiais (cod_empresa, nom_empresa, cod_filial, unidade) VALUES (?,?,?,?)`);
    for (const r of sheetRows(wb, 'D_FILIAIS')) {
      insFiliais.run(r.COD_EMPRESA, r.NOM_EMPRESA, r.COD_FILIAL, r.UNIDADE);
    }

    // Cadastro único de Operações = D_OPERACOES mesclado com D_CENTRO_CUSTO
    // (mesma junção que a query M fazia na Fase 13, feita aqui uma única vez).
    const centrosCusto = new Map();
    for (const r of sheetRows(wb, 'D_CENTRO_CUSTO')) {
      centrosCusto.set(String(r.COD_CENTRO_DE_CUSTO), r);
    }
    db.exec('DELETE FROM cadastro_operacoes');
    const insOp = db.prepare(`INSERT OR REPLACE INTO cadastro_operacoes
      (cod_centro_de_custo, desc_centro_de_custo, cliente, cod_empresa, operacao, cod_filial, filial, un_dre, diretoria, gerente, responsavel_pcp, responsavel_fpa)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of sheetRows(wb, 'D_OPERACOES')) {
      const codCC = r.COD_CENTRO_DE_CUSTO != null ? String(r.COD_CENTRO_DE_CUSTO) : null;
      const cc = centrosCusto.get(codCC) || {};
      insOp.run(
        codCC, cc.DESC_CENTRO_DE_CUSTO ?? null, cc.CLIENTE ?? null, cc.COD_EMPRESA ?? null,
        r.OPERACAO, cc.COD_FILIAL ?? null, r.FILIAL,
        cc.UN_DRE ?? null, cc.DIRETORIA ?? null, cc.GERENTE ?? null, cc.RESPONSAVEL_PCP ?? null, cc['RESPONSAVEL_FP&A'] ?? null
      );
    }

    // ---------------- Premissas de dimensionamento ----------------
    db.exec('DELETE FROM tb_premissas_dimens');
    const insPrem = db.prepare(`INSERT OR REPLACE INTO tb_premissas_dimens
      (referencia, tipo_dimens, nom_operacao, volume, tma, dmm, hmm, pausa, ocupacao, hc_dimensionado, hc_contratado)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of sheetRows(wb, 'TB_PREMISSAS_DIMENS')) {
      insPrem.run(
        toRefDate(r.REFERENCIA), r.TIPO_DIMENS, r.NOM_OPERACAO, r.VOLUME, r.TMA, r.DMM, r.HMM,
        r.PAUSA, r['OCUPAÇÃO'], r.HC_DIMENSIONADO, r.HC_CONTRATADO
      );
    }

    // ---------------- Unitários ----------------
    db.exec('DELETE FROM tb_unitarios');
    const insUnit = db.prepare(`INSERT OR REPLACE INTO tb_unitarios
      (filial, operacao, unitario_g3, abandono, shortcalls, tipo_faturamento) VALUES (?,?,?,?,?,?)`);
    for (const r of sheetRows(wb, 'TB_UNITARIOS')) {
      insUnit.run(r.FILIAL, r.OPERACAO, r.UNITARIO_G3, r.ABANDONO, r.SHORTCALLS, r.TIPO_FATURAMENTO);
    }

    // ---------------- Tabelas largas (unpivot) ----------------
    const SHEET_BY_TABLE = {
      tb_abs: 'TB_ABS', tb_to: 'TB_TO', tb_ferias: 'TB_FERIAS', tb_folga: 'TB_FOLGA',
      tb_evasoes: 'TB_EVASOES', tb_contratacoes_adicionais: 'TB_CONTRATACOES_ADICIONAIS',
      tb_distribuicao_volume: 'TB_DISTRIBUICAO_VOLUME', tb_distribuicao_hc: 'TB_DISTRIBUICAO_HC',
      tb_cprb: 'TB_CPRB', tb_reajuste: 'TB_REAJUSTE',
      tb_esc_feriados_nac: 'TB_ESC_FERIADOS_NAC', tb_esc_feriados_loc: 'TB_ESC_FERIADOS_LOC',
      tb_jovens: 'TB_JOVENS', tb_spam: 'TB_SPAM', tb_bodyshop: 'TB_BODYSHOP',
    };
    const KNOWN_ID_COLS = new Set(['REFERENCIA', 'TIPO_DIMENS', 'NOM_OPERACAO']);

    for (const [table, cfg] of Object.entries(WIDE_TABLES)) {
      const sheetName = SHEET_BY_TABLE[table];
      db.exec(`DELETE FROM ${table}`);
      const cols = cfg.hasTipoDimens
        ? '(referencia, tipo_dimens, nom_operacao, unidade, valor)'
        : '(referencia, nom_operacao, unidade, valor)';
      const qs = cfg.hasTipoDimens ? '(?,?,?,?,?)' : '(?,?,?,?)';
      const ins = db.prepare(`INSERT OR REPLACE INTO ${table} ${cols} VALUES ${qs}`);

      const rows = sheetRows(wb, sheetName);
      let n = 0;
      for (const r of rows) {
        const ref = toRefDate(r.REFERENCIA);
        const operacao = r.NOM_OPERACAO;
        if (!ref || !operacao) continue;
        for (const [key, val] of Object.entries(r)) {
          if (KNOWN_ID_COLS.has(key)) continue;
          const unidade = key;
          if (cfg.hasTipoDimens) {
            ins.run(ref, r.TIPO_DIMENS, operacao, unidade, val);
          } else {
            ins.run(ref, operacao, unidade, val);
          }
          n++;
        }
      }
      console.log(`  ${table} <- ${sheetName}: ${rows.length} linhas / ${n} células`);
    }

    db.exec('COMMIT');
    console.log('Seed concluído com sucesso.');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

main();
