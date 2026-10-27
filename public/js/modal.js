// Modal genérico (overlay + caixa) usado pelos cadastros com drill-down por operação.
// opts.size: 'cadastro' para a janela grande de uma operação (quase a tela
// inteira, porque dentro dela moram grades de mês x filial), 'form' para uma
// caixa estreita (formulários), padrão = grade larga.
// opts.onClose (opcional): chamado sempre que o modal fecha (X, clique fora,
// Esc, ou close() programático) — usado pela lista de operações para
// recarregar o resumo de meses cadastrados assim que o usuário volta para
// ela, sem precisar navegar para outra página e voltar.

// Pilha dos modais abertos, do mais antigo ao do topo. Existe por causa do
// aninhamento (frame da operação -> formulário do mês -> popup de replicação):
// o listener de Esc de cada janela continua ativo enquanto ela existe, e sem
// essa checagem um único Esc fecharia as três de uma vez.
const MODAL_STACK = [];

function openModal(title, buildContentFn, opts = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box${opts.size === 'form' ? ' modal-box-form' : opts.size === 'cadastro' ? ' modal-box-cadastro' : ''}">
      <div class="modal-header">
        <h2>${escapeHtml(title)}</h2>
        <button class="modal-close" title="Fechar">${Icon('x', { size: 18 })}</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  MODAL_STACK.push(overlay);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    const i = MODAL_STACK.indexOf(overlay);
    if (i >= 0) MODAL_STACK.splice(i, 1);
    document.removeEventListener('keydown', onEsc);
    overlay.remove();
    if (opts.onClose) opts.onClose();
  }
  function onEsc(e) {
    if (e.key !== 'Escape') return;
    if (MODAL_STACK[MODAL_STACK.length - 1] !== overlay) return;
    close();
  }
  overlay.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onEsc);

  const body = overlay.querySelector('.modal-body');
  buildContentFn(body, close);
  return close;
}
