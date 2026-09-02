const db = require('../config/db');

const Equipamento = {
    // 1. Busca todos os equipamentos para plotar no mapa
    listarTodos: async () => {
        const query = 'SELECT * FROM equipamentos ORDER BY id ASC';
        const resultado = await db.query(query);
        return resultado.rows;
    },

    // 2. Atualiza APENAS o status (operacional, atencao, falha)
    atualizarStatus: async (id_equipamento, status) => {
        const query = 'UPDATE equipamentos SET status = $1 WHERE id = $2';
        await db.query(query, [status, id_equipamento]);
    }
};

module.exports = Equipamento;