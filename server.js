require('dotenv').config(); // Carrega as chaves secretas do arquivo .env
const db = require('./config/db');
const Usuario = require('./models/Usuario');
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

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

        const tokenOficial = jwt.sign(
            { 
                corporacao: 'CBMPE', 
                login: usuarioLogado.login,
                permissao: usuarioLogado.cargo,
                posto: usuarioLogado.posto_grad,
                matricula: usuarioLogado.matricula
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
    const { matricula, codigo_digitado } = req.body;
    
    console.log(`[AppViatura] Tentativa de acesso. Matrícula: ${matricula}, Código: ${codigo_digitado}`);

    if (!matricula || !codigo_digitado) {
        return res.status(400).json({ erro: 'Matrícula e Código do Turno são obrigatórios.' });
    }

    try {
        const query = `
            SELECT regiao_simi, carga_horaria 
            FROM codigos_turno 
            WHERE codigo_acesso = $1 AND data_expiracao > NOW()
        `;
        
        const result = await db.query(query, [codigo_digitado]);

        if (result.rows.length === 0) {
            return res.status(401).json({ 
                erro: 'Acesso negado: Código operacional inválido ou turno encerrado.' 
            });
        }

        const infoTurno = result.rows[0];

        // 🟢 NOVO: Gerando o Token JWT Tático da Guarnição
        const tokenTatico = jwt.sign(
            { 
                corporacao: 'CBMPE', 
                matricula: matricula,
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
            token: tokenTatico // 🟢 NOVO: Enviando o token para o celular
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
// RECUPERAÇÃO DE SENHA (MFA) - ATUALIZADO PARA NUVEM (HTTPS)
// ==========================================
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

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

        // Disparo HTTPS via Resend (Fura o bloqueio do Render)
        const { error } = await resend.emails.send({
            from: 'Sistema Integrado de Monitoramento de Incêndio <onboarding@resend.dev>',
            to: emailDestino, 
            subject: 'SIMI - Código de Recuperação de Acesso',
            html: `<p>Seu código de verificação é: <strong>${codigo}</strong><br>Ele é válido por 15 minutos.<br>Se você não solicitou isso, ignore este e-mail.</p>`
        });

        if (error) {
            console.error('Erro na API da Resend:', error);
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
    const { login, senha, email, telefone, cargo, posto_grad, matricula } = req.body;

    if (!login || !senha || !cargo) {
        return res.status(400).json({ erro: 'Login, senha e cargo são obrigatórios.' });
    }

    try {
        const userExiste = await Usuario.buscarPorLogin(login);
        if (userExiste) {
            return res.status(400).json({ erro: 'Este nome de Guerra/Login já está em uso.' });
        }

        await Usuario.cadastrar(req.body);
        return res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso!' });
    } catch (erro) {
        console.error('Erro ao cadastrar usuário:', erro);
        return res.status(500).json({ erro: 'Erro interno ao salvar o usuário.' });
    }
});

// 2. LISTAR TODOS OS USUÁRIOS
app.get('/listar-usuarios', protegerRota, async (req, res) => {
    try {
        const usuarios = await Usuario.listarTodos();
        return res.status(200).json(usuarios);
    } catch (erro) {
        console.error('Erro ao listar usuários:', erro);
        return res.status(500).json({ erro: 'Falha ao buscar usuários no banco de dados.' });
    }
});

// 3. EDITAR/ATUALIZAR USUÁRIO EXISTENTE
app.put('/editar-usuario/:id', protegerRota, async (req, res) => {
    const { id } = req.params;
    const { login, email, telefone, cargo, posto_grad, matricula, senha } = req.body;

    try {
        // Correção das colunas para os nomes oficiais da nuvem: usuario, funcao, senha_hash
        if (senha && senha.trim() !== '') {
            await db.query(
                'UPDATE usuarios SET usuario=$1, email=$2, telefone=$3, funcao=$4, posto_grad=$5, matricula=$6, senha_hash=$7 WHERE id=$8',
                [login, email, telefone, cargo, posto_grad, matricula, String(senha), id]
            );
        } else {
            await db.query(
                'UPDATE usuarios SET usuario=$1, email=$2, telefone=$3, funcao=$4, posto_grad=$5, matricula=$6 WHERE id=$7',
                [login, email, telefone, cargo, posto_grad, matricula, id]
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
// INICIAR SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});