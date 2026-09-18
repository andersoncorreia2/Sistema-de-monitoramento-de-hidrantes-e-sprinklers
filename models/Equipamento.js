const db = require('../config/db');

const Equipamento = {
    // 1. Busca todos os equipamentos E a última leitura de cada um
    listarTodos: async () => {
        const query = `
            SELECT 
                e.id_equipamento AS id,
                e.tipo,
                CONCAT(e.logradouro, ', ', e.numero, ', ', e.bairro, ' - ', e.cidade, COALESCE(' | ' || e.edificio_nome, ''), CASE WHEN e.andar IS NOT NULL OR e.corredor_setor IS NOT NULL THEN CONCAT(' (Local exato: ', e.andar, ' - ', e.corredor_setor, ')') ELSE '' END) AS local_nome,
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

    // Busca equipamentos isolados exclusivamente por Região
    listarPorRegiao: async (regiao) => {
        const query = `
            SELECT 
                e.id_equipamento AS id, e.tipo,
                CONCAT(e.logradouro, ', ', e.numero, ', ', e.bairro, ' - ', e.cidade) AS local_nome,
                e.latitude AS lat, e.longitude AS lng, e.responsavel_nome, e.responsavel_telefone AS responsavel_tel, e.responsavel_email,
                COALESCE(lh.pressao_bar, ls.pressao_bar) AS pressao_bar, lh.vazao_lpm, lh.nivel_agua AS agua,
                CASE WHEN ls.status_obstrucao = true THEN 'obstruído' WHEN ls.status_quebrado = true THEN 'quebrado' ELSE 'bom' END AS integridade,
                COALESCE(lh.data_hora, ls.data_hora) AS ultima_leitura
            FROM equipamentos e
            LEFT JOIN LATERAL (SELECT pressao_bar, vazao_lpm, nivel_agua, data_hora FROM leituras_hidrante WHERE id_equipamento = e.id_equipamento ORDER BY data_hora DESC LIMIT 1) lh ON e.tipo = 'Hidrante'
            LEFT JOIN LATERAL (SELECT pressao_bar, status_obstrucao, status_quebrado, data_hora FROM leituras_sprinkler WHERE id_equipamento = e.id_equipamento ORDER BY data_hora DESC LIMIT 1) ls ON e.tipo = 'Sprinkler'
            WHERE e.regiao = $1 -- 🟢 FILTRO EXATO DO BANCO
            ORDER BY e.id_equipamento ASC;
        `;
        const resultado = await db.query(query, [regiao]);
        return resultado.rows;
    },
    
    // 2. A coluna status não existe mais no BD (o frontend calcula sozinho)
    atualizarStatus: async (id_equipamento, status) => {
        return true; // Retorna true silenciosamente para não quebrar o sistema
    },

    // 3. Busca os hidrantes mais próximos de uma coordenada (Fórmula de Haversine para o App Mobile)
    buscarProximos: async (latViatura, lngViatura) => {
        const query = `
            SELECT 
                id_equipamento AS id, 
                tipo, 
                COALESCE(edificio_nome, logradouro) AS local_nome, 
                latitude AS lat, 
                longitude AS lng,
                ( 6371 * acos( cos( radians($1) ) * cos( radians( latitude ) ) 
                * cos( radians( longitude ) - radians($2) ) 
                + sin( radians($1) ) * sin( radians( latitude ) ) ) ) AS distancia_km
            FROM equipamentos 
            WHERE tipo = 'Hidrante' 
            ORDER BY distancia_km ASC 
            LIMIT 5;
        `;
        const resultado = await db.query(query, [latViatura, lngViatura]);
        return resultado.rows;
    }
}; // Fim do objeto Equipamento

module.exports = Equipamento;