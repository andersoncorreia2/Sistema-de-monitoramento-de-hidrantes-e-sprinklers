const express = require('express');
const router = express.Router();

// Rota para receber dados dos sensores de HIDRANTES
router.post('/hidrante', async (req, res) => {
    // 1. Recebe os dados JSON enviados pelo sensor
    const { 
        id_equipamento, pressao_bar, vazao_lpm, 
        volume_rede_m3, nivel_agua, alerta_vandalismo, alerta_corrosao 
    } = req.body;

    try {
        // 2. Regra de Negócio: Avaliação do Status
        let status = 'operacional';
        
        if (alerta_vandalismo === true || alerta_corrosao === true || nivel_agua === 'Crítico' || pressao_bar < 4.0) {
            status = 'falha';
        } else if (nivel_agua === 'Baixo' || pressao_bar < 6.0) {
            status = 'atencao';
        }

        // 3. Aqui você conectaria com o Model (Banco de Dados) para salvar o histórico
        // await db.Leituras_Hidrante.create({ id_equipamento, pressao_bar, ..., data_hora: new Date() });
        // await db.Equipamentos.update({ status_atual: status }, { where: { id_equipamento } });

        return res.status(201).json({ 
            mensagem: 'Leitura do hidrante registrada com sucesso', 
            novo_status: status 
        });
    } catch (erro) {
        return res.status(500).json({ erro: 'Erro interno ao processar dados do hidrante' });
    }
});

// Rota para receber dados dos sensores de SPRINKLERS
router.post('/sprinkler', async (req, res) => {
    // 1. Recebe os dados JSON enviados pelo sensor
    const { 
        id_equipamento, pressao_bar, vazao_lpm, 
        volume_rede_m3, status_obstrucao, status_quebrado 
    } = req.body;

    try {
        // 2. Regra de Negócio: Avaliação do Status
        let status = 'operacional';
        
        if (status_quebrado === true || status_obstrucao === true || pressao_bar < 1.2) {
            status = 'falha';
        } else if (pressao_bar < 2.0) {
            status = 'atencao';
        }

        // 3. Salvamento via Model (Banco de Dados)
        // await db.Leituras_Sprinkler.create({ id_equipamento, pressao_bar, ..., data_hora: new Date() });
        // await db.Equipamentos.update({ status_atual: status }, { where: { id_equipamento } });

        return res.status(201).json({ 
            mensagem: 'Leitura do sprinkler registrada com sucesso', 
            novo_status: status 
        });
    } catch (erro) {
        return res.status(500).json({ erro: 'Erro interno ao processar dados do sprinkler' });
    }
});

module.exports = router;