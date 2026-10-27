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
  tipo_escala           TEXT,
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
  ocupacao_garantia REAL,
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

-- Parâmetros globais de configuração (chave/valor), ex.: peso do feriado
-- nacional usado no cálculo de Faturamento 6x1 do Calendário.
CREATE TABLE IF NOT EXISTS tb_parametros (
  chave TEXT PRIMARY KEY,
  valor REAL
);

-- Anotações livres do usuário (botão flutuante, disponível em qualquer tela).
CREATE TABLE IF NOT EXISTS tb_anotacoes (
  chave TEXT PRIMARY KEY,
  texto TEXT,
  atualizado_em TEXT
);

-- ============================================================
-- Versionamento: log de alteracoes + marcos de versao.
-- A unidade versionada e a CELULA, nao o banco: uma versao e so um corte no
-- log (tb_versoes.ultima_alteracao_id). Ver public/js/versionamento.js.
-- ============================================================

-- Configuracao textual do app (autor/solicitante/motivo correntes).
-- tb_parametros so guarda REAL, por isso esta tabela separada.
CREATE TABLE IF NOT EXISTS tb_config (
  chave TEXT PRIMARY KEY,
  texto TEXT
);

-- Log append-only: uma linha por valor alterado. Nunca se edita nem se apaga
-- (restaurar uma versao gera novas linhas de reversao, nao remove historico).
CREATE TABLE IF NOT EXISTS tb_alteracoes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  momento       TEXT NOT NULL,              -- ISO 8601
  autor         TEXT,                       -- quem mexeu
  solicitante   TEXT,                       -- quem pediu
  motivo        TEXT,                       -- por que
  acao          TEXT NOT NULL DEFAULT 'alterou',  -- alterou | criou | excluiu
  tabela        TEXT NOT NULL,
  chave         TEXT NOT NULL,              -- JSON com a PK completa da linha
  referencia    TEXT,                       -- dimensoes legiveis, extraidas da
  nom_operacao  TEXT,                       -- chave, para filtrar o historico
  unidade       TEXT,                       -- sem desserializar JSON
  campo         TEXT NOT NULL,
  valor_antes   REAL, texto_antes  TEXT,    -- campo numerico OU textual
  valor_depois  REAL, texto_depois TEXT,
  versao_id     INTEGER                     -- NULL = ainda no rascunho
);
CREATE INDEX IF NOT EXISTS ix_alteracoes_versao  ON tb_alteracoes(versao_id);
CREATE INDEX IF NOT EXISTS ix_alteracoes_celula  ON tb_alteracoes(tabela, chave, campo, id);
CREATE INDEX IF NOT EXISTS ix_alteracoes_momento ON tb_alteracoes(momento);
CREATE INDEX IF NOT EXISTS ix_alteracoes_oper    ON tb_alteracoes(nom_operacao);

-- Marco: "a versao 4 e tudo que existia ate a alteracao 1572".
CREATE TABLE IF NOT EXISTS tb_versoes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nome                TEXT NOT NULL,
  descricao           TEXT,
  criado_em           TEXT NOT NULL,
  criado_por          TEXT,
  ultima_alteracao_id INTEGER NOT NULL DEFAULT 0,
  ano_projecao        INTEGER,
  engine_versao       TEXT                  -- versao do motor de calculo
);

-- Indicadores congelados no momento do corte (grao do Analitico:
-- mes x operacao x filial). E a verdade de auditoria do que foi publicado.
CREATE TABLE IF NOT EXISTS tb_versao_resultado (
  versao_id   INTEGER NOT NULL,
  referencia  TEXT, operacao TEXT, site TEXT,
  un_dre      TEXT, diretoria TEXT, cliente TEXT, gerente TEXT,
  cod_cc      TEXT, desc_centro_custo TEXT,
  receita_bruta REAL, fte_financeiro REAL, hc_dim REAL, hc_treinamento REAL,
  volume_revisado REAL, tma REAL, unitario_reajustado REAL, numerador_faturamento REAL,
  absenteismo REAL, turnover REAL, ferias REAL, folga_extra REAL,
  PRIMARY KEY (versao_id, referencia, operacao, site)
);
`;
