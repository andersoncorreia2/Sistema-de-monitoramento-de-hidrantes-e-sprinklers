const { Pool } = require('pg');
require('dotenv').config();

// Cria a ponte de conexão usando os dados do seu .env
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false } // OBRIGATÓRIO: Libera a conexão segura com o Supabase
});

// Amortecedor de quedas de conexão em segundo plano
pool.on('error', (err, client) => {
    console.error('⚠️ Oscilação de rede com o Supabase detectada e amortecida:', err.message);
});

// OBRIGATÓRIO: Exporta a função query para o resto do sistema poder usar
module.exports = {
    query: (text, params) => pool.query(text, params),
};