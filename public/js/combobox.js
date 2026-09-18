// Combobox (select pesquisável) — envolve um <select> já existente, sem
// mudar a API que o resto do app já usa (selectEl.value / selectEl.onchange /
// selectEl.innerHTML reconstruído por repopulateFilterSelect em pages.js).
// O <select> original vira a fonte de verdade (só fica visualmente oculto);
// o combobox é uma camada de UI por cima dele, sincronizada manualmente com
// refreshCombobox() sempre que alguém troca as <option> ou o .value por
// fora (ex.: repopulateFilterSelect, restauração de filtro salvo).
//
// Uso:
//   enhanceCombobox(document.getElementById('d-ano'));
//   ... depois de repopular as <option> do <select> por fora ...
//   refreshCombobox(document.getElementById('d-ano'));

function normalizeComboText(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function enhanceCombobox(selectEl) {
  if (!selectEl || selectEl._comboInput) { refreshCombobox(selectEl); return; }

  selectEl.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'combo';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'field-input combo-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  const menu = document.createElement('div');
  menu.className = 'combo-menu';
  menu.hidden = true;
  wrap.appendChild(input);
  wrap.appendChild(menu);
  selectEl.insertAdjacentElement('afterend', wrap);
  selectEl._comboInput = input;
  selectEl._comboMenu = menu;

  function options() {
    return [...selectEl.options].map(o => ({ value: o.value, label: o.textContent }));
  }
  function currentLabel() {
    const opt = options().find(o => o.value === selectEl.value);
    return opt ? opt.label : '';
  }
  function closeMenu() { menu.hidden = true; }
  function renderMenu(filterText) {
    const f = normalizeComboText(filterText);
    const opts = options().filter(o => !f || normalizeComboText(o.label).includes(f));
    menu.innerHTML = opts.length
      ? opts.map(o => `<div class="combo-option${o.value === selectEl.value ? ' active' : ''}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`).join('')
      : `<div class="combo-empty">Nenhuma opção encontrada.</div>`;
    menu.querySelectorAll('.combo-option').forEach(el => {
      // mousedown (não click): dispara antes do blur do input, senão o blur
      // fecharia o menu primeiro e o clique nunca chegaria na opção.
      el.addEventListener('mousedown', (e) => { e.preventDefault(); selectValue(el.dataset.value); });
    });
  }
  function openMenu() { renderMenu(input.value === currentLabel() ? '' : input.value); menu.hidden = false; }
  function selectValue(v) {
    if (selectEl.value !== v) {
      selectEl.value = v;
      selectEl.dispatchEvent(new Event('change'));
    }
    input.value = currentLabel();
    closeMenu();
  }

  input.addEventListener('focus', () => { input.select(); openMenu(); });
  input.addEventListener('input', () => openMenu());
  input.addEventListener('blur', () => {
    // setTimeout: dá tempo do mousedown da opção rodar antes de fechar/reverter.
    setTimeout(() => { input.value = currentLabel(); closeMenu(); }, 0);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = currentLabel(); closeMenu(); input.blur(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const first = menu.querySelector('.combo-option');
      if (first) selectValue(first.dataset.value);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (menu.hidden) { openMenu(); return; }
      const opts = [...menu.querySelectorAll('.combo-option')];
      if (!opts.length) return;
      const idx = opts.findIndex(o => o.classList.contains('hover'));
      let next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      if (next < 0) next = opts.length - 1;
      if (next >= opts.length) next = 0;
      opts.forEach(o => o.classList.remove('hover'));
      opts[next].classList.add('hover');
      opts[next].scrollIntoView({ block: 'nearest' });
    }
  });

  input.value = currentLabel();
}

// Ressincroniza o input/menu do combobox com o <select> depois que o resto
// do código reconstrói as <option> ou muda o .value diretamente (sem passar
// pelo combobox). Não faz nada se o select ainda não foi "enhanced".
function refreshCombobox(selectEl) {
  if (selectEl && selectEl._comboInput) {
    const opt = [...selectEl.options].find(o => o.value === selectEl.value);
    selectEl._comboInput.value = opt ? opt.textContent : '';
  }
}

// ---------------------------------------------------------------
// Multi-select pesquisável (combobox de seleção múltipla) — usado pelos
// filtros Operação e Descrição Centro de Custo do Painel Gerencial, onde
// faz sentido comparar/agregar mais de um valor ao mesmo tempo. Diferente
// de enhanceCombobox, não envolve um <select> nativo (a UI de multi-select
// nativa exige Ctrl+clique, ruim de descobrir) — mantém o próprio estado
// (array de valores selecionados) e expõe uma API mínima.
//
// Uso:
//   const ms = createMultiCombobox(document.getElementById('slot'), {
//     options: ['A', 'B', 'C'], allLabel: 'Todas', onChange: () => load(),
//   });
//   ms.getValues();            // -> [] (vazio = "Todas"/default)
//   ms.setOptions(novaLista);  // reconstrói as opções, descarta selecionados que sumiram
//   ms.setValues(['A']);       // restaura seleção (ex.: filtro salvo)
// ---------------------------------------------------------------
function createMultiCombobox(container, { options, allLabel, onChange }) {
  let opts = options.slice();
  let selected = new Set();

  const wrap = document.createElement('div');
  wrap.className = 'combo multi-combo';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'field-input combo-input multi-combo-btn';
  const menu = document.createElement('div');
  menu.className = 'combo-menu multi-combo-menu';
  menu.hidden = true;
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'multi-combo-search';
  search.placeholder = 'Buscar…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  const list = document.createElement('div');
  list.className = 'multi-combo-list';
  const actions = document.createElement('div');
  actions.className = 'multi-combo-actions';
  const selAllBtn = document.createElement('button');
  selAllBtn.type = 'button';
  selAllBtn.textContent = 'Selecionar visíveis';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Limpar';
  actions.append(selAllBtn, clearBtn);
  menu.append(search, list, actions);
  wrap.append(btn, menu);
  container.appendChild(wrap);

  function updateBtnLabel() {
    if (selected.size === 0) btn.textContent = allLabel;
    else if (selected.size === 1) btn.textContent = [...selected][0];
    else btn.textContent = `${selected.size} selecionadas`;
  }
  function visibleOptions() {
    const f = normalizeComboText(search.value);
    return opts.filter(o => !f || normalizeComboText(o).includes(f));
  }
  function renderList() {
    const visible = visibleOptions();
    list.innerHTML = visible.length
      ? visible.map(o => `<label class="multi-combo-option"><input type="checkbox" value="${escapeHtml(o)}"${selected.has(o) ? ' checked' : ''}><span>${escapeHtml(o)}</span></label>`).join('')
      : `<div class="combo-empty">Nenhuma opção encontrada.</div>`;
    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
        updateBtnLabel();
        onChange([...selected]);
      });
    });
  }
  function openMenu() { search.value = ''; renderList(); menu.hidden = false; search.focus(); }
  function closeMenu() { menu.hidden = true; }

  btn.addEventListener('click', () => { if (menu.hidden) openMenu(); else closeMenu(); });
  search.addEventListener('input', renderList);
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  selAllBtn.addEventListener('click', () => {
    visibleOptions().forEach(o => selected.add(o));
    renderList();
    updateBtnLabel();
    onChange([...selected]);
  });
  clearBtn.addEventListener('click', () => {
    selected.clear();
    renderList();
    updateBtnLabel();
    onChange([...selected]);
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) closeMenu(); });

  updateBtnLabel();

  return {
    getValues: () => [...selected],
    setValues(arr) {
      selected = new Set((arr || []).filter(v => opts.includes(v)));
      updateBtnLabel();
      if (!menu.hidden) renderList();
    },
    // Substitui a lista de opções (ex.: filtros cruzados recalculados após um
    // load()). Retorna true se alguma seleção atual deixou de existir e foi
    // descartada — quem chama pode então recarregar os dados.
    setOptions(newOptions) {
      opts = (newOptions || []).slice();
      let changed = false;
      for (const v of [...selected]) {
        if (!opts.includes(v)) { selected.delete(v); changed = true; }
      }
      updateBtnLabel();
      if (!menu.hidden) renderList();
      return changed;
    },
  };
}
