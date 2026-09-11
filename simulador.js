const db = require('./config/db'); // Usa a conexão do PostgreSQL com Supabase

async function simularSensoresIoT() {
    console.log("🤖 Simulador IoT Iniciado! Pressione Ctrl+C para parar.");

    // O robô vai acordar a cada 5 segundos para enviar dados
    setInterval(async () => {
        try {
            // CORREÇÃO 1: A coluna agora chama "id_equipamento"
            const res = await db.query('SELECT id_equipamento, tipo FROM equipamentos');
            const equipamentos = res.rows;

            if (equipamentos.length === 0) return;

            // Sorteia 1 equipamento aleatório para receber a leitura
            const eq = equipamentos[Math.floor(Math.random() * equipamentos.length)];
            let query = '';
            let valores = [];

            // CORREÇÃO 2: Inserir nas novas tabelas relacionais de telemetria da nuvem
            if (eq.tipo === 'Hidrante') {
                const pressao = (Math.random() * 4 + 3).toFixed(1); 
                const vazao = Math.floor(Math.random() * 500 + 400);
                const agua = Math.random() < 0.1 ? 'BAIXA' : 'OK'; 
                
                query = 'INSERT INTO leituras_hidrante (id_equipamento, pressao_bar, vazao_lpm, nivel_agua) VALUES ($1, $2, $3, $4)';
                valores = [eq.id_equipamento, pressao, vazao, agua];
            } else {
                const pressao = (Math.random() * 1.5 + 0.5).toFixed(1); 
                // Traduzindo o status de texto para os booleanos (True/False) da nuvem
                const obstruido = Math.random() < 0.1 ? true : false; 
                const quebrado = Math.random() < 0.05 ? true : false;
                
                query = 'INSERT INTO leituras_sprinkler (id_equipamento, pressao_bar, status_obstrucao, status_quebrado) VALUES ($1, $2, $3, $4)';
                valores = [eq.id_equipamento, pressao, obstruido, quebrado];
            }

            await db.query(query, valores);
            console.log(`📡 [Sensor IoT] Telemetria injetada na nuvem para: ${eq.id_equipamento} | Pressão: ${valores[1]} bar`);

        } catch (erro) {
            console.error("⚠️ Erro no simulador IoT:", erro);
        }
    }, 5000);
}

simularSensoresIoT();