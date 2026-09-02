# PCP · Dimensionamento & Orçamento (substitui o MODEL.xlsb)

Sistema que recria o modelo de orçamento/dimensionamento do `MODEL.xlsb`,
incluindo toda a lógica das queries Power Query. **Roda 100% no navegador —
sem Node, sem npm, sem servidor.** É só abrir o arquivo `public/index.html`.

## Como usar

1. Abra `public/index.html` no Chrome ou Edge (duplo clique, ou arraste para
   o navegador).
2. Na tela inicial, clique em **"Abrir banco de dados existente"** e
   selecione `data/dimensionamento.db` (já vem com os dados atuais do
   `MODEL.xlsb`, importados uma vez).
3. Pronto. Toda edição feita no sistema é **salva automaticamente de volta
   nesse mesmo arquivo** — pode fechar e abrir de novo, o arquivo sempre
   reflete o estado mais atual (igual ao Excel, mas sem precisar clicar em
   "Salvar").

Se preferir começar do zero, use **"Criar novo banco de dados"** na tela
inicial — ele já vem com todas as tabelas vazias prontas para preencher.

### Requisito de navegador

O salvamento direto no arquivo usa a **File System Access API**, hoje
suportada apenas por **Chrome e Edge** (não funciona no Firefox/Safari).
Se o navegador não suportar, o sistema cai automaticamente em modo alternativo:
salva sozinho dentro do próprio navegador (não se perde ao fechar a aba) e
oferece um botão **"⬇ Backup"** para baixar uma cópia `.sqlite` manualmente.

### Onde guardar o arquivo `.db`

Pode manter `data/dimensionamento.db` na mesma pasta do OneDrive onde hoje
fica o `MODEL.xlsb` — ele sincroniza normalmente como qualquer outro
arquivo (mesmo comportamento que você já tem hoje).

## Navegação

- **Guia Dashboard**
  - **Painel Gerencial** — KPIs (Receita Bruta, HC Dimensionado, FTE
    Financeiro, **ROB/Financeiro** = Receita÷FTE, Absenteísmo, Turnover,
    Férias, Folga Adicional — os 4 últimos como média ponderada por HC).
    Filtros por Ano, Responsável PCP, Gerente e Operação. A tabela
    agrupável (por Diretoria/Site/Cliente/Operação/Mês/UN DRE) tem
    **drill-down por Filial**: clique numa linha para ver o detalhamento
    por site mantendo o subtotal do grupo. Logo abaixo, a tabela
    **Analítico** completa (todas as linhas calculadas, com busca e
    exportação CSV). Botão **"📤 Publicar Orçamento"**: pede confirmação,
    pede um nome, e salva uma cópia `.sqlite` com o nome sanitizado
    (sem acentos/espaços) + `_AAAAMMDD` no local que você escolher — sem
    alterar o arquivo de trabalho que está aberto.
- **Guias de Cadastro** (lista vertical de operações → clique abre uma
  janela com o detalhe mês a mês)
  - **Cadastro Operações** — tabela única (substitui os antigos cadastros
    separados de Centro de Custo e Operações).
  - **Cadastro Dimensionamento** — Volume, TMA, Pausa e Ocupação (formato
    decimal `#.#`, sem casas de percentual — replica o formato original da
    planilha), HC Dimensionado, HC Contratado. Ao adicionar um mês, o
    TIPO_DIMENS é herdado automaticamente do último mês cadastrado.
  - **Cadastro Premissas Overstaff** — Absenteísmo, Turnover, Férias, Folga
    Extra, Evasão (por filial, formato `##.#`), com separação visual entre
    os blocos de cada indicador.
  - **Cadastro Premissas Receita** — Unitário/Abandono/Shortcalls/Tipo de
    Faturamento (fixo por filial) + CPRB/Reajuste/Receita Bodyshop
    (mensal, por filial).
  - **Cadastro Premissas Adicionais** — Contratações Adicionais, Spam
    Supervisão, Jovem Aprendiz (por filial).
  - **Cadastro Distribuição (Volume & HC)** — % por filial, com coluna de
    Total (verde se soma ≈100%, vermelho caso contrário).
  - Todo cadastro mensal tem um botão **"→"** por linha para replicar os
    valores daquele mês para o mês seguinte, e um **"✕"** para excluir um
    mês que foi gerado por engano.
- **Outros** — Filiais/Unidades.

## Arquitetura (tudo em `public/`, sem build step)

- **`js/lib/sql-wasm.js` + `sql-wasm-data.js`** — o próprio SQLite compilado
  para WebAssembly ([sql.js](https://sql.js.org)), com o binário `.wasm`
  embutido em base64 (evita qualquer `fetch()`/rede — funciona até offline).
- **`js/dbengine.js`** — abre bytes de um `.sqlite` (ou cria um banco vazio a
  partir de `schema-sql.js`) e expõe `window.DB` com a mesma interface do
  `better-sqlite3` (`prepare().all()/.get()/.run()`, `exec()`, `transaction()`),
  para reaproveitar a lógica de cálculo sem reescrever.
- **`js/filestore.js`** — abrir/criar/salvar o banco como arquivo real no
  disco (File System Access API), com fallback via IndexedDB + download.
- **`js/calendario.js` + `js/calc.js`** — motor de cálculo: réplica fiel do
  pipeline `TB_PREMISSAS_DIMENS → FORECAST → COMPLETO → FINAL` das queries
  originais do Power Query (extraídas via automação COM do Excel). Validado
  linha a linha contra a aba `ANALITICO` do Excel original — valores batem
  exatamente, inclusive ruído de ponto flutuante.
- **`js/store.js`** — CRUD das tabelas + resultado calculado + painel
  gerencial (equivalente ao que antes era uma API REST, agora chamado
  direto em memória).
- **`js/api.js`** — camada de compatibilidade: mantém a mesma interface
  `Api.get/post/put/del("/api/...")` usada pelas páginas, mas despacha para
  `Store.*` em vez de fazer requisição de rede.
- **`js/widegrid.js` / `js/flatgrid.js`** — grades genéricas (tabela larga
  pivotada por filial / tabela chata com CRUD por chave primária).
- **`js/modal.js`** — janela (overlay) genérica usada pelos cadastros.
- **`js/cadastros.js`** — as 5 telas de cadastro com navegação por operação
  (lista → modal mês a mês), incluindo o botão de replicar mês e a
  validação de soma 100% da Distribuição.
- **`js/pages.js` / `js/app.js`** — Painel Gerencial, Analítico, navegação.

## Pasta `src/` (só para manutenção — não é usada pelo app)

Contém a versão Node.js original (Express + better-sqlite3) que foi usada
para **importar os dados do `MODEL.xlsb` pela primeira vez**
(`src/seed.js`). Só é necessária se um dia você quiser reimportar do zero a
partir de uma nova versão do `MODEL.xlsb`:

```bash
cd webapp
npm install
npm run seed     # regrava data/dimensionamento.db a partir do MODEL.xlsb
```

Depois disso, volte a abrir `public/index.html` normalmente — não precisa
mais do Node para o dia a dia.

## Diferenças propositais em relação à planilha original

- O filtro fixo `RESPONSÁVEL PCP = "<nome do responsável>"` da query
  `TB_PROJECAO_FORECAST_FINAL` foi generalizado: na página **Analítico** o
  responsável é um filtro (dropdown "Todos" por padrão), não mais um valor
  fixo no código.

## Limitação conhecida

Na validação contra a aba `ANALITICO`, o motor de cálculo bateu exatamente
em todas as amostras verificadas manualmente, mas o total de linhas do
mês-base (setembro/2026) ficou 2 linhas abaixo do Excel (41 vs 43; os
demais meses bateram exatamente). Ainda não foi identificada a causa
exata — é a próxima coisa a investigar caso os números do mês-base pareçam
incompletos no painel.
