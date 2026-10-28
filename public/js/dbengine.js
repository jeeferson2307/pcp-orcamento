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

  // A superficie (prepare/exec/transaction) montada sobre um banco sql.js.
  // Separada de wrap() porque o Comparativo precisa de uma SEGUNDA instancia,
  // sobre um clone em memoria, sem mexer no window.DB de trabalho.
  function montarApi(rawDb) {
    return {
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

  function wrap(rawDb) {
    sqljsDb = rawDb;
    window.DB = montarApi(rawDb);
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
    if (colsOp.includes('desc_centro_de_custo')) migrarCentroDeCusto();
  }

  // Centro de custo deixou de ser um punhado de colunas copiadas dentro de
  // cadastro_operacoes e virou a dimensao d_centro_custo. Esta migracao roda
  // uma unica vez, quando o banco ainda tem o formato antigo.
  //
  // Como os dados vinham denormalizados, o MESMO codigo podia aparecer com
  // atributos diferentes em linhas diferentes (descricao com acento numa linha
  // e sem acento noutra, UN DRE digitada errada, responsavel trocado). Ao
  // normalizar, cada codigo passa a ter um conjunto so de atributos: vence a
  // combinacao mais frequente; em caso de empate, a primeira encontrada.
  // As combinacoes descartadas nao somem caladas - ficam registradas em
  // tb_config, e a tela de Centro de Custo mostra o aviso para o usuario
  // conferir e corrigir.
  const CAMPOS_CC = ['desc_centro_de_custo', 'cliente', 'cod_empresa', 'cod_filial',
                     'un_dre', 'diretoria', 'gerente', 'responsavel_pcp', 'responsavel_fpa'];

  function migrarCentroDeCusto() {
    const DB = window.DB;
    const linhas = DB.prepare('SELECT * FROM cadastro_operacoes').all();

    // agrupa por codigo, contando cada combinacao distinta de atributos
    const porCodigo = new Map();
    let semCodigo = 0;
    for (const r of linhas) {
      const cod = r.cod_centro_de_custo == null ? '' : String(r.cod_centro_de_custo).trim();
      if (!cod) { semCodigo++; continue; }
      if (!porCodigo.has(cod)) porCodigo.set(cod, new Map());
      const variantes = porCodigo.get(cod);
      const assinatura = JSON.stringify(CAMPOS_CC.map(c => r[c] ?? null));
      if (!variantes.has(assinatura)) variantes.set(assinatura, { valores: CAMPOS_CC.map(c => r[c] ?? null), qtd: 0, exemplos: [] });
      const v = variantes.get(assinatura);
      v.qtd++;
      if (v.exemplos.length < 3) v.exemplos.push(`${r.operacao} / ${r.filial}`);
    }

    const conflitos = [];
    const centros = [];
    for (const [cod, variantes] of porCodigo) {
      const lista = [...variantes.values()];
      const vencedora = lista.reduce((a, b) => (b.qtd > a.qtd ? b : a), lista[0]);
      centros.push([cod, ...vencedora.valores]);
      if (lista.length > 1) {
        const campoDe = (vals) => Object.fromEntries(CAMPOS_CC.map((c, i) => [c, vals[i]]));
        conflitos.push({
          cod,
          adotado: campoDe(vencedora.valores),
          descartados: lista.filter(v => v !== vencedora).map(v => ({ valores: campoDe(v.valores), ocorrencias: v.qtd, exemplos: v.exemplos })),
          // só os campos que realmente divergem, para o aviso ficar legível
          campos_divergentes: CAMPOS_CC.filter(c => new Set(lista.map(v => String(v.valores[CAMPOS_CC.indexOf(c)]))).size > 1),
        });
      }
    }

    const tx = DB.transaction(() => {
      const insCc = DB.prepare(`INSERT OR REPLACE INTO d_centro_custo
        (cod_centro_de_custo, ${CAMPOS_CC.join(', ')}) VALUES (${['?', ...CAMPOS_CC.map(() => '?')].join(',')})`);
      // String() em tudo: a coluna é TEXT e o código pode ter vindo do Excel
      // como número, o que faria o join falhar por diferença de tipo.
      for (const c of centros) insCc.run(...c);

      // SQLite nao remove varias colunas de uma vez: recria a tabela no
      // formato novo e traz so o que continua pertencendo a operacao.
      DB.exec(`CREATE TABLE cadastro_operacoes_novo (
        operacao TEXT NOT NULL, filial TEXT NOT NULL,
        cod_centro_de_custo TEXT, tipo_escala TEXT,
        PRIMARY KEY (filial, operacao))`);
      const insOp = DB.prepare('INSERT OR REPLACE INTO cadastro_operacoes_novo (operacao, filial, cod_centro_de_custo, tipo_escala) VALUES (?,?,?,?)');
      for (const r of linhas) {
        const cod = r.cod_centro_de_custo == null ? null : String(r.cod_centro_de_custo).trim() || null;
        insOp.run(r.operacao, r.filial, cod, r.tipo_escala ?? null);
      }
      DB.exec('DROP TABLE cadastro_operacoes');
      DB.exec('ALTER TABLE cadastro_operacoes_novo RENAME TO cadastro_operacoes');

      const relatorio = JSON.stringify({
        em: new Date().toISOString(),
        centros: centros.length,
        operacoes: linhas.length,
        operacoes_sem_codigo: semCodigo,
        conflitos,
      });
      DB.exec(`CREATE TABLE IF NOT EXISTS tb_config (chave TEXT PRIMARY KEY, texto TEXT)`);
      DB.prepare('INSERT OR REPLACE INTO tb_config (chave, texto) VALUES (?, ?)').run('migracao_centro_custo', relatorio);
    });
    tx();
    console.info(`Centro de custo normalizado: ${centros.length} centros a partir de ${linhas.length} operações.`
      + (conflitos.length ? ` ${conflitos.length} código(s) tinham dados divergentes — ver aviso na tela de Centro de Custo.` : ''));
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

    // Copia do banco atual, em memoria, com a mesma superficie de window.DB.
    // Usada pelo Comparativo para recalcular uma versao antiga com o motor de
    // hoje sem encostar no arquivo de trabalho. Quem chama DEVE dar close().
    cloneAtual() {
      const clone = new SQL.Database(sqljsDb.export());
      return { api: montarApi(clone), close: () => clone.close() };
    },
  };
})();
