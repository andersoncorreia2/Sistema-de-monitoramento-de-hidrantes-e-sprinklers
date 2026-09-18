require('dotenv').config(); // Carrega as chaves secretas do arquivo .env
const db = require('./config/db');
const Usuario = require('./models/Usuario');
const express = require('express');
const cors = require('cors');

// 👉 ADICIONE ESTA LINHA PARA FORÇAR O IPv4
require('dns').setDefaultResultOrder('ipv4first');

// Importando os seus Controllers
const telemetriaController = require('./controllers/telemetriaController');
const equipamentosController = require('./controllers/equipamentosController');
const notificacaoController = require('./controllers/notificacaoController');

const app = express();

// Middlewares Globais
app.use(cors()); // Essencial: Permite que o painel (porta 5500) acesse esta API (porta 3000)
app.use(express.json()); // Permite que a API entenda requisições no formato JSON
app.use(express.urlencoded({ extended: true }));
// Servindo a interface gráfica estática da pasta views
app.use(express.static('views'));
const jwt = require('jsonwebtoken');
const CHAVE_SECRETA = process.env.CHAVE_SECRETA;
// Middleware de Cibersegurança
function protegerRota(req, res, next) {
    // Busca o token no cabeçalho da requisição enviada pelo painel ou sensor
    const token = req.headers['authorization'];
    
    if (!token) {
        return res.status(401).json({ erro: 'Acesso negado. Token de segurança não fornecido.' });
    }

    try {
        // O padrão é enviar "Bearer <token>", então separamos para pegar só o código
        const tokenLimpo = token.split(' ')[1];
        
        // Verifica se o token é válido e foi gerado pela sua API
        const decodificado = jwt.verify(tokenLimpo, CHAVE_SECRETA);
        req.usuario = decodificado; // Salva quem está acessando
        
        next(); // Tudo certo! Permite que a rota seja executada
    } catch (erro) {
        return res.status(403).json({ erro: 'Alerta de Segurança: Token inválido ou expirado.' });
    }
}

// Rota de Login Autenticada via PostgreSQL (Usando Model)
app.post('/login', async (req, res) => {
    const body = req.body || {};
    const usuarioDigitado = body.usuario || body.username || body.login || body.user;
    let senhaDigitada = body.senha || body.password || body.pass;

    if (!usuarioDigitado || !senhaDigitada) {
        return res.status(400).json({ erro: 'Usuário e senha são obrigatórios.' });
    }

    try {
        // Chamada limpa para o Model
        const usuarioLogado = await Usuario.validarLogin(usuarioDigitado, String(senhaDigitada));

        if (!usuarioLogado) {
            return res.status(401).json({ erro: 'Acesso negado: Credenciais inválidas.' });
        }

        const cargoDoMilitar = String(usuarioLogado.cargo || usuarioLogado.funcao || '');

        // 🟢 TRAVA DE LICENÇA (KILL SWITCH)
        // Se NÃO for o Gestor Master, verifica se o estado está com a licença ativa
        if (cargoDoMilitar !== 'Master') {
            try {
                // Tenta buscar o status na tabela licenca_sistema
                const licenca = await db.query('SELECT status_ativa FROM licenca_sistema LIMIT 1');
                
                // Se a tabela existe e a licença for falsa, bloqueia o acesso
                if (licenca.rows.length > 0 && licenca.rows[0].status_ativa === false) {
                    return res.status(403).json({ erro: 'Acesso suspenso. A licença do sistema expirou ou está inativa. Contate o suporte.' });
                }
            } catch (e) {
                console.error('Tabela de licença não configurada no banco.');
            }
        }

        // AQUI ESTÁ A BLINDAGEM: Trava o Chefe de Guarnição fora do Painel Web
        if (cargoDoMilitar.includes('Chefe')) {
            return res.status(403).json({ erro: 'Acesso restrito à Rua. Utilize o AppViatura no celular/tablet para assumir o serviço.' });
        }

        const tokenOficial = jwt.sign(
            { 
                corporacao: 'SIMI', 
                login: usuarioLogado.login,
                permissao: cargoDoMilitar,
                posto: usuarioLogado.posto_grad,
                matricula: usuarioLogado.matricula,
                regiao: usuarioLogado.regiao // <-- O SEGREDO DO ISOLAMENTO REGIONAL É AQUI
            }, 
            CHAVE_SECRETA, 
            { expiresIn: '8h' }
        );
        
        return res.status(200).json({ token: tokenOficial });

    } catch (erro) {
        console.error('⚠️ Erro interno no login:', erro);
        return res.status(500).json({ erro: 'Erro interno ao validar login.' });
    }
});

// ==========================================
// ROTA: Validação de Código de Turno (AppViatura)
// ==========================================
app.post('/validar-turno', async (req, res) => {
    const matricula = (req.body.matricula || '').trim();
    const codigo_digitado = (req.body.codigo_digitado || '').trim();
    
    console.log(`[AppViatura] Tentativa de acesso. Matrícula: ${matricula}, Código: ${codigo_digitado}`);

    if (!matricula || !codigo_digitado) {
        return res.status(400).json({ erro: 'Matrícula e Código do Turno são obrigatórios.' });
    }

    try {
        // 1. Valida se o código de turno existe e ainda não expirou
        const queryCodigo = `
            SELECT regiao_simi, carga_horaria 
            FROM codigos_turno 
            WHERE codigo_acesso = $1 AND data_expiracao > NOW()
        `;
        const resultCodigo = await db.query(queryCodigo, [codigo_digitado]);

        if (resultCodigo.rows.length === 0) {
            return res.status(401).json({ 
                erro: 'Acesso negado: Código operacional inválido ou turno encerrado.' 
            });
        }

        const infoTurno = resultCodigo.rows[0];

        // 🟢 NOVO: Valida se a matrícula pertence a um militar cadastrado como Chefe de Guarnição
        // Compara só os dígitos (ignora hífen, espaço, ponto etc.), pra o militar não
        // precisar acertar a formatação exata no teclado do celular.
        // ORDER BY prioriza uma linha com funcao = 'Chefe de Guarnicao' caso a matrícula
        // esteja duplicada entre dois cadastros (defensivo; o certo é matrícula ser única).
        const queryMilitar = `
            SELECT usuario, funcao, regiao, posto_grad 
            FROM usuarios 
            WHERE regexp_replace(matricula, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
              AND matricula IS NOT NULL AND matricula != ''
            ORDER BY (funcao = 'Chefe de Guarnicao') DESC
            LIMIT 1
        `;
        const resultMilitar = await db.query(queryMilitar, [matricula]);

        if (resultMilitar.rows.length === 0) {
            return res.status(401).json({
                erro: 'Acesso negado: Matrícula não cadastrada no sistema.'
            });
        }

        const militar = resultMilitar.rows[0];

        // 🟢 Correção Tática: Flexibiliza a leitura do cargo, ignorando os acentos
        const cargoDoMilitar = String(militar.funcao || '').replace(/[çÇ]/g, 'c').replace(/[ãÃ]/g, 'a');

        if (cargoDoMilitar !== 'Chefe de Guarnicao') {
            return res.status(403).json({
                erro: 'Acesso negado: Esta matrícula não possui permissão de Chefe de Guarnição para o AppViatura.'
            });
        }

        // 🟢 NOVO: Valida se a região do militar é a mesma do código de turno informado
        if (militar.regiao !== infoTurno.regiao_simi) {
            return res.status(403).json({
                erro: `Acesso negado: Este código pertence à região ${infoTurno.regiao_simi}, mas sua matrícula está cadastrada na região ${militar.regiao || 'não definida'}.`
            });
        }

        // Gerando o Token JWT Tático da Guarnição
        const tokenTatico = jwt.sign(
            { 
                corporacao: 'SIMI', 
                matricula: matricula,
                nomeGuerra: militar.usuario,
                posto: militar.posto_grad,
                permissao: 'Tatico',
                regiao: infoTurno.regiao_simi
            }, 
            CHAVE_SECRETA, 
            { expiresIn: `${infoTurno.carga_horaria}h` } // Expira junto com o turno
        );

        return res.status(200).json({
            sucesso: true,
            mensagem: 'Guarnição autenticada. Serviço assumido.',
            regiao_alocada: infoTurno.regiao_simi,
            token: tokenTatico // Enviando o token para o celular
        });

    } catch (erro) {
        console.error('⚠️ Erro na validação do turno:', erro);
        return res.status(500).json({ erro: 'Erro interno ao validar o código operacional.' });
    }
});

// ==========================================
// ROTA: Gerar Código de Turno (Painel Central SIMI)
// ==========================================
app.post('/gerar-codigo-turno', protegerRota, async (req, res) => {
    const { regiao_simi, carga_horaria } = req.body;

    if (!regiao_simi || !carga_horaria) {
        return res.status(400).json({ erro: 'Região e carga horária são obrigatórias.' });
    }

    try {
        const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let sufixo = '';
        for (let i = 0; i < 4; i++) {
            sufixo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
        }
        
        const prefixo = regiao_simi.substring(0, 4).toUpperCase();
        const codigo_gerado = `${prefixo}-${sufixo}`;

        const query = `
            INSERT INTO codigos_turno (codigo_acesso, regiao_simi, carga_horaria, data_expiracao)
            VALUES ($1, $2, $3, NOW() + INTERVAL '${carga_horaria} hours')
            RETURNING *;
        `;
        
        const result = await db.query(query, [codigo_gerado, regiao_simi, carga_horaria]);

        return res.status(201).json({
            sucesso: true,
            mensagem: 'Código operacional gerado com sucesso!',
            codigo_acesso: result.rows[0].codigo_acesso,
            validade: result.rows[0].data_expiracao
        });

    } catch (erro) {
        console.error('⚠️ Erro ao gerar código de turno:', erro);
        return res.status(500).json({ erro: 'Erro interno ao gerar a chave operacional.' });
    }
});

// ==========================================
// RECUPERAÇÃO DE SENHA (MFA) - VIA BREVO (HTTPS API)
// ==========================================
// 🟢 Envia via API HTTPS do Brevo (não usa SMTP, então não é bloqueado pelo
// Render). Requer no .env: BREVO_API_KEY e BREVO_SENDER_EMAIL (o e-mail
// verificado como remetente no painel do Brevo).
async function enviarEmailBrevo({ to, subject, html }) {
    const resposta = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'api-key': process.env.BREVO_API_KEY
        },
        body: JSON.stringify({
            sender: { name: 'Sistema Integrado de Monitoramento de Incêndio', email: process.env.BREVO_SENDER_EMAIL },
            to: [{ email: to }],
            subject,
            htmlContent: html
        })
    });

    if (!resposta.ok) {
        const corpoErro = await resposta.text();
        throw new Error(`Brevo recusou o envio (status ${resposta.status}): ${corpoErro}`);
    }
}

app.post('/recuperar-senha', async (req, res) => {
    const { usuario } = req.body;

    try {
        const resultado = await db.query('SELECT email FROM usuarios WHERE usuario = $1', [usuario]);
        
        if (resultado.rows.length === 0 || !resultado.rows[0].email) {
            return res.status(404).json({ erro: 'Usuário não encontrado ou sem e-mail cadastrado.' });
        }

        const emailDestino = resultado.rows[0].email;
        const codigo = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Grava o código no banco com expiração de 15 minutos
        await db.query(
            `UPDATE usuarios SET codigo_recuperacao = $1, expiracao_codigo = NOW() + INTERVAL '15 minutes' WHERE usuario = $2`,
            [codigo, usuario]
        );

        // Disparo via Brevo (HTTPS, chega em qualquer destinatário)
        try {
            await enviarEmailBrevo({
                to: emailDestino,
                subject: 'SIMI - Código de Recuperação de Acesso',
                html: `<p>Seu código de verificação é: <strong>${codigo}</strong><br>Ele é válido por 15 minutos.<br>Se você não solicitou isso, ignore este e-mail.</p>`
            });
        } catch (erroEnvio) {
            console.error('Erro no envio via Brevo:', erroEnvio);
            return res.status(500).json({ erro: 'A API de e-mail recusou o envio.' });
        }

        return res.status(200).json({ mensagem: 'Código enviado com sucesso!' });

    } catch (erro) {
        console.error('Erro ao recuperar senha:', erro);
        return res.status(500).json({ erro: 'Falha ao processar recuperação no banco de dados.' });
    }
});

app.post('/trocar-senha-codigo', async (req, res) => {
    const { usuario, codigo, novaSenha } = req.body;

    if (!usuario || !codigo || !novaSenha) {
        return res.status(400).json({ erro: 'Dados incompletos para troca de senha.' });
    }

    try {
        // Valida código e expiração
        const resultado = await db.query(
            'SELECT * FROM usuarios WHERE usuario = $1 AND codigo_recuperacao = $2 AND expiracao_codigo > NOW()',
            [usuario, codigo]
        );

        if (resultado.rows.length === 0) {
            return res.status(400).json({ erro: 'Código inválido ou expirado. Solicite um novo.' });
        }

        // Atualiza a coluna real da nuvem ('senha_hash') e limpa o MFA
        await db.query(
            'UPDATE usuarios SET senha_hash = $1, codigo_recuperacao = NULL, expiracao_codigo = NULL WHERE usuario = $2',
            [String(novaSenha), usuario]
        );

        return res.status(200).json({ mensagem: 'Senha alterada com sucesso! Você já pode entrar.' });

    } catch (erro) {
        console.error('Erro ao trocar senha:', erro);
        return res.status(500).json({ erro: 'Falha interna ao validar o código.' });
    }
});

// Rotas da API (Conectando os controllers)
// Essas rotas estão blindadas! Só acessa quem tiver um JWT válido.
app.use('/telemetria', protegerRota, telemetriaController);
app.use('/equipamentos', protegerRota, equipamentosController);
app.use('/notificar', protegerRota, notificacaoController);

// ==========================================
// ROTAS DE GESTÃO DE USUÁRIOS (CRUD Completo PROTEGIDO)
// ==========================================

// 1. CADASTRAR NOVO USUÁRIO
app.post('/cadastrar-usuario', protegerRota, async (req, res) => {
    // 🟢 Extraindo a 'regiao' do frontend
    const { login, senha, email, telefone, cargo, posto_grad, matricula, regiao } = req.body;

    if (!login || !senha || !cargo) {
        return res.status(400).json({ erro: 'Login, senha e cargo são obrigatórios.' });
    }

    try {
        const userExiste = await db.query('SELECT id FROM usuarios WHERE usuario = $1', [login]);
        if (userExiste.rows.length > 0) {
            return res.status(400).json({ erro: 'Este nome de Guerra/Login já está em uso.' });
        }

        // Impede duas matrículas iguais (evita duplicidade em logins do AppViatura)
        if (matricula && matricula.trim() !== '') {
            const matriculaExiste = await db.query(
                `SELECT id FROM usuarios WHERE regexp_replace(matricula, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g') AND matricula IS NOT NULL AND matricula != ''`,
                [matricula.trim()]
            );
            if (matriculaExiste.rows.length > 0) {
                return res.status(400).json({ erro: 'Esta matrícula já está cadastrada para outro militar.' });
            }
        }

        // 🟢 GRAVAÇÃO DIRETA: Forçando a coluna 'regiao' no banco de dados
        await db.query(
            'INSERT INTO usuarios (usuario, senha_hash, email, telefone, funcao, posto_grad, matricula, regiao) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [login, String(senha), email, telefone, cargo, posto_grad, matricula, regiao]
        );

        return res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso!' });
    } catch (erro) {
        console.error('Erro ao cadastrar usuário:', erro);
        return res.status(500).json({ erro: 'Erro interno ao salvar o usuário.' });
    }
});

// 2. LISTAR TODOS OS USUÁRIOS
app.get('/listar-usuarios', protegerRota, async (req, res) => {
    try {
        // 🟢 BUSCA DIRETA: Puxando a 'regiao' e formatando os nomes para o frontend entender perfeitamente
        const resultado = await db.query(
            'SELECT id, usuario AS login, email, telefone, funcao AS cargo, posto_grad, matricula, regiao FROM usuarios ORDER BY id ASC'
        );
        return res.status(200).json(resultado.rows);
    } catch (erro) {
        console.error('Erro ao listar usuários:', erro);
        return res.status(500).json({ erro: 'Falha ao buscar usuários no banco de dados.' });
    }
});

// 3. EDITAR/ATUALIZAR USUÁRIO EXISTENTE
app.put('/editar-usuario/:id', protegerRota, async (req, res) => {
    const { id } = req.params;
    // 🟢 Capturando a regiao no momento da edição
    const { login, email, telefone, cargo, posto_grad, matricula, regiao, senha } = req.body;

    try {
        if (matricula && matricula.trim() !== '') {
            const matriculaExiste = await db.query(
                `SELECT id FROM usuarios WHERE regexp_replace(matricula, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g') AND matricula IS NOT NULL AND matricula != '' AND id != $2`,
                [matricula.trim(), id]
            );
            if (matriculaExiste.rows.length > 0) {
                return res.status(400).json({ erro: 'Esta matrícula já está cadastrada para outro militar.' });
            }
        }

        // 🟢 Salvando a 'regiao' atualizada
        if (senha && senha.trim() !== '') {
            await db.query(
                'UPDATE usuarios SET usuario=$1, email=$2, telefone=$3, funcao=$4, posto_grad=$5, matricula=$6, regiao=$7, senha_hash=$8 WHERE id=$9',
                [login, email, telefone, cargo, posto_grad, matricula, regiao, String(senha), id]
            );
        } else {
            await db.query(
                'UPDATE usuarios SET usuario=$1, email=$2, telefone=$3, funcao=$4, posto_grad=$5, matricula=$6, regiao=$7 WHERE id=$8',
                [login, email, telefone, cargo, posto_grad, matricula, regiao, id]
            );
        }
        return res.status(200).json({ mensagem: 'Usuário atualizado com sucesso!' });
    } catch (erro) {
        console.error('Erro ao atualizar usuário:', erro);
        return res.status(500).json({ erro: 'Falha interna ao atualizar dados do usuário.' });
    }
});

// 4. EXCLUIR USUÁRIO
app.delete('/excluir-usuario/:id', protegerRota, async (req, res) => {
    const { id } = req.params;

    try {
        await Usuario.excluir(id);
        return res.status(200).json({ mensagem: 'Usuário excluído permanentemente.' });
    } catch (erro) {
        console.error('Erro ao excluir usuário:', erro);
        return res.status(500).json({ erro: 'Falha ao excluir o usuário do banco.' });
    }
});

// ==========================================
// ROTA DO GESTOR MASTER: Ativar/Suspender Licença do Estado
// ==========================================
app.post('/licenca/alterar-status', protegerRota, async (req, res) => {
    if (req.usuario.permissao !== 'Master') {
        return res.status(403).json({ erro: 'Acesso negado. Comando exclusivo do Gestor Master do Sistema.' });
    }
    
    const { status_ativa } = req.body;
    try {
        await db.query('UPDATE licenca_sistema SET status_ativa = $1', [status_ativa]);
        return res.status(200).json({ 
            mensagem: status_ativa ? '✅ Sistema reativado. Acessos liberados.' : '⛔ Sistema SUSPENSO. Acesso militar bloqueado.' 
        });
    } catch (erro) {
        return res.status(500).json({ erro: 'Falha ao alterar o status da licença no banco de dados.' });
    }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});