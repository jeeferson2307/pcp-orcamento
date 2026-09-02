// Motor de cálculo — réplica fiel do pipeline Power Query original:
//   TB_PREMISSAS_DIMENS -> TB_PROJECAO_FORECAST -> TB_PROJECAO_FORECAST_COMPLETO -> TB_PROJECAO_FORECAST_FINAL
// (Versão para navegador — idêntica a src/calc.js, usando window.DB em vez de require('./db'))

const TEMPO_LOGADO = 'TEMPO LOGADO';
const POSICAO = 'POSIÇÃO';
const MINUTAGEM_T = 'MINUTAGEM';
const EVENTO = 'EVENTO';

function roundUp(n, digits = 0) {
  const f = Math.pow(10, digits);
  return Math.ceil((n - Number.EPSILON) * f) / f;
}

function keyDist(referencia, nomOperacao, unidade) {
  return `${referencia}__${nomOperacao}__${unidade}`;
}

function mapByKey(rows, keyFn) {
  const m = new Map();
  for (const r of rows) m.set(keyFn(r), r);
  return m;
}

// Distribuição de Volume/HC é cadastrada mês a mês por (operação, filial) e
// facilmente fica sem registro nos meses novos/projetados (ex.: usuário
// estende Dimensionamento até um mês futuro mas esquece de replicar a
// Distribuição). Sem isso, o % de rateio some (null) e zera Volume/HC
// Revisado do ano inteiro. Resolve com o mesmo princípio já usado em
// buildForecast para Volume/TMA/Pausa: quando não há % para o mês exato,
// usa o último % conhecido (mais recente) daquela operação+filial.
function buildCarryForwardLookup(rows) {
  const byOpUnit = new Map();
  for (const r of rows) {
    const k = `${r.nom_operacao}__${r.unidade}`;
    if (!byOpUnit.has(k)) byOpUnit.set(k, []);
    byOpUnit.get(k).push(r);
  }
  for (const list of byOpUnit.values()) list.sort((a, b) => (a.referencia < b.referencia ? -1 : 1));
  return (referencia, nomOperacao, unidade) => {
    const list = byOpUnit.get(`${nomOperacao}__${unidade}`);
    if (!list || list.length === 0) return null;
    let ultimoConhecido = null;
    for (const r of list) {
      if (r.referencia > referencia) break;
      ultimoConhecido = r;
    }
    return ultimoConhecido ? ultimoConhecido.valor : null;
  };
}

// ---------------------------------------------------------------
// TB_PROJECAO_FORECAST
// ---------------------------------------------------------------
function buildForecast(ano) {
  const base = DB.prepare('SELECT * FROM tb_premissas_dimens').all();
  const cal = fnCalendarioMensal(ano);
  const diasDe = (mes) => (cal.has(mes) ? cal.get(mes).diasFaturamento : null);

  const preenchidas = base.filter(r => r.referencia != null &&
    (((r.volume ?? 0) !== 0) || ((r.hc_contratado ?? 0) !== 0)));
  if (preenchidas.length === 0) return [];

  const mesBase = preenchidas.reduce((max, r) => (r.referencia > max ? r.referencia : max), preenchidas[0].referencia);
  const historico = preenchidas.filter(r => r.referencia <= mesBase);

  const real = historico.map(r => {
    const diasFaturamento = diasDe(r.referencia);
    // Minutagem = produtividade líquida: minutos de volume atendidos por HC
    // efetivamente produtivo (desconta a Pausa cadastrada em Dimensionamento).
    const hcEfetivo = r.hc_dimensionado ? r.hc_dimensionado * (1 - (r.pausa ?? 0)) : 0;
    const minutagem = (!hcEfetivo) ? null : (r.volume * r.tma) / 60 / hcEfetivo;
    return { ...r, dias_faturamento: diasFaturamento, minutagem, tipo_linha: 'REAL' };
  });

  const anoBase = Number(mesBase.slice(0, 4));
  const fimAno = `${anoBase}-12-01`;
  const mesesProj = [...cal.keys()].filter(m => m > mesBase && m <= fimAno).sort();

  const grupos = new Map();
  for (const r of real) {
    const gk = `${r.tipo_dimens}__${r.nom_operacao}`;
    if (!grupos.has(gk)) grupos.set(gk, []);
    grupos.get(gk).push(r);
  }

  // Cadastro Ajuste Premissas: % de incremento/redução aplicado sobre
  // Volume, TMA e Pausa em cada mês projetado, para quebrar a herança
  // estática do mês-base (sem isso, Pausa/TMA cancelam-se algebricamente
  // na fórmula inversa de Minutagem e a projeção fica congelada).
  const ajustes = mapByKey(DB.prepare('SELECT * FROM tb_ajuste_premissas').all(), r => `${r.referencia}__${r.nom_operacao}`);

  const projetado = [];
  for (const dados of grupos.values()) {
    const ord = [...dados].sort((a, b) => (a.referencia < b.referencia ? -1 : 1));
    const noMesBase = ord.filter(r => r.referencia === mesBase);
    const ultima = noMesBase.length > 0 ? noMesBase[noMesBase.length - 1] : ord[ord.length - 1];

    const volBase = ultima.volume;
    const diasBase = ultima.dias_faturamento;
    const minutBase = ultima.minutagem;
    const pausaBase = ultima.pausa ?? 0;
    const hcContratadoBase = ultima.hc_contratado ?? null;
    const temContratado = hcContratadoBase != null && hcContratadoBase !== 0;

    for (const mes of mesesProj) {
      const dias = diasDe(mes);
      const ajuste = ajustes.get(`${mes}__${ultima.nom_operacao}`);
      const volPrjBase = (!diasBase) ? 0 : (volBase / diasBase) * dias;
      const volPrj = volPrjBase * (1 + (ajuste?.ajuste_volume ?? 0));
      const tmaPrj = ultima.tma * (1 + (ajuste?.ajuste_tma ?? 0));
      const pausaPrj = pausaBase * (1 + (ajuste?.ajuste_pausa ?? 0));
      // Inverso da fórmula de Minutagem: mantém a mesma produtividade líquida
      // (já descontada a Pausa, já com os ajustes de Volume/TMA/Pausa do mês)
      // observada no mês-base ao projetar o HC.
      const hcPrj = temContratado
        ? hcContratadoBase
        : ((!minutBase) ? null : (volPrj * tmaPrj) / 60 / (minutBase * (1 - pausaPrj)));
      const minutagemPrj = (hcPrj && (1 - pausaPrj) !== 0) ? (volPrj * tmaPrj) / 60 / (hcPrj * (1 - pausaPrj)) : minutBase;
      projetado.push({
        ...ultima,
        referencia: mes,
        dias_faturamento: dias,
        volume: volPrj,
        tma: tmaPrj,
        pausa: pausaPrj,
        minutagem: minutagemPrj,
        hc_dimensionado: hcPrj,
        hc_contratado: hcContratadoBase,
        tipo_linha: 'PROJETADO',
      });
    }
  }

  const unido = [...real, ...projetado];
  unido.sort((a, b) => (a.nom_operacao + a.tipo_dimens + a.referencia).localeCompare(b.nom_operacao + b.tipo_dimens + b.referencia));
  return unido;
}

// ---------------------------------------------------------------
// TB_PROJECAO_FORECAST_COMPLETO
// ---------------------------------------------------------------
function buildComplete(ano) {
  const forecast = buildForecast(ano);
  const filiais = DB.prepare('SELECT * FROM d_filiais').all();

  const distHcLookup = buildCarryForwardLookup(DB.prepare('SELECT * FROM tb_distribuicao_hc').all());
  const distVolLookup = buildCarryForwardLookup(DB.prepare('SELECT * FROM tb_distribuicao_volume').all());
  const tbAbs = mapByKey(DB.prepare('SELECT * FROM tb_abs').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbTo = mapByKey(DB.prepare('SELECT * FROM tb_to').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbFerias = mapByKey(DB.prepare('SELECT * FROM tb_ferias').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbFolga = mapByKey(DB.prepare('SELECT * FROM tb_folga').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbContrat = mapByKey(DB.prepare('SELECT * FROM tb_contratacoes_adicionais').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbEvasoes = mapByKey(DB.prepare('SELECT * FROM tb_evasoes').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbCprb = mapByKey(DB.prepare('SELECT * FROM tb_cprb').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbReajuste = mapByKey(DB.prepare('SELECT * FROM tb_reajuste').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbFerNac = mapByKey(DB.prepare('SELECT * FROM tb_esc_feriados_nac').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbFerLoc = mapByKey(DB.prepare('SELECT * FROM tb_esc_feriados_loc').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbJovens = mapByKey(DB.prepare('SELECT * FROM tb_jovens').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbSpam = mapByKey(DB.prepare('SELECT * FROM tb_spam').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbBodyshop = mapByKey(DB.prepare('SELECT * FROM tb_bodyshop').all(), r => keyDist(r.referencia, r.nom_operacao, r.unidade));
  const tbUnitarios = mapByKey(DB.prepare('SELECT * FROM tb_unitarios').all(), r => `${r.filial}${r.operacao}`);
  const cadastroOperacoes = mapByKey(DB.prepare('SELECT * FROM cadastro_operacoes').all(), r => `${r.filial}${r.operacao}`);

  const out = [];
  for (const f of forecast) {
    for (const fil of filiais) {
      const unidade = fil.unidade;
      const kDist = keyDist(f.referencia, f.nom_operacao, unidade);

      const pcrtHc = distHcLookup(f.referencia, f.nom_operacao, unidade);
      const pcrtVolume = distVolLookup(f.referencia, f.nom_operacao, unidade);

      const keyUnit = `${unidade}${f.nom_operacao}`;
      const unit = tbUnitarios.get(keyUnit) || {};
      const tipoFat = unit.tipo_faturamento;
      const isHcBased = tipoFat === TEMPO_LOGADO || tipoFat === POSICAO;

      const volumeRevisado = Math.round(f.volume * pcrtVolume);
      // Faturamento por Tempo Logado/Posição (PA fixa): o HC Contratado é um
      // número fechado por operação, não uma grandeza a ratear por % de
      // Distribuição — projeta o valor cadastrado em Dimensionamento direto,
      // sem depender de haver uma linha em Distribuição de HC para o mês.
      const hcRevisado = (isHcBased && f.hc_contratado > 0)
        ? Math.round(f.hc_contratado)
        : Math.round((f.hc_contratado > 0 ? f.hc_contratado : f.hc_dimensionado) * pcrtHc);

      const abs = tbAbs.get(kDist)?.valor ?? 0;
      const to_ = tbTo.get(kDist)?.valor ?? 0;
      const ferias = tbFerias.get(kDist)?.valor ?? 0;
      const folga = tbFolga.get(kDist)?.valor ?? 0;

      const reposicoes = Math.round(roundUp(f.hc_dimensionado * to_ * pcrtHc, 0)) || 0;
      const contratacoesAdicionais = tbContrat.get(kDist)?.valor ?? 0;
      const evasao = tbEvasoes.get(kDist)?.valor ?? 0;
      const totalContratacoes = Math.round(roundUp((reposicoes + contratacoesAdicionais) / (1 - evasao), 0)) || 0;

      const cprb = tbCprb.get(kDist) || {};
      const reajuste = tbReajuste.get(kDist) || {};
      const unitarioReajustado = (unit.unitario_g3 ?? 0) * (1 + (cprb.valor ?? 0)) * (1 + (reajuste.valor ?? 0));

      const hcBruto = isHcBased ? hcRevisado : hcRevisado / (1 - (abs + to_ + ferias + folga));
      const hcCusto = hcBruto + totalContratacoes;

      let numeradorFaturamento = 0;
      if (tipoFat === TEMPO_LOGADO || tipoFat === POSICAO) numeradorFaturamento = hcRevisado / f.ocupacao;
      else if (tipoFat === MINUTAGEM_T) numeradorFaturamento = volumeRevisado * (1 - ((unit.abandono ?? 0) + (unit.shortcalls ?? 0))) * f.tma / 60;
      else if (tipoFat === EVENTO) numeradorFaturamento = volumeRevisado * (1 - ((unit.abandono ?? 0) + (unit.shortcalls ?? 0)));

      const cadOp = cadastroOperacoes.get(keyUnit) || {};

      const chaveCc = `${fil.cod_empresa}${fil.cod_filial}${cadOp.cod_centro_de_custo ?? ''}`;
      const totalTfl = abs + to_ + ferias + folga;
      const pesoFeriadoNac = tbFerNac.get(kDist)?.valor ?? null;
      const pesoFeriadoLoc = tbFerLoc.get(kDist)?.valor ?? null;
      const ocupacaoGarantia = tipoFat === TEMPO_LOGADO ? 0.85 : 0;
      const qtdJovens = tbJovens.get(kDist)?.valor ?? 0;
      const hcDimJovem = hcBruto + qtdJovens;
      const spam = tbSpam.get(kDist)?.valor ?? null;
      const qtdSupervisores = spam ? hcRevisado / spam : null;
      const paHcInfra = isHcBased ? hcRevisado / f.ocupacao : (hcRevisado / f.ocupacao) * 1.06;
      const txOcupPaInfra = hcRevisado === 0 ? 1 : hcRevisado / paHcInfra;
      const receitaBodyshop = tbBodyshop.get(kDist)?.valor ?? 0;
      const receita = numeradorFaturamento * unitarioReajustado + receitaBodyshop;

      out.push({
        referencia: f.referencia,
        tipologia: 'ORÇADO',
        cod_empresa: fil.cod_empresa,
        cod_filial: fil.cod_filial,
        chave_cc: chaveCc,
        cod_cc: cadOp.cod_centro_de_custo ?? null,
        desc_centro_custo: cadOp.desc_centro_de_custo ?? null,
        eos: '',
        faturamento: tipoFat ?? null,
        posicao_contratada: f.hc_contratado,
        ocupacao_garantia: ocupacaoGarantia,
        cliente: cadOp.cliente ?? null,
        un_dre: cadOp.un_dre ?? null,
        operacao: f.nom_operacao,
        site: unidade,
        diretoria: cadOp.diretoria ?? null,
        gerente: cadOp.gerente ?? null,
        responsavel_pcp: cadOp.responsavel_pcp ?? null,
        responsavel_fpa: cadOp.responsavel_fpa ?? null,
        canal: '',
        pct_escala_fer_nac: pesoFeriadoNac,
        pct_escala_local: pesoFeriadoLoc,
        total_tfl: totalTfl,
        absenteismo: abs,
        turnover: to_,
        ferias,
        inativos: 0,
        folga_extra: folga,
        fte_financeiro: hcCusto,
        hc_dim: hcBruto,
        hc_custo_jovem: qtdJovens,
        hc_dim_jovem: hcDimJovem,
        spam_supervisao: spam,
        supervisor: qtdSupervisores,
        hc_treinamento: totalContratacoes,
        evasao,
        pa_hc_infra: paHcInfra,
        taxa_ocup_pa_infra: txOcupPaInfra,
        receita_bruta: receita,
        cprb_aplicado: (cprb.valor ?? 0) > 0 ? 'SIM' : 'NÃO',
        cprb_pct: cprb.valor ?? 0,
        reajuste_aplicado: (reajuste.valor ?? 0) > 0 ? 'SIM' : 'NÃO',
        reajuste_pct: reajuste.valor ?? 0,
        _tipo_dimens: f.tipo_dimens,
        _tipo_linha: f.tipo_linha,
        _volume_revisado: volumeRevisado,
        _hc_revisado: hcRevisado,
        _tma: f.tma,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------
// TB_PROJECAO_FORECAST_FINAL
// ---------------------------------------------------------------
function buildFinal(ano, { responsavelPcp = null, apenasComCusto = true } = {}) {
  let rows = buildComplete(ano);
  if (apenasComCusto) rows = rows.filter(r => (r.fte_financeiro ?? 0) !== 0);
  if (responsavelPcp) rows = rows.filter(r => r.responsavel_pcp === responsavelPcp);
  return rows;
}
