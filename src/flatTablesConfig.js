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
  cadastro_operacoes: {
    pk: ['filial', 'operacao'],
    label: 'Cadastro de Operações',
    fields: [
      { key: 'filial', label: 'Filial', type: 'filial-select' },
      { key: 'operacao', label: 'Operação', type: 'text' },
      { key: 'cod_centro_de_custo', label: 'Código Centro de Custo', type: 'text' },
      { key: 'desc_centro_de_custo', label: 'Descrição Centro de Custo', type: 'text' },
      { key: 'cliente', label: 'Cliente', type: 'text' },
      { key: 'cod_empresa', label: 'Código Empresa', type: 'number' },
      { key: 'cod_filial', label: 'Código Filial', type: 'number' },
      { key: 'un_dre', label: 'UN DRE', type: 'text' },
      { key: 'diretoria', label: 'Diretoria', type: 'text' },
      { key: 'gerente', label: 'Gerente', type: 'text' },
      { key: 'responsavel_pcp', label: 'Responsável PCP', type: 'text' },
      { key: 'responsavel_fpa', label: 'Responsável FP&A', type: 'text' },
    ],
  },
  tb_premissas_dimens: { pk: ['referencia', 'tipo_dimens', 'nom_operacao'], label: 'Premissas de Dimensionamento' },
  tb_unitarios: { pk: ['filial', 'operacao'], label: 'Unitários de Faturamento' },
  tb_ajuste_premissas: { pk: ['referencia', 'nom_operacao'], label: 'Ajuste de Premissas' },
};

module.exports = { FLAT_TABLES };
