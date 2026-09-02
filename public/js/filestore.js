// Abrir/criar/salvar o banco .sqlite como um ARQUIVO REAL no disco (File System
// Access API — Chrome/Edge). Sem esse suporte, cai num modo alternativo:
// autosave no IndexedDB do navegador + botão de download manual (como no Excel).
const FileStore = (() => {
  let fileHandle = null;
  let saveTimer = null;
  const SUPPORTS_FS_ACCESS = typeof window.showOpenFilePicker === 'function';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('pcp-dimensionamento', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function sanitizeName(nome) {
    // remove os acentos que o normalize('NFD') separou em marcas combinantes
    // (faixa Unicode U+0300–U+036F), sem depender de caracteres literais no código-fonte.
    const COMBINING_MARKS = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
    return (nome || '')
      .normalize('NFD').replace(COMBINING_MARKS, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function todayYYYYMMDD() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  function setStatus(msg, isError, iconName) {
    const el = document.getElementById('save-status');
    if (!el) return;
    const icon = Icon(iconName || (isError ? 'circle-alert' : 'check'));
    el.innerHTML = icon + '<span>' + msg.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</span>';
    el.classList.toggle('error', !!isError);
  }

  async function writeToHandle(handle, bytes) {
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }

  async function doAutosave() {
    const bytes = Engine.exportBytes();
    try {
      if (fileHandle) {
        await writeToHandle(fileHandle, bytes);
        setStatus('Salvo em ' + fileHandle.name, false);
      } else {
        await idbSet('autosave-bytes', bytes);
        setStatus('Salvo automaticamente neste navegador', false);
      }
    } catch (e) {
      setStatus('Erro ao salvar: ' + e.message, true);
    }
  }

  function scheduleAutosave() {
    setStatus('Salvando…', false, 'loader-circle');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doAutosave, 500);
  }

  window.onDbChanged = scheduleAutosave;

  return {
    supportsFsAccess: SUPPORTS_FS_ACCESS,

    async openPicker() {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Banco de dados SQLite', accept: { 'application/octet-stream': ['.sqlite', '.db'] } }],
      });
      if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
        throw new Error('Permissão de leitura/escrita negada para o arquivo.');
      }
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      await Engine.openFromBytes(bytes);
      fileHandle = handle;
      await idbSet('last-handle', handle);
      return file.name;
    },

    async createNewPicker() {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'dimensionamento.sqlite',
        types: [{ description: 'Banco de dados SQLite', accept: { 'application/octet-stream': ['.sqlite'] } }],
      });
      await Engine.createEmpty();
      fileHandle = handle;
      await doAutosave();
      await idbSet('last-handle', handle);
      return handle.name;
    },

    async tryReopenLast() {
      let handle;
      try { handle = await idbGet('last-handle'); } catch { return null; }
      if (!handle) return null;
      try {
        let perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') return null;
        const file = await handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        await Engine.openFromBytes(bytes);
        fileHandle = handle;
        return file.name;
      } catch {
        return null;
      }
    },

    async openFromInputFile(fileObj) {
      const bytes = new Uint8Array(await fileObj.arrayBuffer());
      await Engine.openFromBytes(bytes);
      fileHandle = null;
    },

    async createEmptyFallback() {
      await Engine.createEmpty();
      fileHandle = null;
    },

    async tryResumeAutosave() {
      let bytes;
      try { bytes = await idbGet('autosave-bytes'); } catch { return false; }
      if (!bytes) return false;
      await Engine.openFromBytes(bytes);
      return true;
    },

    hasFileHandle() { return !!fileHandle; },
    currentFileName() { return fileHandle ? fileHandle.name : null; },

    forget() {
      fileHandle = null;
    },

    // "Publicar Orçamento": salva uma cópia nomeada (não altera o arquivo de
    // trabalho atual nem o autosave) — nome + data no formato YYYYMMDD.
    async publish(nomeBase) {
      const safe = sanitizeName(nomeBase) || 'orcamento';
      const filename = `${safe}_${todayYYYYMMDD()}.sqlite`;
      const bytes = Engine.exportBytes();
      if (SUPPORTS_FS_ACCESS) {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Banco de dados SQLite', accept: { 'application/octet-stream': ['.sqlite'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        return handle.name;
      }
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      return filename;
    },

    downloadBackup(filename) {
      const bytes = Engine.exportBytes();
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'dimensionamento.sqlite';
      a.click();
    },
  };
})();
