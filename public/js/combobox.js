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
