// ===================================================================
// Versionamento do orçamento, dentro do próprio arquivo .sqlite.
//
// Modelo: LOG DE ALTERAÇÕES + MARCOS DE VERSÃO.
//
// A unidade versionada é a CÉLULA, não o banco. Cada gravação feita pelo
// Store registra uma linha em tb_alteracoes com o valor antes e depois, mais
// quem mexeu, quem pediu e por quê. Uma "versão" é só um corte nesse log
// (tb_versoes.ultima_alteracao_id = "a versão 4 é tudo até a alteração 1572").
//
// Consequências:
//  - os dados completos continuam existindo uma única vez (as tabelas de
//    sempre = versão de trabalho). Nada de snapshot de 1,1 MB por versão num
//    arquivo que é reescrito inteiro a cada edição;
//  - calc.js não muda: o motor validado continua lendo as tabelas normais;
//  - o diff de ENTRADAS entre duas versões é uma leitura do log, sem
//    reconstruir estado nenhum;
//  - para voltar no tempo basta desfazer, de trás pra frente, as alterações
//    posteriores ao corte (cada linha guarda o "antes").
//
// Os INDICADORES (que são calculados, não cadastrados) ficam congelados em
// tb_versao_resultado no momento em que a versão é criada — é a verdade de
// auditoria do que foi publicado. A tela de Comparativo também sabe
// recalcular uma versão antiga com o motor ATUAL (num clone do banco em
// memória), para separar "mudou o dado" de "mudou a fórmula".
// ===================================================================

// Sobe quando calc.js muda. Fica aqui (e não em calc.js) para manter o motor
// de cálculo intocado — ele é validado linha a linha contra o Excel original.
const ENGINE_VERSAO = '2026.10.27';

// Colunas do resultado congeladas por versão: o recorte do Analítico que a
// tela de Comparativo precisa, não as ~60 colunas inteiras (seriam 0,33 MB
// por versão em vez de ~0,1 MB).
const CAMPOS_RESULTADO_DIM = ['referencia', 'operacao', 'site', 'un_dre', 'diretoria', 'cliente', 'gerente', 'cod_cc', 'desc_centro_custo'];
const CAMPOS_RESULTADO_NUM = ['receita_bruta', 'fte_financeiro', 'hc_dim', 'hc_treinamento', 'volume_revisado', 'tma',
                              'unitario_reajustado', 'numerador_faturamento', 'absenteismo', 'turnover', 'ferias', 'folga_extra'];

// Indicadores oferecidos na tela de Comparativo. `tipo`:
//   soma      - agrega somando (Receita, FTE, HC...)
//   ponderado - média ponderada por HC Dimensionado (mesma regra do Painel)
//   derivado  - calculado a partir dos agregados (ROB, Unitário médio, TMA)
const INDICADORES_COMPARATIVO = [
  { key: 'receita_bruta', label: 'Receita Bruta', tipo: 'soma', format: 'currency' },
  { key: 'fte_financeiro', label: 'FTE Financeiro', tipo: 'soma', format: 'number' },
  { key: 'hc_dim', label: 'HC Dimensionado', tipo: 'soma', format: 'number' },
  { key: 'hc_treinamento', label: 'HC Treinamento', tipo: 'soma', format: 'number' },
  { key: 'volume_revisado', label: 'Volume', tipo: 'soma', format: 'number' },
  { key: 'rob_financeiro', label: 'ROB / Financeiro', tipo: 'derivado', format: 'currency' },
  { key: 'unitario_medio', label: 'Unitário médio', tipo: 'derivado', format: 'currency' },
  { key: 'tma', label: 'TMA', tipo: 'derivado', format: 'number' },
  { key: 'absenteismo', label: 'Absenteísmo', tipo: 'ponderado', format: 'percent' },
  { key: 'turnover', label: 'Turnover', tipo: 'ponderado', format: 'percent' },
  { key: 'ferias', label: 'Férias', tipo: 'ponderado', format: 'percent' },
  { key: 'folga_extra', label: 'Folga Extra', tipo: 'ponderado', format: 'percent' },
];

// Formato de cada campo cadastrável, para o histórico mostrar "6,50%" em vez
// de "0.065". Mapa explícito de propósito: as listas equivalentes moram em
// cadastros.js, que só é carregado depois deste arquivo.
const FORMATO_CAMPOS_FLAT = {
  tb_premissas_dimens: {
    volume: 'number', tma: 'number', dmm: 'number', hmm: 'number', pausa: 'percent',
    ocupacao: 'decimal1', hc_dimensionado: 'number', hc_contratado: 'number',
    ocupacao_garantia: 'percent', tipo_dimens: 'texto',
  },
  tb_ajuste_premissas: { ajuste_volume: 'percent', ajuste_tma: 'percent', ajuste_pausa: 'percent' },
  tb_unitarios: { unitario_g3: 'currency', abandono: 'percent', shortcalls: 'percent', tipo_faturamento: 'texto' },
  tb_parametros: { valor: 'number' },
};

const ROTULO_CAMPOS = {
  tb_premissas_dimens: {
    volume: 'Volume', tma: 'TMA', dmm: 'DMM', hmm: 'HMM', pausa: 'Pausa', ocupacao: 'Ocupação',
    hc_dimensionado: 'HC Dimensionado', hc_contratado: 'HC Contratado', ocupacao_garantia: 'Ocupação Garantia',
  },
  tb_ajuste_premissas: { ajuste_volume: 'Ajuste Volume', ajuste_tma: 'Ajuste TMA', ajuste_pausa: 'Ajuste Pausa' },
  tb_unitarios: { unitario_g3: 'Unitário G3', abandono: 'Abandono', shortcalls: 'Shortcalls', tipo_faturamento: 'Tipo Faturamento' },
};

const ROTULO_TABELAS = {
  tb_premissas_dimens: 'Dimensionamento',
  tb_ajuste_premissas: 'Ajuste Premissas',
  tb_unitarios: 'Unitário de Faturamento',
  cadastro_operacoes: 'Cadastro Operações',
  d_filiais: 'Filiais / Unidades',
  tb_parametros: 'Parâmetros',
};

const Versionamento = (() => {
  // Desligado durante restauração em lote e durante a simulação num clone —
  // nesses momentos as gravações não são edições do usuário.
  let registrando = true;
  let contexto = null;   // { autor, solicitante, motivo } — carregado sob demanda

  function agora() { return new Date().toISOString(); }

  // ---------------------------------------------------------------
  // Chaves primárias: derivadas dos metadados que já existem, para não criar
  // uma terceira lista de tabelas que precise ser mantida em sincronia.
  // ---------------------------------------------------------------
  function pkDe(tabela) {
    if (typeof WIDE_TABLES !== 'undefined' && WIDE_TABLES[tabela]) {
      return WIDE_TABLES[tabela].hasTipoDimens
        ? ['referencia', 'tipo_dimens', 'nom_operacao', 'unidade']
        : ['referencia', 'nom_operacao', 'unidade'];
    }
    if (typeof FLAT_TABLES !== 'undefined' && FLAT_TABLES[tabela]) return FLAT_TABLES[tabela].pk;
    if (tabela === 'tb_parametros') return ['chave'];
    return null;
  }

  function serializarChave(tabela, obj) {
    const pk = pkDe(tabela) || Object.keys(obj);
    const out = {};
    for (const c of pk) out[c] = obj[c] ?? null;
    return JSON.stringify(out);
  }

  // Dimensões legíveis extraídas da chave, para filtrar/ler o histórico sem
  // ter que desserializar JSON na tela.
  function dimensoesDe(chaveObj) {
    return {
      referencia: chaveObj.referencia ?? null,
      nom_operacao: chaveObj.nom_operacao ?? chaveObj.operacao ?? null,
      unidade: chaveObj.unidade ?? chaveObj.filial ?? null,
    };
  }

  function formatoDe(tabela, campo) {
    if (typeof WIDE_TABLES !== 'undefined' && WIDE_TABLES[tabela]) return WIDE_TABLES[tabela].format || 'number';
    const mapa = FORMATO_CAMPOS_FLAT[tabela];
    if (mapa && mapa[campo]) return mapa[campo];
    return 'texto';
  }

  function rotuloTabela(tabela) {
    if (typeof WIDE_TABLES !== 'undefined' && WIDE_TABLES[tabela]) return WIDE_TABLES[tabela].label;
    return ROTULO_TABELAS[tabela] || tabela;
  }

  function rotuloCampo(tabela, campo) {
    if (typeof WIDE_TABLES !== 'undefined' && WIDE_TABLES[tabela]) return WIDE_TABLES[tabela].valueLabel || 'Valor';
    const mapa = ROTULO_CAMPOS[tabela];
    if (mapa && mapa[campo]) return mapa[campo];
    if (typeof FLAT_TABLES !== 'undefined' && FLAT_TABLES[tabela] && FLAT_TABLES[tabela].fields) {
      const f = FLAT_TABLES[tabela].fields.find(x => x.key === campo);
      if (f) return f.label;
    }
    return campo;
  }

  // ---------------------------------------------------------------
  // Contexto (quem mexeu / quem pediu / por quê)
  // ---------------------------------------------------------------
  function lerConfig(chave) {
    const row = DB.prepare('SELECT texto FROM tb_config WHERE chave = ?').get(chave);
    return row ? row.texto : null;
  }

  function gravarConfig(chave, texto) {
    const existe = DB.prepare('SELECT chave FROM tb_config WHERE chave = ?').get(chave);
    if (existe) DB.prepare('UPDATE tb_config SET texto = ? WHERE chave = ?').run(texto, chave);
    else DB.prepare('INSERT INTO tb_config (chave, texto) VALUES (?, ?)').run(chave, texto);
  }

  function getContexto() {
    if (!contexto) {
      contexto = {
        autor: lerConfig('autor') || '',
        solicitante: lerConfig('solicitante') || '',
        motivo: lerConfig('motivo') || '',
      };
    }
    return { ...contexto };
  }

  function setContexto({ autor, solicitante, motivo }) {
    contexto = {
      autor: autor ?? getContexto().autor,
      solicitante: solicitante ?? getContexto().solicitante,
      motivo: motivo ?? getContexto().motivo,
    };
    gravarConfig('autor', contexto.autor);
    gravarConfig('solicitante', contexto.solicitante);
    gravarConfig('motivo', contexto.motivo);
    return { ...contexto };
  }

  // ---------------------------------------------------------------
  // Registro de alterações
  // ---------------------------------------------------------------
  const INSERT_ALT = `INSERT INTO tb_alteracoes
    (momento, autor, solicitante, motivo, acao, tabela, chave, referencia, nom_operacao, unidade,
     campo, valor_antes, texto_antes, valor_depois, texto_depois, versao_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`;

  function ehNumero(v) { return typeof v === 'number' && !Number.isNaN(v); }

  function mesmoValor(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (ehNumero(a) && ehNumero(b)) return Math.abs(a - b) < 1e-12;
    return String(a) === String(b);
  }

  // `acao`: 'alterou' | 'criou' | 'excluiu'
  function registrar({ acao = 'alterou', tabela, chaveObj, campo, antes, depois }) {
    if (!registrando) return;
    if (acao === 'alterou' && mesmoValor(antes, depois)) return;   // não polui o log com no-op
    const ctx = getContexto();
    const chave = serializarChave(tabela, chaveObj);
    const dim = dimensoesDe(chaveObj);
    DB.prepare(INSERT_ALT).run(
      agora(), ctx.autor || null, ctx.solicitante || null, ctx.motivo || null, acao,
      tabela, chave, dim.referencia, dim.nom_operacao, dim.unidade, campo,
      ehNumero(antes) ? antes : null, ehNumero(antes) || antes == null ? null : String(antes),
      ehNumero(depois) ? depois : null, ehNumero(depois) || depois == null ? null : String(depois),
    );
  }

  function valorDaLinha(row, sufixo) {
    const num = row['valor_' + sufixo];
    const txt = row['texto_' + sufixo];
    return num != null ? num : (txt != null ? txt : null);
  }

  // ---------------------------------------------------------------
  // Aplicar/desfazer no banco apontado por window.DB (o real, na restauração;
  // um clone em memória, na simulação do Comparativo).
  // ---------------------------------------------------------------
  function whereDaChave(tabela, chaveObj) {
    const pk = pkDe(tabela);
    const cols = pk.filter(c => chaveObj[c] != null);
    const nulos = pk.filter(c => chaveObj[c] == null);
    const where = [...cols.map(c => `${c} = ?`), ...nulos.map(c => `${c} IS NULL`)].join(' AND ');
    return { where, params: cols.map(c => chaveObj[c]) };
  }

  function excluirLinha(tabela, chaveObj) {
    const { where, params } = whereDaChave(tabela, chaveObj);
    DB.prepare(`DELETE FROM ${tabela} WHERE ${where}`).run(...params);
  }

  function gravarCampo(tabela, chaveObj, campo, valor) {
    const { where, params } = whereDaChave(tabela, chaveObj);
    const existe = DB.prepare(`SELECT 1 AS x FROM ${tabela} WHERE ${where}`).get(...params);
    if (existe) {
      DB.prepare(`UPDATE ${tabela} SET ${campo} = ? WHERE ${where}`).run(valor, ...params);
      return;
    }
    const pk = pkDe(tabela);
    const cols = [...pk, campo];
    const vals = [...pk.map(c => chaveObj[c] ?? null), valor];
    DB.prepare(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  }

  function lerCampo(tabela, chaveObj, campo) {
    const { where, params } = whereDaChave(tabela, chaveObj);
    const row = DB.prepare(`SELECT ${campo} AS v FROM ${tabela} WHERE ${where}`).get(...params);
    return row ? row.v : null;
  }

  // Desfaz, do mais novo para o mais antigo, tudo que veio depois do corte.
  // `logar`: true na restauração de verdade (o histórico continua sendo
  // append-only e honesto), false na simulação sobre um clone.
  function desfazerAposCorte(corte, { logar }) {
    const posteriores = DB.prepare('SELECT * FROM tb_alteracoes WHERE id > ? ORDER BY id DESC').all(corte);
    for (const a of posteriores) {
      const chaveObj = JSON.parse(a.chave);
      const antes = valorDaLinha(a, 'antes');
      if (a.acao === 'criou') {
        // a linha nasceu depois do corte: na versão antiga ela não existia
        if (logar) {
          const atual = lerCampo(a.tabela, chaveObj, a.campo);
          registrar({ acao: 'excluiu', tabela: a.tabela, chaveObj, campo: a.campo, antes: atual, depois: null });
        }
        excluirLinha(a.tabela, chaveObj);
      } else {
        // 'alterou' e 'excluiu' voltam para o valor anterior (no 'excluiu'
        // isso recria a linha, porque gravarCampo faz upsert)
        if (logar) {
          const atual = lerCampo(a.tabela, chaveObj, a.campo);
          registrar({ acao: a.acao === 'excluiu' ? 'criou' : 'alterou', tabela: a.tabela, chaveObj, campo: a.campo, antes: atual, depois: antes });
        }
        gravarCampo(a.tabela, chaveObj, a.campo, antes);
      }
    }
    return posteriores.length;
  }

  // ---------------------------------------------------------------
  // Versões
  // ---------------------------------------------------------------
  function ultimaAlteracaoId() {
    const row = DB.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM tb_alteracoes').get();
    return row ? row.m : 0;
  }

  function anoProjecaoPadrao() {
    const anos = DB.prepare('SELECT referencia FROM tb_premissas_dimens WHERE referencia IS NOT NULL').all()
      .map(r => Number(r.referencia.slice(0, 4))).filter(a => !Number.isNaN(a));
    return anos.length ? Math.max(...anos) + 1 : new Date().getFullYear();
  }

  function listarVersoes() {
    return DB.prepare(`
      SELECT v.*, (SELECT COUNT(*) FROM tb_alteracoes a WHERE a.versao_id = v.id) AS qtd_alteracoes
      FROM tb_versoes v ORDER BY v.id DESC`).all();
  }

  function getVersao(id) {
    return DB.prepare('SELECT * FROM tb_versoes WHERE id = ?').get(Number(id));
  }

  function congelarResultado(versaoId, ano) {
    const rows = buildFinal(ano, { apenasComCusto: true });
    const cols = ['versao_id', ...CAMPOS_RESULTADO_DIM, ...CAMPOS_RESULTADO_NUM];
    const stmt = DB.prepare(`INSERT OR REPLACE INTO tb_versao_resultado (${cols.join(',')})
      VALUES (${cols.map(() => '?').join(',')})`);
    // Uma linha do resultado é (mês x operação x filial); o Analítico pode
    // trazer mais de uma linha por chave quando a operação tem mais de um
    // TIPO_DIMENS, então acumula antes de gravar.
    const acc = new Map();
    for (const r of rows) {
      const k = `${r.referencia}|${r.operacao}|${r.site}`;
      if (!acc.has(k)) {
        const base = { versao_id: versaoId };
        CAMPOS_RESULTADO_DIM.forEach(c => { base[c] = c === 'operacao' ? r.operacao : c === 'site' ? r.site : r[c] ?? null; });
        CAMPOS_RESULTADO_NUM.forEach(c => { base[c] = 0; });
        base._peso = 0;
        acc.set(k, base);
      }
      const o = acc.get(k);
      const peso = r.hc_dim || 0;
      o.receita_bruta += r.receita_bruta || 0;
      o.fte_financeiro += r.fte_financeiro || 0;
      o.hc_dim += peso;
      o.hc_treinamento += r.hc_treinamento || 0;
      o.volume_revisado += r._volume_revisado || 0;
      o.numerador_faturamento += r._numerador_faturamento || 0;
      // TMA e Unitário são médias ponderadas por volume/numerador; guarda o
      // produto e divide no fim.
      o.tma += (r._volume_revisado || 0) * (r._tma || 0);
      o.unitario_reajustado += (r._numerador_faturamento || 0) * (r.unitario_reajustado || 0);
      o.absenteismo += (r.absenteismo || 0) * peso;
      o.turnover += (r.turnover || 0) * peso;
      o.ferias += (r.ferias || 0) * peso;
      o.folga_extra += (r.folga_extra || 0) * peso;
      o._peso += peso;
    }
    const tx = DB.transaction(() => {
      for (const o of acc.values()) {
        o.tma = o.volume_revisado > 0 ? o.tma / o.volume_revisado : 0;
        o.unitario_reajustado = o.numerador_faturamento > 0 ? o.unitario_reajustado / o.numerador_faturamento : 0;
        if (o._peso > 0) {
          o.absenteismo /= o._peso; o.turnover /= o._peso; o.ferias /= o._peso; o.folga_extra /= o._peso;
        }
        stmt.run(...cols.map(c => o[c] ?? null));
      }
    });
    tx();
    return acc.size;
  }

  function criarVersao({ nome, descricao, ano }) {
    if (!nome || !nome.trim()) throw new Error('Informe um nome para a versão.');
    const ctx = getContexto();
    const corte = ultimaAlteracaoId();
    const anoProj = ano || anoProjecaoPadrao();
    DB.prepare(`INSERT INTO tb_versoes (nome, descricao, criado_em, criado_por, ultima_alteracao_id, ano_projecao, engine_versao)
                VALUES (?,?,?,?,?,?,?)`)
      .run(nome.trim(), descricao || null, agora(), ctx.autor || null, corte, anoProj, ENGINE_VERSAO);
    const id = DB.prepare('SELECT MAX(id) AS id FROM tb_versoes').get().id;
    // carimba no log tudo que ainda estava solto
    DB.prepare('UPDATE tb_alteracoes SET versao_id = ? WHERE versao_id IS NULL AND id <= ?').run(id, corte);
    const linhas = congelarResultado(id, anoProj);
    return { id, nome: nome.trim(), ano_projecao: anoProj, linhas_resultado: linhas };
  }

  function excluirVersao(id) {
    const v = getVersao(id);
    if (!v) throw new Error('Versão não encontrada.');
    DB.prepare('DELETE FROM tb_versao_resultado WHERE versao_id = ?').run(Number(id));
    DB.prepare('UPDATE tb_alteracoes SET versao_id = NULL WHERE versao_id = ?').run(Number(id));
    DB.prepare('DELETE FROM tb_versoes WHERE id = ?').run(Number(id));
    return { ok: true };
  }

  // Restaura o estado de uma versão nas tabelas de trabalho. Nunca reescreve
  // histórico: as reversões entram no log como alterações novas, com motivo
  // automático, e ao final nasce uma versão nova.
  function restaurarVersao(id) {
    const v = getVersao(id);
    if (!v) throw new Error('Versão não encontrada.');
    const ctxOriginal = getContexto();
    setContexto({ motivo: `Restauração da versão "${v.nome}"` });
    let desfeitas = 0;
    try {
      desfeitas = desfazerAposCorte(v.ultima_alteracao_id, { logar: true });
    } finally {
      setContexto({ solicitante: ctxOriginal.solicitante, motivo: ctxOriginal.motivo });
    }
    const nova = criarVersao({
      nome: `Restauração de "${v.nome}"`,
      descricao: `Estado restaurado a partir da versão #${v.id} (${v.nome}), desfazendo ${desfeitas} alteração(ões).`,
      ano: v.ano_projecao,
    });
    return { desfeitas, versao: nova };
  }

  // ---------------------------------------------------------------
  // Leitura do resultado de uma versão
  // ---------------------------------------------------------------
  function resultadoCongelado(versaoId) {
    return DB.prepare('SELECT * FROM tb_versao_resultado WHERE versao_id = ?').all(Number(versaoId));
  }

  // Resultado da versão de trabalho (estado atual), no mesmo formato do
  // congelado — para comparar o rascunho com a última versão publicada.
  function resultadoTrabalho(ano) {
    const anoProj = ano || anoProjecaoPadrao();
    const rows = buildFinal(anoProj, { apenasComCusto: true });
    return agregarResultado(rows);
  }

  function agregarResultado(rows) {
    const acc = new Map();
    for (const r of rows) {
      const k = `${r.referencia}|${r.operacao}|${r.site}`;
      if (!acc.has(k)) {
        const base = { referencia: r.referencia, operacao: r.operacao, site: r.site,
                       un_dre: r.un_dre, diretoria: r.diretoria, cliente: r.cliente,
                       gerente: r.gerente, cod_cc: r.cod_cc, desc_centro_custo: r.desc_centro_custo };
        CAMPOS_RESULTADO_NUM.forEach(c => { base[c] = 0; });
        base._peso = 0;
        acc.set(k, base);
      }
      const o = acc.get(k);
      const peso = r.hc_dim || 0;
      o.receita_bruta += r.receita_bruta || 0;
      o.fte_financeiro += r.fte_financeiro || 0;
      o.hc_dim += peso;
      o.hc_treinamento += r.hc_treinamento || 0;
      o.volume_revisado += r._volume_revisado || 0;
      o.numerador_faturamento += r._numerador_faturamento || 0;
      o.tma += (r._volume_revisado || 0) * (r._tma || 0);
      o.unitario_reajustado += (r._numerador_faturamento || 0) * (r.unitario_reajustado || 0);
      o.absenteismo += (r.absenteismo || 0) * peso;
      o.turnover += (r.turnover || 0) * peso;
      o.ferias += (r.ferias || 0) * peso;
      o.folga_extra += (r.folga_extra || 0) * peso;
      o._peso += peso;
    }
    return [...acc.values()].map(o => {
      o.tma = o.volume_revisado > 0 ? o.tma / o.volume_revisado : 0;
      o.unitario_reajustado = o.numerador_faturamento > 0 ? o.unitario_reajustado / o.numerador_faturamento : 0;
      if (o._peso > 0) { o.absenteismo /= o._peso; o.turnover /= o._peso; o.ferias /= o._peso; o.folga_extra /= o._peso; }
      return o;
    });
  }

  // Recalcula uma versão antiga com o motor ATUAL, num CLONE do banco em
  // memória — o arquivo de trabalho não é tocado em momento nenhum. Serve
  // para separar "mudou o dado" de "mudou a fórmula" quando a versão foi
  // criada com um engine_versao diferente do de hoje.
  function resultadoRecalculado(versaoId) {
    const v = getVersao(versaoId);
    if (!v) throw new Error('Versão não encontrada.');
    const clone = Engine.cloneAtual();
    const original = window.DB;
    const registrandoAntes = registrando;
    window.DB = clone.api;
    registrando = false;
    try {
      desfazerAposCorte(v.ultima_alteracao_id, { logar: false });
      return agregarResultado(buildFinal(v.ano_projecao || anoProjecaoPadrao(), { apenasComCusto: true }));
    } finally {
      window.DB = original;
      registrando = registrandoAntes;
      clone.close();
    }
  }

  // ---------------------------------------------------------------
  // Histórico e diff de entradas
  // ---------------------------------------------------------------
  function historico({ versaoId, operacao, tabela, solicitante, busca, limite = 500 } = {}) {
    const cond = [];
    const params = [];
    if (versaoId === 'trabalho') cond.push('versao_id IS NULL');
    else if (versaoId) { cond.push('versao_id = ?'); params.push(Number(versaoId)); }
    if (operacao) { cond.push('nom_operacao = ?'); params.push(operacao); }
    if (tabela) { cond.push('tabela = ?'); params.push(tabela); }
    if (solicitante) { cond.push('solicitante = ?'); params.push(solicitante); }
    if (busca) {
      cond.push('(nom_operacao LIKE ? OR motivo LIKE ? OR solicitante LIKE ? OR autor LIKE ?)');
      const b = `%${busca}%`;
      params.push(b, b, b, b);
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    return DB.prepare(`SELECT * FROM tb_alteracoes ${where} ORDER BY id DESC LIMIT ?`).all(...params, limite);
  }

  function solicitantesConhecidos() {
    return DB.prepare(`SELECT DISTINCT solicitante FROM tb_alteracoes
                       WHERE solicitante IS NOT NULL AND solicitante <> '' ORDER BY solicitante`)
      .all().map(r => r.solicitante);
  }

  // Alterações líquidas entre dois cortes: por célula, o "antes" mais antigo
  // e o "depois" mais recente. Vai e volta no mesmo valor desaparece.
  function diffEntradas(corteA, corteB) {
    const de = Math.min(corteA, corteB);
    const ate = Math.max(corteA, corteB);
    const invertido = corteA > corteB;
    const rows = DB.prepare('SELECT * FROM tb_alteracoes WHERE id > ? AND id <= ? ORDER BY id').all(de, ate);
    const porCelula = new Map();
    for (const r of rows) {
      const k = `${r.tabela}|${r.chave}|${r.campo}`;
      if (!porCelula.has(k)) {
        porCelula.set(k, {
          tabela: r.tabela, chave: r.chave, campo: r.campo,
          referencia: r.referencia, nom_operacao: r.nom_operacao, unidade: r.unidade,
          antes: valorDaLinha(r, 'antes'), depois: valorDaLinha(r, 'depois'),
          edicoes: 0, quem: new Set(), motivos: new Set(), ultimo_momento: r.momento,
        });
      }
      const c = porCelula.get(k);
      c.depois = valorDaLinha(r, 'depois');
      c.edicoes++;
      c.ultimo_momento = r.momento;
      if (r.solicitante) c.quem.add(r.solicitante);
      if (r.motivo) c.motivos.add(r.motivo);
    }
    const saida = [];
    for (const c of porCelula.values()) {
      let antes = c.antes, depois = c.depois;
      if (invertido) { const t = antes; antes = depois; depois = t; }
      if (mesmoValor(antes, depois)) continue;
      saida.push({
        tabela: c.tabela, campo: c.campo, referencia: c.referencia,
        nom_operacao: c.nom_operacao, unidade: c.unidade,
        antes, depois, edicoes: c.edicoes, ultimo_momento: c.ultimo_momento,
        solicitantes: [...c.quem].join(', '),
        motivos: [...c.motivos].join(' · '),
        formato: formatoDe(c.tabela, c.campo),
        rotulo_tabela: rotuloTabela(c.tabela),
        rotulo_campo: rotuloCampo(c.tabela, c.campo),
      });
    }
    saida.sort((a, b) => (a.rotulo_tabela + a.nom_operacao + a.referencia).localeCompare(b.rotulo_tabela + b.nom_operacao + b.referencia));
    return saida;
  }

  // ---------------------------------------------------------------
  // Comparativo de indicadores
  // ---------------------------------------------------------------
  const AGRUPAMENTOS = {
    diretoria: 'Diretoria', site: 'Site / Filial', cliente: 'Cliente',
    operacao: 'Operação', referencia: 'Mês', un_dre: 'UN DRE',
    desc_centro_custo: 'Centro de Custo', gerente: 'Gerente',
    '': 'Total geral',
  };

  function resumir(lista) {
    const s = { receita_bruta: 0, fte_financeiro: 0, hc_dim: 0, hc_treinamento: 0,
                volume_revisado: 0, numerador_faturamento: 0, _tmaProd: 0, _unitProd: 0,
                absenteismo: 0, turnover: 0, ferias: 0, folga_extra: 0, _peso: 0 };
    for (const r of lista) {
      const peso = r.hc_dim || 0;
      s.receita_bruta += r.receita_bruta || 0;
      s.fte_financeiro += r.fte_financeiro || 0;
      s.hc_dim += peso;
      s.hc_treinamento += r.hc_treinamento || 0;
      s.volume_revisado += r.volume_revisado || 0;
      s.numerador_faturamento += r.numerador_faturamento || 0;
      s._tmaProd += (r.volume_revisado || 0) * (r.tma || 0);
      s._unitProd += (r.numerador_faturamento || 0) * (r.unitario_reajustado || 0);
      s.absenteismo += (r.absenteismo || 0) * peso;
      s.turnover += (r.turnover || 0) * peso;
      s.ferias += (r.ferias || 0) * peso;
      s.folga_extra += (r.folga_extra || 0) * peso;
      s._peso += peso;
    }
    if (s._peso > 0) { s.absenteismo /= s._peso; s.turnover /= s._peso; s.ferias /= s._peso; s.folga_extra /= s._peso; }
    s.tma = s.volume_revisado > 0 ? s._tmaProd / s.volume_revisado : 0;
    s.rob_financeiro = s.fte_financeiro > 0 ? s.receita_bruta / s.fte_financeiro : 0;
    s.unitario_medio = s.numerador_faturamento > 0 ? s.receita_bruta / s.numerador_faturamento : 0;
    return s;
  }

  function porGrupo(rows, campo) {
    const m = new Map();
    for (const r of rows) {
      const k = campo ? (r[campo] ?? '(sem valor)') : 'Total geral';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    const out = new Map();
    for (const [k, lista] of m) out.set(k, resumir(lista));
    return out;
  }

  function resultadoDe(ref, { recalcular }) {
    if (ref === 'trabalho') return { rows: resultadoTrabalho(), versao: null };
    const v = getVersao(ref);
    if (!v) throw new Error('Versão não encontrada: ' + ref);
    const rows = recalcular ? resultadoRecalculado(v.id) : resultadoCongelado(v.id);
    return { rows, versao: v };
  }

  function comparar({ versaoA, versaoB, groupBy = 'diretoria', recalcular = false, mes = null }) {
    const A = resultadoDe(versaoA, { recalcular });
    const B = resultadoDe(versaoB, { recalcular });
    let rowsA = A.rows, rowsB = B.rows;
    if (mes) { rowsA = rowsA.filter(r => r.referencia === mes); rowsB = rowsB.filter(r => r.referencia === mes); }

    // Meses que só existem num dos lados distorceriam o Δ% — a tela precisa
    // avisar em vez de somar laranja com banana.
    const mesesA = new Set(rowsA.map(r => r.referencia));
    const mesesB = new Set(rowsB.map(r => r.referencia));
    const soEmA = [...mesesA].filter(m => !mesesB.has(m)).sort();
    const soEmB = [...mesesB].filter(m => !mesesA.has(m)).sort();

    const gA = porGrupo(rowsA, groupBy);
    const gB = porGrupo(rowsB, groupBy);
    const chaves = [...new Set([...gA.keys(), ...gB.keys()])].sort();

    const vazio = resumir([]);
    const grupos = chaves.map(chave => {
      const a = gA.get(chave) || vazio;
      const b = gB.get(chave) || vazio;
      const indicadores = INDICADORES_COMPARATIVO.map(ind => {
        const va = a[ind.key] || 0;
        const vb = b[ind.key] || 0;
        const delta = vb - va;
        const pct = va !== 0 ? delta / Math.abs(va) : (vb !== 0 ? null : 0);  // null = "novo" (base zero)
        return { key: ind.key, label: ind.label, format: ind.format, a: va, b: vb, delta, pct };
      });
      return { chave, indicadores, soA: !gB.has(chave), soB: !gA.has(chave) };
    });

    const totalA = resumir(rowsA);
    const totalB = resumir(rowsB);
    const total = INDICADORES_COMPARATIVO.map(ind => {
      const va = totalA[ind.key] || 0;
      const vb = totalB[ind.key] || 0;
      const delta = vb - va;
      return { key: ind.key, label: ind.label, format: ind.format, a: va, b: vb, delta,
               pct: va !== 0 ? delta / Math.abs(va) : (vb !== 0 ? null : 0) };
    });

    // Diff das entradas: só faz sentido entre dois cortes do log.
    let alteracoes = [];
    let diffDisponivel = false;
    const corteA = A.versao ? A.versao.ultima_alteracao_id : ultimaAlteracaoId();
    const corteB = B.versao ? B.versao.ultima_alteracao_id : ultimaAlteracaoId();
    if (corteA !== corteB) { alteracoes = diffEntradas(corteA, corteB); diffDisponivel = true; }

    return {
      groupBy, grupos, total,
      versaoA: A.versao, versaoB: B.versao,
      recalculado: !!recalcular,
      // Motores diferentes entre as versões: comparar resultados congelados
      // mistura mudança de dado com mudança de fórmula.
      engineDivergente: !!(A.versao && B.versao && A.versao.engine_versao !== B.versao.engine_versao),
      mesesSoEmA: soEmA, mesesSoEmB: soEmB,
      alteracoes, diffDisponivel,
      meses: [...new Set([...mesesA, ...mesesB])].sort(),
    };
  }

  return {
    // contexto
    getContexto, setContexto,
    // log
    registrar,
    get registrando() { return registrando; },
    set registrando(v) { registrando = v; },
    historico, solicitantesConhecidos, diffEntradas,
    // versões
    listarVersoes, getVersao, criarVersao, excluirVersao, restaurarVersao,
    anoProjecaoPadrao, ultimaAlteracaoId,
    // comparativo
    comparar, AGRUPAMENTOS, INDICADORES: INDICADORES_COMPARATIVO,
    // metadados para as telas
    formatoDe, rotuloTabela, rotuloCampo, pkDe, serializarChave,
    ENGINE_VERSAO,
  };
})();
