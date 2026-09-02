const express = require('express');
const router = express.Router();
const Telemetria = require('../models/Telemetria');
const Equipamento = require('../models/Equipamento');

// Rota para receber dados dos sensores de HIDRANTES
router.post('/hidrante', async (req, res) => {
    try {
        const { alerta_vandalismo, alerta_corrosao, nivel_agua, pressao_bar, id_equipamento } = req.body;
        let status = 'operacional';
        
        if (alerta_vandalismo === true || alerta_corrosao === true || nivel_agua === 'Crítico' || pressao_bar < 4.0) {
            status = 'falha';
        } else if (nivel_agua === 'Baixo' || pressao_bar < 6.0) {
            status = 'atencao';
        }

        // Delegação MVC pura
        await Telemetria.registrarLeituraHidrante(req.body);
        await Equipamento.atualizarStatus(id_equipamento, status);

        return res.status(201).json({ mensagem: 'Leitura de hidrante registrada', novo_status: status });
    } catch (erro) {
        console.error("Erro na telemetria de hidrante:", erro);
        return res.status(500).json({ erro: 'Erro interno ao processar dados' });
    }
});

// Rota para receber dados dos sensores de SPRINKLERS
router.post('/sprinkler', async (req, res) => {
    try {
        const { status_quebrado, status_obstrucao, pressao_bar, id_equipamento } = req.body;
        let status = 'operacional';
        
        if (status_quebrado === true || status_obstrucao === true || pressao_bar < 1.2) {
            status = 'falha';
        } else if (pressao_bar < 2.0) {
            status = 'atencao';
        }

        // Delegação MVC pura
        await Telemetria.registrarLeituraSprinkler(req.body);
        await Equipamento.atualizarStatus(id_equipamento, status);

        return res.status(201).json({ mensagem: 'Leitura de sprinkler registrada', novo_status: status });
    } catch (erro) {
        console.error("Erro na telemetria de sprinkler:", erro);
        return res.status(500).json({ erro: 'Erro interno ao processar dados' });
    }
});

module.exports = router;