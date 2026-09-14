const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'dimensionamento.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

// Bancos .sqlite antigos (criados antes de uma coluna nova ser adicionada ao
// schema) não ganham a coluna automaticamente via CREATE TABLE IF NOT EXISTS
// — este passo de migração roda sempre, adicionando só o que faltar (mesma
// lógica usada no lado navegador, ver public/js/dbengine.js).
const colunasOp = db.prepare(`PRAGMA table_info(cadastro_operacoes)`).all().map(c => c.name);
if (!colunasOp.includes('tipo_escala')) {
  db.exec(`ALTER TABLE cadastro_operacoes ADD COLUMN tipo_escala TEXT`);
}
const colunasDimens = db.prepare(`PRAGMA table_info(tb_premissas_dimens)`).all().map(c => c.name);
if (!colunasDimens.includes('ocupacao_garantia')) {
  db.exec(`ALTER TABLE tb_premissas_dimens ADD COLUMN ocupacao_garantia REAL`);
}

module.exports = db;
