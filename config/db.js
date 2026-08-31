const { Pool } = require('pg');
require('dotenv').config();

// Cria a ponte de conexão usando os dados do seu .env
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Testa a conexão assim que o servidor liga
pool.connect()
    .then(() => console.log('🗄️ Conectado ao banco de dados PostgreSQL com sucesso!'))
    .catch(err => console.error('❌ Erro ao conectar ao PostgreSQL:', err.stack));

module.exports = pool;