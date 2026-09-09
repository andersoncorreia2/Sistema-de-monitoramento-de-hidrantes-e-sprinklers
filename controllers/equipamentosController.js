const express = require('express');
const router = express.Router();
const Equipamento = require('../models/Equipamento'); // Chamando o Model!

// ==========================================
// FUNÇÃO: Conversor de Fuso Horário (UTC -> Local/Brasília)
// ==========================================
function ajustarFusoHorario(dataNuvem) {
    if (!dataNuvem) return "Sem dados";
    
    // Transforma a data bruta do banco em um objeto Date
    const data = new Date(dataNuvem);
    
    // Calcula o Fuso Horário Local do Servidor/Nuvem e subtrai as 3 horas do Brasil (-03:00)
    data.setHours(data.getHours() - 3);

    // Formata manualmente a string para que o Frontend não tente calcular o fuso
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    const horas = String(data.getHours()).padStart(2, '0');
    const minutos = String(data.getMinutes()).padStart(2, '0');
    const segundos = String(data.getSeconds()).padStart(2, '0');

    // Devolve uma string rígida no formato: "YYYY-MM-DD HH:MM:SS"
    return `${ano}-${mes}-${dia} ${horas}:${minutos}:${segundos}`;
}

// Rota para o Frontend buscar todos os equipamentos e plotar no mapa
router.get('/listar', async (req, res) => {
    try {
        // 1. Busca os dados reais e a telemetria cruzada no PostgreSQL
        const equipamentosDoBanco = await Equipamento.listarTodos();
        
        // 2. Formatação fiel ao seu frontend
        const equipamentosFormatados = equipamentosDoBanco.map(eq => {
            return {
                id: eq.id,
                tipo: eq.tipo,
                status: 'operacional', // Genérico inicial, o frontend recalcula a verdade
                locName: eq.local_nome, 
                coords: [Number(eq.lat), Number(eq.lng)],
                
                // A MÁGICA: Convertendo o horário da nuvem para o horário do Brasil
                ultima: ajustarFusoHorario(eq.ultima_leitura), 
                
                dados: {
                    agua: eq.agua || "OK", 
                    pressao_bar: eq.pressao_bar != null ? Number(eq.pressao_bar) : (eq.tipo === 'Hidrante' ? 7.5 : 2.0), 
                    vazao_lpm: eq.vazao_lpm != null ? Number(eq.vazao_lpm) : null,
                    integridade: eq.integridade || "bom"
                },
                responsavel: {
                    nome: eq.responsavel_nome,
                    tel: eq.responsavel_tel,
                    email: eq.responsavel_email
                }
            };
        });

        return res.status(200).json(equipamentosFormatados);

    } catch (erro) {
        console.error('Erro ao buscar equipamentos:', erro);
        return res.status(500).json({ erro: 'Erro ao buscar dados no banco.' });
    }
}); // <--- ESTE É O FECHAMENTO DA ROTA /listar ATUAL

// ==========================================
// NOVA ROTA: App Mobile buscar hidrantes próximos via GPS
// ==========================================
router.get('/proximos', async (req, res) => {
    try {
        const { lat, lng } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({ erro: 'Latitude e longitude da viatura são obrigatórias.' });
        }

        const equipamentosDoBanco = await Equipamento.buscarProximos(Number(lat), Number(lng));
        
        const hidrantesProximos = equipamentosDoBanco.map(eq => {
            return {
                id: eq.id,
                locName: eq.local_nome,
                coords: [Number(eq.lat), Number(eq.lng)],
                distancia_km: Number(eq.distancia_km).toFixed(2) + ' km'
            };
        });

        return res.status(200).json(hidrantesProximos);

    } catch (erro) {
        console.error('Erro ao calcular distância:', erro);
        return res.status(500).json({ erro: 'Erro ao buscar hidrantes próximos no banco.' });
    }
});

module.exports = router;