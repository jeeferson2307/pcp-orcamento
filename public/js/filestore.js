// Abrir/criar/salvar o banco .sqlite como um ARQUIVO REAL no disco (File System
// Access API — Chrome/Edge). Sem esse suporte, cai num modo alternativo:
// autosave no IndexedDB do navegador + botão de download manual (como no Excel).
const FileStore = (() => {
  let fileHandle = null;
  let dirHandle = null;
  let filePath = null;
  let saveTimer = null;
  const SUPPORTS_FS_ACCESS = typeof window.showOpenFilePicker === 'function';
  const SUPPORTS_DIR_PICKER = typeof window.showDirectoryPicker === 'function';

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

  // Pasta padrão dos seletores de Abrir/Criar: usa o próprio arquivo em uso
  // nesta sessão (se houver) ou o último arquivo aberto/criado (guardado no
  // IndexedDB por openPicker/createNewPicker) como referência de pasta —
  // assim o seletor abre direto na pasta onde o usuário já está trabalhando,
  // em vez de cair na pasta padrão genérica do navegador (Downloads/Documentos).
  async function directoryHint() {
    if (fileHandle) return fileHandle;
    try { return (await idbGet('last-handle')) || undefined; }
    catch { return undefined; }
  }

  // Chama um seletor (showOpenFilePicker/showSaveFilePicker) com startIn
  // apontando para a pasta de referência, se houver uma. Se o handle guardado
  // não for mais válido (arquivo movido/apagado), tenta de novo sem o hint
  // em vez de travar a abertura do seletor.
  async function pickComHint(pickerFn, opts) {
    const hint = await directoryHint();
    if (!hint) return pickerFn(opts);
    try {
      return await pickerFn({ ...opts, startIn: hint });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return pickerFn(opts);
    }
  }

  // O navegador nunca revela o caminho absoluto de um arquivo no disco (é uma
  // restrição de segurança de todos os navegadores, não uma limitação nossa)
  // — só dá pra saber o nome do arquivo. O mais próximo que dá pra chegar é
  // pedir também a pasta (o usuário precisa confirmar numa segunda janela,
  // que já abre direto na pasta certa) e calcular o caminho RELATIVO a ela
  // com FileSystemDirectoryHandle.resolve(). Se o usuário cancelar essa
  // segunda janela, seguimos normalmente só com o nome do arquivo.
  async function relativePathFor(fh, { allowPrompt = true } = {}) {
    // Primeiro tenta em silêncio, sem popup: se já temos uma pasta com
    // permissão ainda válida (desta sessão ou salva de uma anterior) e o
    // arquivo está dentro dela, não precisa perguntar de novo.
    if (dirHandle) {
      try {
        if ((await dirHandle.queryPermission({ mode: 'read' })) === 'granted') {
          const parts = await dirHandle.resolve(fh);
          if (parts) return [dirHandle.name, ...parts].join('/');
        }
      } catch { /* pasta guardada não é mais válida — cai para perguntar de novo abaixo */ }
    }
    // showDirectoryPicker exige um gesto do usuário — não pode ser chamado
    // numa reabertura automática (tryReopenLast), só em ações explícitas
    // (Abrir/Criar), senão o navegador rejeita ou mostra um popup indesejado.
    if (!allowPrompt || !SUPPORTS_DIR_PICKER) return null;
    try {
      const dir = await window.showDirectoryPicker({ id: 'pcp-db-folder', mode: 'read', startIn: fh });
      const parts = await dir.resolve(fh);
      if (!parts) return null; // pasta escolhida não contém esse arquivo
      dirHandle = dir;
      await idbSet('last-dir-handle', dir);
      return [dir.name, ...parts].join('/');
    } catch {
      return null; // usuário cancelou a janela da pasta — segue só com o nome do arquivo
    }
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
    if (fileHandle) {
      try {
        await writeToHandle(fileHandle, bytes);
        setStatus('Salvo em ' + fileHandle.name, false);
        return;
      } catch (e) {
        // Salvar direto no arquivo pode falhar por motivos passageiros (rede
        // instável, arquivo do OneDrive ainda "só na nuvem"/sincronizando,
        // arquivo aberto por outro programa etc.) — não pode arriscar perder
        // a edição do usuário por causa disso. Cai para o backup neste
        // navegador (rede de segurança) e avisa; a próxima edição tenta
        // salvar no arquivo de novo automaticamente.
        console.warn('Falha ao salvar direto no arquivo — guardando neste navegador como rede de segurança:', e);
        try {
          await idbSet('autosave-bytes', bytes);
          setStatus('Não foi possível salvar em ' + fileHandle.name + ' agora (' + e.message + ') — guardado neste navegador. Use "⬇ Backup" para não perder a edição.', true);
        } catch (e2) {
          setStatus('Erro ao salvar: ' + e.message, true);
        }
        return;
      }
    }
    try {
      await idbSet('autosave-bytes', bytes);
      setStatus('Salvo automaticamente neste navegador', false);
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
      // "id" faz o navegador lembrar sozinho a última pasta usada para esse
      // fluxo específico e já abrir o seletor nela da próxima vez; "startIn"
      // (via pickComHint) reforça isso apontando pro último arquivo usado —
      // cobre inclusive a primeira vez que o navegador ainda não tem nada
      // lembrado para esse "id".
      const [handle] = await pickComHint((o) => window.showOpenFilePicker(o), {
        id: 'pcp-db',
        types: [{ description: 'Banco de dados SQLite', accept: { 'application/octet-stream': ['.sqlite', '.db'] } }],
      });
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      await Engine.openFromBytes(bytes);

      // Em alguns navegadores/contextos (política corporativa, página aberta
      // dentro de um visualizador embutido como Teams/Outlook/SharePoint, um
      // navegador diferente de Chrome/Edge, etc.) o pedido de permissão de
      // escrita é recusado pelo próprio navegador — "Not allowed to request
      // permissions in this context" — mesmo o seletor de arquivo tendo
      // funcionado normalmente. Nesse caso não travamos a abertura: caímos no
      // mesmo modo alternativo usado por navegadores sem suporte à File
      // System Access API (autosave neste navegador + backup manual).
      let podeEscrever = false;
      try {
        podeEscrever = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
        if (!podeEscrever) podeEscrever = (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
      } catch (e) {
        console.warn('Não foi possível obter permissão de escrita no arquivo — seguindo em modo leitura:', e);
      }

      if (podeEscrever) {
        fileHandle = handle;
        await idbSet('last-handle', handle);
        filePath = await relativePathFor(handle);
      } else {
        fileHandle = null;
        toast('Este navegador não permitiu salvar direto em "' + file.name + '". As alterações serão salvas neste navegador — use "⬇ Backup" para exportar.', true);
      }
      return file.name;
    },

    async createNewPicker() {
      const handle = await pickComHint((o) => window.showSaveFilePicker(o), {
        id: 'pcp-db',
        suggestedName: 'dimensionamento.sqlite',
        types: [{ description: 'Banco de dados SQLite', accept: { 'application/octet-stream': ['.sqlite'] } }],
      });
      await Engine.createEmpty();
      fileHandle = handle;
      await doAutosave();
      await idbSet('last-handle', handle);
      filePath = await relativePathFor(handle);
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
        // Reabertura automática, sem gesto do usuário — não dá pra abrir uma
        // janela de seleção de pasta aqui. Só tenta em silêncio, usando uma
        // pasta já concedida (guardada) e ainda com permissão válida.
        try { dirHandle = await idbGet('last-dir-handle'); } catch { dirHandle = null; }
        filePath = await relativePathFor(handle, { allowPrompt: false });
        return file.name;
      } catch {
        return null;
      }
    },

    async openFromInputFile(fileObj) {
      const bytes = new Uint8Array(await fileObj.arrayBuffer());
      await Engine.openFromBytes(bytes);
      fileHandle = null;
      dirHandle = null;
      filePath = null;
    },

    async createEmptyFallback() {
      await Engine.createEmpty();
      fileHandle = null;
      dirHandle = null;
      filePath = null;
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
    // Caminho relativo à pasta escolhida pelo usuário (ex.: "ORCAMENTO_2027/
    // dimensionamento.sqlite") — nunca o caminho absoluto do Windows, que o
    // navegador não expõe para nenhum site por segurança. null quando o
    // usuário não confirmou (ou cancelou) a janela de seleção de pasta.
    currentFilePath() { return filePath; },

    forget() {
      fileHandle = null;
      dirHandle = null;
      filePath = null;
    },

    // "Publicar Orçamento": salva uma cópia nomeada (não altera o arquivo de
    // trabalho atual nem o autosave) — nome + data no formato YYYYMMDD.
    async publish(nomeBase) {
      const safe = sanitizeName(nomeBase) || 'orcamento';
      const filename = `${safe}_${todayYYYYMMDD()}.sqlite`;
      const bytes = Engine.exportBytes();
      if (SUPPORTS_FS_ACCESS) {
        const handle = await window.showSaveFilePicker({
          id: 'pcp-db-publish',
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
