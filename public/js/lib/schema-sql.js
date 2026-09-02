// Mesmo conteúdo de src/schema.sql, embutido para uso no navegador (sem servidor).
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS d_filiais (
  cod_empresa   INTEGER NOT NULL,
  nom_empresa   TEXT,
  cod_filial    INTEGER NOT NULL,
  unidade       TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS cadastro_operacoes (
  cod_centro_de_custo   TEXT,
  desc_centro_de_custo  TEXT,
  cliente               TEXT,
  cod_empresa           INTEGER,
  operacao              TEXT NOT NULL,
  cod_filial            INTEGER,
  filial                TEXT NOT NULL,
  un_dre                TEXT,
  diretoria             TEXT,
  gerente               TEXT,
  responsavel_pcp       TEXT,
  responsavel_fpa       TEXT,
  PRIMARY KEY (filial, operacao)
);

CREATE TABLE IF NOT EXISTS tb_premissas_dimens (
  referencia        TEXT NOT NULL,
  tipo_dimens       TEXT NOT NULL,
  nom_operacao      TEXT NOT NULL,
  volume            REAL,
  tma               REAL,
  dmm               REAL,
  hmm               REAL,
  pausa             REAL,
  ocupacao          REAL,
  hc_dimensionado   REAL,
  hc_contratado     REAL,
  PRIMARY KEY (referencia, tipo_dimens, nom_operacao)
);

CREATE TABLE IF NOT EXISTS tb_ajuste_premissas (
  referencia        TEXT NOT NULL,
  nom_operacao      TEXT NOT NULL,
  ajuste_volume     REAL,
  ajuste_tma        REAL,
  ajuste_pausa      REAL,
  PRIMARY KEY (referencia, nom_operacao)
);

CREATE TABLE IF NOT EXISTS tb_unitarios (
  filial            TEXT NOT NULL,
  operacao          TEXT NOT NULL,
  unitario_g3       REAL,
  abandono          REAL,
  shortcalls        REAL,
  tipo_faturamento  TEXT,
  PRIMARY KEY (filial, operacao)
);

CREATE TABLE IF NOT EXISTS tb_abs (
  referencia TEXT NOT NULL, tipo_dimens TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, tipo_dimens, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_to (
  referencia TEXT NOT NULL, tipo_dimens TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, tipo_dimens, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_ferias (
  referencia TEXT NOT NULL, tipo_dimens TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, tipo_dimens, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_folga (
  referencia TEXT NOT NULL, tipo_dimens TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, tipo_dimens, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_evasoes (
  referencia TEXT NOT NULL, tipo_dimens TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, tipo_dimens, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_contratacoes_adicionais (
  referencia TEXT NOT NULL, tipo_dimens TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, tipo_dimens, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_distribuicao_volume (
  referencia TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_distribuicao_hc (
  referencia TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_cprb (
  referencia TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_reajuste (
  referencia TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_esc_feriados_nac (
  referencia TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_esc_feriados_loc (
  referencia TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_jovens (
  referencia TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_spam (
  referencia TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, nom_operacao, unidade)
);

CREATE TABLE IF NOT EXISTS tb_bodyshop (
  referencia TEXT NOT NULL, nom_operacao TEXT NOT NULL,
  unidade TEXT NOT NULL, valor REAL,
  PRIMARY KEY (referencia, nom_operacao, unidade)
);
`;
