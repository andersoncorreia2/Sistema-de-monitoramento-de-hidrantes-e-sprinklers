const express = require('express');
const router = express.Router();
const Equipamento = require('../models/Equipamento'); // Chamando o Model!

// Rota para o Frontend buscar todos os equipamentos e plotar no mapa
router.get('/listar', async (req, res) => {
    try {
        // 1. Busca os dados reais no PostgreSQL através do Model
        const equipamentosDoBanco = await Equipamento.listarTodos();
        
        // 2. Formatação fiel ao seu frontend (NÃO ALTERAR)
        const equipamentosFormatados = equipamentosDoBanco.map(eq => {
            return {
                id: eq.id,
                tipo: eq.tipo,
                status: eq.status, 
                locName: eq.local_nome, 
                coords: [Number(eq.lat), Number(eq.lng)],
                ultima: eq.ultima_leitura, 
                dados: {
                    agua: eq.agua || "OK", 
                    pressao_bar: eq.pressao_bar !== null ? Number(eq.pressao_bar) : (eq.tipo === 'Hidrante' ? 7.5 : 2.0), 
                    vazao_lpm: eq.vazao_lpm !== null ? Number(eq.vazao_lpm) : null,
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
});

module.exports = router;