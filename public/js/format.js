const Fmt = {
  // valor cru armazenado -> texto de edição
  toEdit(value, format) {
    if (value == null) return '';
    if (format === 'percent') return (value * 100).toFixed(1);
    if (format === 'decimal1') return Number(value).toFixed(1);
    return value.toString();
  },
  // texto digitado -> valor cru a salvar
  fromEdit(text, format) {
    if (text == null || text.trim() === '') return null;
    const n = Number(text.replace(',', '.'));
    if (Number.isNaN(n)) return null;
    return format === 'percent' ? n / 100 : n;
  },
  // valor cru -> texto de exibição (célula não focada, tabela resultado)
  display(value, format) {
    if (value == null || Number.isNaN(value)) return '';
    if (format === 'percent') return (value * 100).toFixed(2) + '%';
    if (format === 'currency') return 'R$ ' + value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (format === 'number') return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    if (format === 'decimal1') return Number(value).toFixed(1);
    return String(value);
  },
  mes(refStr) {
    if (!refStr) return '';
    const [y, m] = refStr.split('-');
    const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    return `${meses[parseInt(m,10)-1]}/${y.slice(2)}`;
  },
};
