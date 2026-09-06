const db = require('../config/db');

const Equipamento = {
    // 1. Busca todos os equipamentos E a última leitura de cada um
    listarTodos: async () => {
        const query = `
            SELECT 
                e.id_equipamento AS id,
                e.tipo,
                COALESCE(e.edificio_nome, e.logradouro) AS local_nome,
                e.latitude AS lat,
                e.longitude AS lng,
                e.responsavel_nome,
                e.responsavel_telefone AS responsavel_tel,
                e.responsavel_email,
                COALESCE(lh.pressao_bar, ls.pressao_bar) AS pressao_bar,
                lh.vazao_lpm,
                lh.nivel_agua AS agua,
                CASE 
                    WHEN ls.status_obstrucao = true THEN 'obstruído'
                    WHEN ls.status_quebrado = true THEN 'quebrado'
                    ELSE 'bom'
                END AS integridade,
                COALESCE(lh.data_hora, ls.data_hora) AS ultima_leitura
            FROM equipamentos e
            -- Busca a última leitura do Hidrante (se for Hidrante)
            LEFT JOIN LATERAL (
                SELECT pressao_bar, vazao_lpm, nivel_agua, data_hora 
                FROM leituras_hidrante 
                WHERE id_equipamento = e.id_equipamento 
                ORDER BY data_hora DESC LIMIT 1
            ) lh ON e.tipo = 'Hidrante'
            -- Busca a última leitura do Sprinkler (se for Sprinkler)
            LEFT JOIN LATERAL (
                SELECT pressao_bar, status_obstrucao, status_quebrado, data_hora 
                FROM leituras_sprinkler 
                WHERE id_equipamento = e.id_equipamento 
                ORDER BY data_hora DESC LIMIT 1
            ) ls ON e.tipo = 'Sprinkler'
            ORDER BY e.id_equipamento ASC;
        `;
        const resultado = await db.query(query);
        return resultado.rows;
    },

    // 2. A coluna status não existe mais no BD (o frontend calcula sozinho)
    atualizarStatus: async (id_equipamento, status) => {
        return true; // Retorna true silenciosamente para não quebrar o sistema
    }
};

module.exports = Equipamento;