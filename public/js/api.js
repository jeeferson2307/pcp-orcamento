// Mesma interface usada pelas páginas (Api.get/post/put/del com URLs "/api/..."),
// mas por baixo chama Store.* diretamente em memória — sem rede, sem servidor.
// Isso permite reaproveitar widegrid.js/flatgrid.js/pages.js/app.js sem alterações.
const Api = {
  _dispatch(method, url, body) {
    const u = new URL(url, 'http://local/');
    const path = u.pathname;
    const q = Object.fromEntries(u.searchParams.entries());

    try {
      let result;
      let m;
      if (path === '/api/meta') {
        result = Store.getMeta();
      } else if ((m = path.match(/^\/api\/wide\/([^/]+)\/row$/))) {
        if (method === 'POST') result = Store.postWideRow(m[1], body);
        else if (method === 'DELETE') result = Store.deleteWideRow(m[1], body);
      } else if ((m = path.match(/^\/api\/wide\/([^/]+)$/))) {
        if (method === 'GET') result = Store.getWide(m[1]);
        else if (method === 'PUT') result = Store.putWideCells(m[1], body.cells);
      } else if ((m = path.match(/^\/api\/flat\/([^/]+)$/))) {
        if (method === 'GET') result = Store.getFlat(m[1]);
        else if (method === 'POST') result = Store.postFlat(m[1], body);
        else if (method === 'PUT') result = Store.putFlat(m[1], body);
        else if (method === 'DELETE') result = Store.deleteFlat(m[1], body);
      } else if (path === '/api/resultado') {
        result = Store.getResultado({ ano: parseInt(q.ano, 10), responsavel: q.responsavel, apenasComCusto: q.apenasComCusto !== '0' });
      } else if (path === '/api/dashboard') {
        result = Store.getDashboard({ ano: parseInt(q.ano, 10), groupBy: q.groupBy, drillBy: q.drillBy, responsavel: q.responsavel, gerente: q.gerente, operacao: q.operacao });
      } else {
        return Promise.reject(new Error('rota desconhecida: ' + path));
      }
      return Promise.resolve(result);
    } catch (e) {
      return Promise.reject(e);
    }
  },
  get(url) { return this._dispatch('GET', url); },
  post(url, body) { return this._dispatch('POST', url, body); },
  put(url, body) { return this._dispatch('PUT', url, body); },
  del(url, body) { return this._dispatch('DELETE', url, body); },
};
