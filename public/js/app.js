let META = null;

const NAV = [
  { group: 'Guia Dashboard', items: [
    { id: 'dashboard', label: 'Painel Gerencial', icon: 'layout-dashboard' },
  ]},
  { group: 'Guias de Cadastro', items: [
    { id: 'cadastro:dimensionamento', label: 'Cadastro Dimensionamento', icon: 'sliders-horizontal' },
    { id: 'cadastro:overstaff', label: 'Cadastro Premissas Overstaff', icon: 'users' },
    { id: 'cadastro:receita', label: 'Cadastro Premissas Receita', icon: 'wallet' },
    { id: 'cadastro:adicionais', label: 'Cadastro Premissas Adicionais', icon: 'user-plus' },
    { id: 'cadastro:distribuicao', label: 'Cadastro Distribuição (Volume & HC)', icon: 'pie-chart' },
    { id: 'cadastro:ajustePremissas', label: 'Cadastro Ajuste Premissas', icon: 'trending-up' },
  ]},
  { group: 'Outros', items: [
    { id: 'flat:d_filiais', label: 'Filiais / Unidades', icon: 'map-pin' },
    { id: 'flat:cadastro_operacoes', label: 'Cadastro Operações', icon: 'building-2' },
    { id: 'calendario', label: 'Calendário', icon: 'calendar' },
  ]},
];

const CADASTRO_RENDERERS = {
  dimensionamento: renderCadastroDimensionamento,
  overstaff: renderCadastroOverstaff,
  receita: renderCadastroReceita,
  adicionais: renderCadastroAdicionais,
  distribuicao: renderCadastroDistribuicao,
  ajustePremissas: renderCadastroAjustePremissas,
};

function buildNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map(g => `
    <div class="nav-group">
      <div class="nav-group-title">${g.group}</div>
      ${g.items.map(it => `<a class="nav-item" data-route="${it.id}">${Icon(it.icon, { className: 'nav-icon' })}<span>${it.label}</span></a>`).join('')}
    </div>
  `).join('');
  nav.querySelectorAll('.nav-item').forEach(a => {
    a.addEventListener('click', () => { location.hash = a.dataset.route; document.body.classList.remove('nav-open'); });
  });
}

function labelForRoute(route) {
  for (const g of NAV) for (const it of g.items) if (it.id === route) return it.label;
  return route;
}

async function router() {
  const route = (location.hash || '#dashboard').slice(1);
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.route === route));
  document.getElementById('page-title').textContent = labelForRoute(route);
  const body = document.getElementById('page-body');
  body.innerHTML = '<div class="empty-state">Carregando…</div>';

  try {
    if (route === 'dashboard') return renderDashboardPage(body, META);
    if (route === 'calendario') return renderCalendarioPage(body, META);
    if (route.startsWith('wide:')) return renderWideGrid(body, route.slice(5), META);
    if (route.startsWith('flat:')) return renderFlatGrid(body, route.slice(5), META);
    if (route.startsWith('cadastro:')) {
      const fn = CADASTRO_RENDERERS[route.slice(9)];
      if (fn) return fn(body, META);
    }
    body.innerHTML = '<div class="empty-state">Página não encontrada.</div>';
  } catch (e) {
    console.error(e);
    body.innerHTML = `<div class="empty-state">Erro ao carregar: ${escapeHtml(e.message)}</div>`;
  }
}

async function startApp() {
  document.getElementById('launcher').style.display = 'none';
  document.getElementById('app-root').style.display = '';
  buildNav();
  META = await Api.get('/api/meta');
  document.getElementById('brand-file').textContent = FileStore.currentFileName() || '(salvo neste navegador)';
  window.addEventListener('hashchange', router);
  router();

  document.getElementById('btn-download-backup').onclick = () => FileStore.downloadBackup('dimensionamento.sqlite');
  document.getElementById('btn-switch-file').onclick = async () => {
    if (!confirm('Trocar de arquivo? As alterações não salvas no arquivo atual serão perdidas.')) return;
    FileStore.forget();
    document.getElementById('app-root').style.display = 'none';
    document.getElementById('launcher').style.display = '';
  };
  document.getElementById('btn-publicar').onclick = openPublishModal;
  document.getElementById('mobile-nav-toggle').onclick = () => document.body.classList.toggle('nav-open');
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('nav-open')) return;
    if (e.target.closest('.sidebar') || e.target.closest('.mobile-nav-toggle')) return;
    document.body.classList.remove('nav-open');
  });
}

// Modal com input próprio (em vez de confirm()+prompt()): dois diálogos nativos
// seguidos consomem a "ativação do usuário" antes de chegar no showSaveFilePicker,
// que passa a rejeitar com SecurityError. Aqui o clique em "Publicar" já é a
// própria ativação usada para abrir o seletor de arquivo, sem diálogos no meio.
function openPublishModal() {
  openModal('Publicar Orçamento', (body, close) => {
    body.innerHTML = `
      <p>Salva uma cópia deste banco de dados no local que você escolher. O arquivo de trabalho aberto agora não é alterado.</p>
      <label class="field-label">Nome do orçamento
        <input type="text" id="publish-name" value="orcamento" class="field-input" autofocus>
      </label>
      <div class="modal-actions">
        <button id="publish-cancel">Cancelar</button>
        <button class="primary" id="publish-confirm">${Icon('upload')} Publicar</button>
      </div>
    `;
    const input = body.querySelector('#publish-name');
    input.select();
    body.querySelector('#publish-cancel').onclick = close;
    body.querySelector('#publish-confirm').onclick = async () => {
      const nome = input.value.trim();
      if (!nome) { toast('Informe um nome.', true); return; }
      try {
        const filename = await FileStore.publish(nome);
        toast('Orçamento publicado: ' + filename);
        close();
      } catch (e) {
        if (e.name !== 'AbortError') toast('Erro ao publicar: ' + e.message, true);
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') body.querySelector('#publish-confirm').click(); });
  }, { size: 'form' });
}

function launcherError(msg) {
  document.getElementById('launcher-error').textContent = msg;
}

async function initLauncher() {
  if (FileStore.supportsFsAccess) {
    document.getElementById('btn-open').onclick = async () => {
      try { await FileStore.openPicker(); startApp(); }
      catch (e) { if (e.name !== 'AbortError') launcherError('Erro ao abrir: ' + e.message); }
    };
    document.getElementById('btn-new').onclick = async () => {
      try { await FileStore.createNewPicker(); startApp(); }
      catch (e) { if (e.name !== 'AbortError') launcherError('Erro ao criar: ' + e.message); }
    };
    const reopened = await FileStore.tryReopenLast();
    if (reopened) { startApp(); return; }
  } else {
    document.getElementById('launcher-fsaccess').style.display = 'none';
    document.getElementById('launcher-fallback').style.display = '';
    document.getElementById('file-input').onchange = async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      try { await FileStore.openFromInputFile(f); startApp(); }
      catch (e) { launcherError('Erro ao abrir: ' + e.message); }
    };
    document.getElementById('btn-new-fallback').onclick = async () => {
      try { await FileStore.createEmptyFallback(); startApp(); }
      catch (e) { launcherError('Erro ao criar: ' + e.message); }
    };
    const resumed = await FileStore.tryResumeAutosave();
    if (resumed) { startApp(); return; }
  }
}

initLauncher();
