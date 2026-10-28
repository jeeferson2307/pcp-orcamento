// Tabelas "chatas" (não precisam de pivot) com CRUD genérico via chave primária.
const FLAT_TABLES = {
  d_filiais: {
    pk: ['unidade'],
    label: 'Filiais / Unidades',
    fields: [
      { key: 'unidade', label: 'Unidade (Site)', type: 'text' },
      { key: 'cod_empresa', label: 'Código Empresa', type: 'number' },
      { key: 'nom_empresa', label: 'Nome da Empresa', type: 'text' },
      { key: 'cod_filial', label: 'Código Filial', type: 'number' },
    ],
  },
  d_centro_custo: {
    pk: ['cod_centro_de_custo'],
    label: 'Cadastro de Centro de Custo',
    fields: [
      { key: 'cod_empresa', label: 'Código Empresa', type: 'number' },
      { key: 'cod_filial', label: 'Código Filial', type: 'number' },
      { key: 'cod_centro_de_custo', label: 'Código Centro de Custo', type: 'codigo' },
      { key: 'desc_centro_de_custo', label: 'Descrição Centro de Custo', type: 'text' },
      { key: 'cliente', label: 'Cliente', type: 'text' },
      { key: 'un_dre', label: 'UN DRE', type: 'text' },
      { key: 'diretoria', label: 'Diretoria', type: 'text' },
      { key: 'gerente', label: 'Gerente', type: 'text' },
      { key: 'responsavel_pcp', label: 'Responsável PCP', type: 'text' },
      { key: 'responsavel_fpa', label: 'Responsável FP&A', type: 'text' },
    ],
  },
  cadastro_operacoes: {
    pk: ['filial', 'operacao'],
    label: 'Cadastro de Operações',
    // Os campos marcados com `readOnly` não pertencem à operação: vêm do
    // centro de custo escolhido (ver d_centro_custo). São mostrados na grade
    // e no formulário apenas para conferência, e nunca entram na gravação.
    fields: [
      { key: 'filial', label: 'Filial', type: 'filial-select' },
      { key: 'operacao', label: 'Operação', type: 'text' },
      { key: 'cod_centro_de_custo', label: 'Centro de Custo', type: 'cc-select' },
      { key: 'tipo_escala', label: 'Tipo Escala', type: 'select', options: ['6x1', '5x2'] },
      { key: 'desc_centro_de_custo', label: 'Descrição Centro de Custo', readOnly: true },
      { key: 'cliente', label: 'Cliente', readOnly: true },
      { key: 'cod_empresa', label: 'Código Empresa', readOnly: true },
      { key: 'cod_filial', label: 'Código Filial', readOnly: true },
      { key: 'un_dre', label: 'UN DRE', readOnly: true },
      { key: 'diretoria', label: 'Diretoria', readOnly: true },
      { key: 'gerente', label: 'Gerente', readOnly: true },
      { key: 'responsavel_pcp', label: 'Responsável PCP', readOnly: true },
      { key: 'responsavel_fpa', label: 'Responsável FP&A', readOnly: true },
    ],
  },
  tb_premissas_dimens: { pk: ['referencia', 'tipo_dimens', 'nom_operacao'], label: 'Premissas de Dimensionamento' },
  tb_unitarios: { pk: ['filial', 'operacao'], label: 'Unitários de Faturamento' },
  tb_ajuste_premissas: { pk: ['referencia', 'nom_operacao'], label: 'Ajuste de Premissas' },
};

module.exports = { FLAT_TABLES };
