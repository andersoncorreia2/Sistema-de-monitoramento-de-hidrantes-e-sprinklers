const db = require('./config/db'); // Usa a sua conexão do PostgreSQL

async function simularSensoresIoT() {
    console.log("🤖 Simulador IoT Iniciado! Pressione Ctrl+C para parar.");

    // O robô vai acordar a cada 5 segundos para enviar dados
    setInterval(async () => {
        try {
            const res = await db.query('SELECT id, tipo FROM equipamentos');
            const equipamentos = res.rows;

            if (equipamentos.length === 0) return;

            // Sorteia 1 equipamento aleatório para receber a leitura do sensor
            const eq = equipamentos[Math.floor(Math.random() * equipamentos.length)];
            let query = '';
            let valores = [];

            if (eq.tipo === 'Hidrante') {
                // Simula variação de pressão (entre 3.0 e 7.0 bar) e vazão
                const pressao = (Math.random() * 4 + 3).toFixed(1); 
                const vazao = Math.floor(Math.random() * 500 + 400);
                const agua = Math.random() < 0.1 ? 'BAIXA' : 'OK'; // 10% de chance de problema na água
                
                query = 'UPDATE equipamentos SET pressao_bar = $1, vazao_lpm = $2, agua = $3, ultima_leitura = NOW() WHERE id = $4';
                valores = [pressao, vazao, agua, eq.id];
            } else {
                // Simula sistema de Sprinklers
                const pressao = (Math.random() * 1.5 + 0.5).toFixed(1); // 0.5 a 2.0 bar
                const integridade = Math.random() < 0.1 ? 'obstruído' : 'bom'; 
                
                query = 'UPDATE equipamentos SET pressao_bar = $1, integridade = $2, ultima_leitura = NOW() WHERE id = $3';
                valores = [pressao, integridade, eq.id];
            }

            await db.query(query, valores);
            console.log(`📡 [Sensor IoT] Dados atualizados no DB para: ${eq.id} | Pressão: ${valores[0]} bar`);

        } catch (erro) {
            console.error("⚠️ Erro no simulador IoT:", erro);
        }
    }, 5000);
}

simularSensoresIoT();