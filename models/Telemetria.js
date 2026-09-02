const db = require('../config/db');

const Telemetria = {
    // Registra o log histórico do Hidrante
    registrarLeituraHidrante: async (dados) => {
        const query = `
            INSERT INTO leituras_hidrante 
            (id_equipamento, pressao_bar, vazao_lpm, volume_rede_m3, nivel_agua, alerta_vandalismo, alerta_corrosao, data_hora) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `;
        const valores = [
            dados.id_equipamento, dados.pressao_bar, dados.vazao_lpm, 
            dados.volume_rede_m3, dados.nivel_agua, dados.alerta_vandalismo, dados.alerta_corrosao
        ];
        await db.query(query, valores);
    },

    // Registra o log histórico do Sprinkler
    registrarLeituraSprinkler: async (dados) => {
        const query = `
            INSERT INTO leituras_sprinkler 
            (id_equipamento, pressao_bar, vazao_lpm, volume_rede_m3, status_obstrucao, status_quebrado, data_hora) 
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `;
        const valores = [
            dados.id_equipamento, dados.pressao_bar, dados.vazao_lpm, 
            dados.volume_rede_m3, dados.status_obstrucao, dados.status_quebrado
        ];
        await db.query(query, valores);
    }
};

module.exports = Telemetria;