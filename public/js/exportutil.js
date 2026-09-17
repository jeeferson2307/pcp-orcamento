// Exportação de tabelas para CSV e XLSX — sem dependências externas (mesmo
// princípio do resto do app: tudo embutido, funciona offline). O XLSX é
// gerado como um .zip sem compressão (método STORE) contendo só as partes
// OOXML mínimas para uma planilha de uma aba só — não é uma lib completa
// como o SheetJS, só o necessário para abrir no Excel com os dados em texto.
const ExportUtil = (() => {
  function triggerDownload(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  // rows: array de arrays (linha 0 = cabeçalho), valores já formatados p/ exibição.
  function toCsv(rows) {
    const escapeCell = (v) => {
      const s = v == null ? '' : String(v);
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    // ';' como separador (padrão Excel pt-BR) + BOM UTF-8 (acentos corretos ao abrir no Excel).
    const body = rows.map(row => row.map(escapeCell).join(';')).join('\r\n');
    return new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  }

  function downloadCsv(filename, rows) {
    triggerDownload(toCsv(rows), filename);
  }

  // Inverso de toCsv: texto CSV (';' como separador, aspas para escape) -> array
  // de arrays de strings. Usado pela importação de modelos de cadastro
  // (cadastros.js). Só aceita ';' como separador (não ',') porque números
  // digitados com vírgula decimal (padrão pt-BR, ex.: "5,5") não podem virar
  // um separador de coluna.
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], cell = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else cell += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ';') {
        row.push(cell); cell = '';
      } else if (c === '\r') {
        // ignorado — a quebra de linha real é tratada em '\n'
      } else if (c === '\n') {
        row.push(cell); rows.push(row); row = []; cell = '';
      } else {
        cell += c;
      }
    }
    row.push(cell);
    rows.push(row);
    while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
    return rows;
  }

  // ---- ZIP mínimo (método STORE, sem compressão) ---------------------------
  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function buildZip(files) {
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;
    const names = Object.keys(files);

    for (const name of names) {
      const data = new TextEncoder().encode(files[name]);
      const nameBytes = new TextEncoder().encode(name);
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, 0, true);
      lh.setUint16(12, 0, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);
      localChunks.push(new Uint8Array(lh.buffer), nameBytes, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, 0, true);
      ch.setUint16(14, 0, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      centralChunks.push(new Uint8Array(ch.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    }

    const centralStart = offset;
    const centralSize = centralChunks.reduce((s, c) => s + c.length, 0);

    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, names.length, true);
    eocd.setUint16(10, names.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, centralStart, true);
    eocd.setUint16(20, 0, true);

    return new Blob([...localChunks, ...centralChunks, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
  }

  function colLetter(idx) {
    let n = idx + 1, s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // rows: array de arrays (linha 0 = cabeçalho). Todo valor é escrito como
  // texto (inlineStr) — suficiente para relatório/exportação, sem depender
  // de shared-strings ou estilos numéricos.
  function sheetXml(rows) {
    const rowsXml = rows.map((row, r) => {
      const cellsXml = row.map((val, c) => {
        if (val == null || val === '') return '';
        const ref = `${colLetter(c)}${r + 1}`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(val)}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}">${cellsXml}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  }

  function toXlsx(rows, sheetName) {
    const files = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName || 'Dados')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/worksheets/sheet1.xml': sheetXml(rows),
    };
    return buildZip(files);
  }

  function downloadXlsx(filename, rows, sheetName) {
    triggerDownload(toXlsx(rows, sheetName), filename);
  }

  return { downloadCsv, downloadXlsx, parseCsv };
})();
