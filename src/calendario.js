// Réplica exata da função M `FnCalendario` (algoritmo de Gauss/Meeus para a Páscoa
// + feriados nacionais fixos/móveis + agregação por mês).
// Todas as datas são tratadas em UTC para não sofrer deslocamento de fuso horário.

function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mesPascoa = Math.floor((h + l - 7 * m + 114) / 31);
  const diaPascoa = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mesPascoa - 1, diaPascoa);
}

function addDays(ms, days) {
  return ms + days * 86400000;
}

function feriadosNacionais(ano) {
  const p = pascoa(ano);
  return [
    Date.UTC(ano, 0, 1),      // Confraternização Universal
    addDays(p, -48),          // Carnaval segunda
    addDays(p, -47),          // Carnaval terça
    addDays(p, -2),           // Sexta-feira Santa
    Date.UTC(ano, 3, 21),     // Tiradentes
    Date.UTC(ano, 4, 1),      // Dia do Trabalho
    addDays(p, 60),           // Corpus Christi
    Date.UTC(ano, 8, 7),      // Independência
    Date.UTC(ano, 9, 12),     // N. Sra. Aparecida
    Date.UTC(ano, 10, 2),     // Finados
    Date.UTC(ano, 10, 15),    // Proclamação da República
    Date.UTC(ano, 10, 20),    // Consciência Negra
    Date.UTC(ano, 11, 25),    // Natal
  ];
}

function fmtMes(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

// Retorna Map<'YYYY-MM-01', {diaUtil,sabado,domingo,feriados,diasFaturamento}>
function fnCalendarioMensal(ano) {
  const feriados = new Set(feriadosNacionais(ano));
  const inicio = Date.UTC(ano, 0, 1);
  const fim = Date.UTC(ano, 11, 31);
  const meses = new Map();

  for (let t = inicio; t <= fim; t = addDays(t, 1)) {
    const mesKey = fmtMes(t);
    if (!meses.has(mesKey)) meses.set(mesKey, { diaUtil: 0, sabado: 0, domingo: 0, feriados: 0 });
    const dow = new Date(t).getUTCDay(); // 0=Dom .. 6=Sáb
    const diaSemana = (dow + 6) % 7; // 0=Seg .. 6=Dom (Date.DayOfWeek Monday-based)
    const bucket = meses.get(mesKey);
    if (feriados.has(t)) bucket.feriados++;
    else if (diaSemana <= 4) bucket.diaUtil++;
    else if (diaSemana === 5) bucket.sabado++;
    else bucket.domingo++;
  }

  for (const bucket of meses.values()) {
    bucket.diasFaturamento = bucket.diaUtil + bucket.feriados;
  }
  return meses;
}

module.exports = { fnCalendarioMensal };
