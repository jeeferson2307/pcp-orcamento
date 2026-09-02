// Metadata describing every "wide" input table (REFERENCIA x OPERACAO [x TIPO_DIMENS] x FILIAL).
// Used to drive both the generic CRUD API and the generic spreadsheet-like grid on the frontend.
// format: 'percent' | 'number' | 'currency'
const WIDE_TABLES = {
  tb_abs: { label: 'Absenteísmo (TB_ABS)', hasTipoDimens: true, valueLabel: 'ABS', format: 'percent' },
  tb_to: { label: 'Turnover (TB_TO)', hasTipoDimens: true, valueLabel: 'TO', format: 'percent' },
  tb_ferias: { label: 'Férias (TB_FERIAS)', hasTipoDimens: true, valueLabel: 'FÉRIAS', format: 'percent' },
  tb_folga: { label: 'Folga Extra (TB_FOLGA)', hasTipoDimens: true, valueLabel: 'FOLGA', format: 'percent' },
  tb_evasoes: { label: 'Evasão (TB_EVASOES)', hasTipoDimens: true, valueLabel: 'EVASÃO', format: 'percent' },
  tb_contratacoes_adicionais: { label: 'Contratações Adicionais', hasTipoDimens: true, valueLabel: 'QTD', format: 'number' },
  tb_distribuicao_volume: { label: 'Distribuição de Volume', hasTipoDimens: false, valueLabel: '% VOLUME', format: 'percent' },
  tb_distribuicao_hc: { label: 'Distribuição de HC', hasTipoDimens: false, valueLabel: '% HC', format: 'percent' },
  tb_cprb: { label: 'CPRB', hasTipoDimens: false, valueLabel: 'CPRB %', format: 'percent' },
  tb_reajuste: { label: 'Reajuste Contratual', hasTipoDimens: false, valueLabel: 'REAJUSTE %', format: 'percent' },
  tb_esc_feriados_nac: { label: 'Escala Feriados Nacionais', hasTipoDimens: false, valueLabel: '% ESCALA', format: 'percent' },
  tb_esc_feriados_loc: { label: 'Escala Feriados Locais', hasTipoDimens: false, valueLabel: '% ESCALA', format: 'percent' },
  tb_jovens: { label: 'Jovem Aprendiz', hasTipoDimens: false, valueLabel: 'QTD JOVENS', format: 'number' },
  tb_spam: { label: 'SPAM Supervisão', hasTipoDimens: false, valueLabel: 'SPAM', format: 'number' },
  tb_bodyshop: { label: 'Receita Bodyshop', hasTipoDimens: false, valueLabel: 'RECEITA', format: 'currency' },
};

module.exports = { WIDE_TABLES };
