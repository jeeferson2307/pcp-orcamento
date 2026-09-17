// Modal genérico (overlay + caixa) usado pelos cadastros com drill-down por operação.
// opts.size: 'form' para uma caixa mais estreita (formulários), padrão = grade larga.
// opts.onClose (opcional): chamado sempre que o modal fecha (X, clique fora,
// Esc, ou close() programático) — usado pela lista de operações para
// recarregar o resumo de meses cadastrados assim que o usuário volta para
// ela, sem precisar navegar para outra página e voltar.
function openModal(title, buildContentFn, opts = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box${opts.size === 'form' ? ' modal-box-form' : ''}">
      <div class="modal-header">
        <h2>${escapeHtml(title)}</h2>
        <button class="modal-close" title="Fechar">${Icon('x', { size: 18 })}</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    if (opts.onClose) opts.onClose();
  }
  overlay.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });

  const body = overlay.querySelector('.modal-body');
  buildContentFn(body, close);
  return close;
}
