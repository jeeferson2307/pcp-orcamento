# PCP · Dimensionamento & Orçamento (substitui o MODEL.xlsb)

Sistema que recria o modelo de orçamento/dimensionamento do `MODEL.xlsb`,
incluindo toda a lógica das queries Power Query. **Roda 100% no navegador —
sem Node, sem npm, sem servidor.** É só abrir o arquivo `public/index.html`.

## Como usar

1. Abra `public/index.html` no Chrome ou Edge (duplo clique, ou arraste para
   o navegador).
2. Na tela inicial, clique em **"Abrir banco de dados existente"** e
   selecione `data/dimensionamento.db` (já vem com os dados atuais do
   `MODEL.xlsb`, importados uma vez). Uma segunda janela pode aparecer
   pedindo para confirmar a **pasta** desse arquivo (já abre direto nela,
   só confirme) — é assim que o sistema consegue mostrar, na barra lateral,
   o caminho da pasta junto do nome do arquivo (o navegador nunca revela o
   caminho completo do Windows, só o que o usuário confirmar explicitamente).
   Se você cancelar essa segunda janela, tudo funciona normalmente, só que
   sem esse detalhe extra.
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

Alguns ambientes (política corporativa, ou a página aberta dentro de um
visualizador embutido do Teams/Outlook/SharePoint em vez do navegador
propriamente dito) **têm Chrome/Edge, mas mesmo assim recusam a permissão de
escrita direta no arquivo** (erro típico: "Not allowed to request permissions
in this context"). Nesse caso o sistema também cai automaticamente no mesmo
modo alternativo acima — o arquivo é lido normalmente, mas as edições ficam
salvas neste navegador, com aviso na tela pedindo para usar o botão
**"⬇ Backup"**. Para voltar a salvar direto no arquivo, abra o
`public/index.html` numa janela normal do Chrome/Edge (fora do
Teams/Outlook/SharePoint).

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
- **Guia Versões**
  - **Versões** — lista dos marcos criados, com autor, data, quantidade de
    alterações e motor de cálculo usado. Permite criar uma versão nova
    (congela os indicadores do momento), restaurar o estado de uma versão
    anterior e excluir um marco.
  - **Comparativo** — escolha duas versões (ou uma versão e a *versão de
    trabalho*, que é o estado atual) e veja os indicadores lado a lado com
    **delta absoluto e percentual**: Receita Bruta, FTE Financeiro, HC
    Dimensionado, HC Treinamento, Volume, ROB/Financeiro, Unitário médio,
    TMA, Absenteísmo, Turnover, Férias e Folga Extra. Agrupe por
    Diretoria/Site/Cliente/Operação/Mês/UN DRE/Centro de Custo/Gerente e
    filtre por mês. Logo abaixo, a tabela **o que mudou**: cada campo
    alterado entre as duas versões, com valor antes, valor depois, quem
    pediu e por quê. Tudo exportável em CSV.
  - **Histórico de Alterações** — o log completo, filtrável por versão,
    operação, solicitante e busca livre.
- **Guias de Cadastro** (lista vertical de operações → clique abre uma
  janela grande com o detalhe daquela operação)

  Todas as guias de premissas seguem o mesmo padrão: um **combo de
  indicadores** no topo da janela e, abaixo, a grade **mês × filial** só do
  indicador escolhido — em vez de todos os indicadores lado a lado numa
  tabela larguíssima. As colunas de filial trazem **apenas as filiais em que
  a operação está cadastrada** em Cadastro Operações (o aviso ao lado do
  combo mostra, por exemplo, "2 de 4 filiais"). Se a operação não tiver
  nenhuma filial cadastrada, a grade volta a mostrar todas — sinal de que
  falta completar o Cadastro Operações.
  - **Cadastro Centro de Custo** — a dimensão de centro de custo: Código
    Empresa, Código Filial, Código Centro de Custo, Descrição, Cliente,
    UN DRE, Diretoria, Gerente, Responsável PCP e Responsável FP&A.
    Cadastre aqui uma vez e reaproveite em quantas operações precisar.
  - **Cadastro Operações** — cada linha é uma operação numa filial, com
    **Tipo Escala** e a escolha do **Centro de Custo**. Ao selecionar o centro
    de custo (a lista mostra *descrição · código*, porque descrições se
    repetem entre códigos diferentes), os demais campos aparecem preenchidos
    e **bloqueados** — eles pertencem ao centro de custo, não à operação.
    O motor de cálculo busca esses dados pelo relacionamento, e o Analítico
    continua trazendo cliente, UN DRE, diretoria, gerente e responsáveis
    exatamente como antes.
  - **Cadastro Dimensionamento** — Volume, TMA, Pausa e Ocupação (formato
    decimal `#.#`, sem casas de percentual — replica o formato original da
    planilha), HC Dimensionado, HC Contratado. Ao adicionar um mês, o
    TIPO_DIMENS é herdado automaticamente do último mês cadastrado.
  - **Cadastro Premissas Overstaff** — combo com Absenteísmo, Turnover,
    Férias, Folga Extra, Evasão Treinamento e Feriado Local (formato
    `##.#`), um indicador por vez.
  - **Cadastro Premissas Receita** — combo com Unitário de Faturamento
    (Unitário/Abandono/Shortcalls/Tipo de Faturamento, fixo por filial, sem
    mês) + CPRB, Reajuste e Receita Bodyshop (mensais).
  - **Cadastro Premissas Adicionais** — combo com Contratações Adicionais,
    Spam Supervisão e Jovem Aprendiz.
  - **Cadastro Distribuição (Volume & HC)** — combo com Distribuição de
    Volume e Distribuição de HC, cada uma com coluna de Total (verde se soma
    ≈100%, vermelho caso contrário). Como as colunas agora são só as filiais
    da operação, o Total passa a fechar 100% sem contar filiais que não
    participam.
  - **Cadastro Ajuste Premissas** — combo com Ajuste de Volume, TMA e Pausa.
    É o único cadastro sem dimensão de filial (a grade é mês × valor); os
    três ajustes de um mesmo mês moram na mesma linha do banco, então editar
    um preserva os outros dois.
  - Todo cadastro mensal tem um botão **"→"** por linha que abre um popup
    perguntando **até qual mês replicar** — os valores daquele mês são
    copiados para todos os meses até o escolhido (inclusive), sobrescrevendo
    os que já existirem. Há também um **"✕"** para excluir um mês que foi
    gerado por engano.
  - Nos formulários mês a mês, um campo **deixado em branco apaga o valor**
    (vira nulo no banco), e não mais mantém o valor anterior.
  - Os botões de **modelo de planilha** trabalham sobre o **indicador
    selecionado no combo**: o arquivo sai com as colunas só daquele
    indicador (mês × filiais da operação), e o nome do arquivo o identifica.
    A coluna de meses vem preenchida **do primeiro ao último mês já
    cadastrado naquele cadastro, sem buracos** — inclusive os meses que hoje
    só existem em outro indicador, senão não haveria onde preenchê-los.
    Quando o cadastro inteiro ainda está vazio (comum em CPRB, Reajuste e
    Bodyshop), a faixa vem do horizonte que a operação tem nos demais
    cadastros, para o modelo não sair só com o cabeçalho.
    Na importação, **linhas inteiramente em branco são ignoradas** (o modelo
    já traz a faixa toda) e um campo apagado numa linha preenchida limpa
    aquele valor. No Ajuste de Premissas, onde os três ajustes dividem a mesma
    linha do banco, importar um deles **preserva os outros dois**.
- **Outros** — Filiais/Unidades.

### Exportar e importar (Filiais, Centro de Custo, Operações)

As três grades de dimensão têm botões de **exportar** e **importar** CSV na
barra de ações. O arquivo exportado **já é o modelo de importação**: baixe,
edite no Excel e importe de volta.

- a exportação respeita o filtro da busca — buscou, exportou só aquilo;
- em Operações, as colunas que vêm do centro de custo saem marcadas com
  **`(ref.)`**. São informativas: na importação são reconhecidas e
  **ignoradas** (para alterá-las, use o cadastro de Centro de Custo);
- a importação **cria e atualiza**, nunca apaga: registros que existem no
  sistema e não estão na planilha continuam como estão;
- antes de gravar, tudo é validado — coluna desconhecida, coluna-chave
  faltando, chave em branco, linha repetida, texto em campo numérico, Tipo
  Escala fora da lista, filial ou centro de custo inexistente. **Havendo
  qualquer erro, nada é gravado** e a tela lista todos os problemas com o
  número da linha;
- cada registro importado passa pelo mesmo caminho de gravação da tela, então
  entra no histórico de alterações com o contexto (autor/solicitante/motivo)
  que estiver ativo.

## Centro de custo: uma dimensão, não uma cópia

Antes, os dez campos de centro de custo ficavam **copiados dentro de cada
linha** de `cadastro_operacoes` (uma cópia por operação+filial). Com isso o
mesmo código podia aparecer com descrição, UN DRE ou responsável diferentes
em operações diferentes — e aparecia.

Agora existe `d_centro_custo` (PK `cod_centro_de_custo`), e
`cadastro_operacoes` guarda apenas `operacao`, `filial`,
`cod_centro_de_custo` e `tipo_escala`. O motor de cálculo faz o join:

```sql
FROM cadastro_operacoes o
LEFT JOIN d_centro_custo c ON c.cod_centro_de_custo = o.cod_centro_de_custo
```

O join devolve a mesma forma de antes, então o resto de `calc.js` não mudou.
Validado comparando o resultado do motor anterior com o atual sobre a mesma
base: **as 487 linhas do Analítico e todos os valores numéricos batem
exatamente**; só os rótulos herdados mudaram, e apenas nos códigos que
estavam divergentes.

### Migração de bancos existentes

Roda sozinha na primeira abertura, quando o banco ainda tem o formato antigo.
Para cada código, vence a combinação de atributos **mais frequente** (empate:
a primeira encontrada). O que foi descartado não some calado: fica guardado em
`tb_config` e a tela de Centro de Custo mostra um aviso listando código,
campo, valor adotado e valor descartado, para conferência e correção. O aviso
pode ser ocultado depois de conferido; o relatório continua no banco.

### Tipo Escala continua na operação

Não é atributo do centro de custo: duas operações do mesmo centro de custo
podem ter escalas diferentes, e é a escala que define a base de dias de
faturamento na projeção de volume.

## Versionamento (histórico e comparativo)

O problema que isso resolve: alguem pede um ajuste, o valor é alterado, e
semanas depois ninguém lembra **o que mudou nem quem pediu**.

O modelo é **log de alterações + marcos de versão**, tudo dentro do mesmo
arquivo `.sqlite`:

- a unidade versionada é a **célula**, não o banco. Cada gravação registra uma
  linha em `tb_alteracoes` com valor antes, valor depois, autor, solicitante e
  motivo;
- uma **versão** é apenas um corte nesse log (`tb_versoes.ultima_alteracao_id`),
  mais os indicadores calculados congelados em `tb_versao_resultado`;
- por isso os dados completos continuam existindo **uma única vez** (as tabelas
  de sempre) e o motor de cálculo (`calc.js`) não precisou mudar.

Dimensionamento real medido na base atual: um snapshot completo por versão
custaria ~1,1 MB (55 MB em 50 versões, num arquivo que é reescrito a cada
edição); neste modelo são ~100 bytes por alteração e ~0,1 MB por versão —
**~6 MB em 50 versões**.

### Barra de contexto

No alto da tela, ao lado de "Publicar Orçamento", fica o botão de **contexto**:
preencha uma vez *quem você é*, *quem pediu* e *por quê*, e toda alteração
passa a sair carimbada com esses dados até você trocar. Enquanto o autor não
for informado, o botão fica destacado em vermelho.

### Restaurar

Restaurar uma versão **não apaga histórico**: as reversões entram no log como
alterações novas (com motivo automático) e ao final nasce uma versão nova.
Sempre dá para voltar atrás. Linhas criadas depois do corte são removidas e
linhas excluídas são recriadas com os valores originais.

### Mudança de dado x mudança de fórmula

Cada versão guarda o identificador do motor de cálculo (`engine_versao`).
Quando as duas versões comparadas usaram motores diferentes, o Comparativo
**avisa**, porque parte da diferença pode vir da fórmula e não do dado.
Marcando *"Recalcular ambas com o motor atual"*, o sistema reconstrói o estado
antigo **num clone do banco em memória** e recalcula com o motor de hoje — o
arquivo de trabalho não é tocado.

Esse identificador (`calc-xxxxxxxx`) é **calculado sozinho**: é um hash do
texto das funções e constantes do `calc.js` que estão rodando. Qualquer edição
no motor muda o hash na hora, sem ninguém precisar lembrar de atualizar nada —
antes era uma data digitada à mão, que ficou para trás na primeira mudança do
`calc.js` e deixou o aviso mudo.

> O hash sai de `Function.prototype.toString()`, e não da leitura do arquivo,
> porque o sistema é aberto por duplo clique (`file://`), onde o navegador
> bloqueia a leitura até de um arquivo vizinho. Como o projeto não tem build
> nem minificação, o texto da função é o do arquivo.
>
> Versões criadas antes desta mudança ficaram com a data antiga (`2026.10.27`)
> e aparecem como motor diferente do atual — o que é honesto: não dá para
> saber qual dos dois `calc.js` daquele período gerou cada uma.

### Primeira abertura

Na primeira vez que um banco existente é aberto com esta versão do sistema,
as tabelas de versionamento são criadas automaticamente e nasce o marco
**"Estado inicial"**, para servir de base de comparação. O histórico anterior
à adoção não existe — começa a ser gravado a partir daí.

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
- **`js/cadastros.js`** — as 6 telas de cadastro com navegação por operação
  (lista → janela da operação → combo de indicadores → grade mês × filial),
  incluindo o recorte das filiais da operação, o popup de replicação por
  intervalo de meses e a validação de soma 100% da Distribuição.
- **`js/versionamento.js`** — o motor do versionamento: registro de
  alterações, cortes de versão, congelamento dos indicadores, restauração,
  diff de entradas e comparação de indicadores. Dado e log vão sempre na
  **mesma transação** — histórico incompleto em silêncio seria pior do que a
  edição não acontecer.
- **`js/versoes.js`** — as telas de Versões, Comparativo e Histórico.
- **`js/pages.js` / `js/app.js`** — Painel Gerencial, Analítico, navegação e a
  barra de contexto das alterações.

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
