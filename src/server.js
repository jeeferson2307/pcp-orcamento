const express = require('express');
const path = require('path');
const routes = require('./routes');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api', routes);
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PCP Dimensionamento rodando em http://localhost:${PORT}`);
});
