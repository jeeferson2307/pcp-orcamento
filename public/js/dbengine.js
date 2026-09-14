// Motor SQLite 100% client-side (sql.js / WebAssembly, sem servidor).
// Expõe window.DB com a MESMA superfície usada por calc.js/store.js:
//   DB.prepare(sql).all(...params) / .get(...params) / .run(...params)
//   DB.exec(sql)
//   DB.transaction(fn)
const Engine = (() => {
  let SQL = null;
  let sqljsDb = null;

  function base64ToUint8Array(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function ensureSql() {
    if (SQL) return SQL;
    const wasmBinary = base64ToUint8Array(SQL_WASM_BASE64).buffer;
    SQL = await initSqlJs({ wasmBinary });
    return SQL;
  }

  function wrap(rawDb) {
    sqljsDb = rawDb;
    window.DB = {
      _raw: rawDb,
      exec(sql) { rawDb.run(sql); },
      prepare(sql) {
        return {
          all(...params) {
            const stmt = rawDb.prepare(sql);
            try {
              if (params.length) stmt.bind(params);
              const rows = [];
              while (stmt.step()) rows.push(stmt.getAsObject());
              return rows;
            } finally { stmt.free(); }
          },
          get(...params) {
            const stmt = rawDb.prepare(sql);
            try {
              if (params.length) stmt.bind(params);
              return stmt.step() ? stmt.getAsObject() : undefined;
            } finally { stmt.free(); }
          },
          run(...params) {
            const stmt = rawDb.prepare(sql);
            try {
              if (params.length) stmt.bind(params);
              stmt.step();
              return { changes: rawDb.getRowsModified() };
            } finally { stmt.free(); }
          },
        };
      },
      transaction(fn) {
        return (...args) => {
          rawDb.run('BEGIN');
          try {
            const result = fn(...args);
            rawDb.run('COMMIT');
            return result;
          } catch (e) {
            rawDb.run('ROLLBACK');
            throw e;
          }
        };
      },
      pragma() {},
    };
  }

  // Bancos .sqlite antigos (criados antes de uma coluna nova ser adicionada ao
  // schema) não ganham a coluna automaticamente via CREATE TABLE IF NOT EXISTS
  // — por isso este passo de migração roda sempre, adicionando só o que faltar.
  function migrate() {
    const colsOp = window.DB.prepare(`PRAGMA table_info(cadastro_operacoes)`).all().map(c => c.name);
    if (!colsOp.includes('tipo_escala')) {
      window.DB.exec(`ALTER TABLE cadastro_operacoes ADD COLUMN tipo_escala TEXT`);
    }
    const colsDimens = window.DB.prepare(`PRAGMA table_info(tb_premissas_dimens)`).all().map(c => c.name);
    if (!colsDimens.includes('ocupacao_garantia')) {
      window.DB.exec(`ALTER TABLE tb_premissas_dimens ADD COLUMN ocupacao_garantia REAL`);
    }
  }

  return {
    async openFromBytes(uint8arr) {
      await ensureSql();
      wrap(new SQL.Database(uint8arr));
      window.DB.exec(SCHEMA_SQL);
      migrate();
    },
    async createEmpty() {
      await ensureSql();
      wrap(new SQL.Database());
      window.DB.exec(SCHEMA_SQL);
      migrate();
    },
    exportBytes() {
      return sqljsDb.export();
    },
  };
})();
