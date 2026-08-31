const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Conexão com o PostgreSQL

// Rota para o Frontend buscar todos os equipamentos e plotar no mapa
router.get('/listar', async (req, res) => {
    try {
        // 1. Busca os dados reais no PostgreSQL
        const resultado = await db.query('SELECT * FROM equipamentos ORDER BY id ASC');
        //const equipamentosDoBanco = resultado.rows;
        
        // 2. Formatação fiel ao seu data.json para NÃO QUEBRAR o frontend
        //const equipamentosFormatados = equipamentosDoBanco.map(eq => {
        const equipamentosFormatados = resultado.rows.map(eq => {
            return {
                id: eq.id,
                tipo: eq.tipo,
                status: eq.status, 
                locName: eq.local_nome, 
                coords: [Number(eq.lat), Number(eq.lng)],
                ultima: eq.ultima_leitura, // Puxa o horário real que o sensor enviou
                
                // Agora puxamos direto das colunas novas criadas no Passo 1!
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