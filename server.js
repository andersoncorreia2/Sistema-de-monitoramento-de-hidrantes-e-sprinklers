require('dotenv').config(); // Carrega as chaves secretas do arquivo .env
const db = require('./config/db');
const express = require('express');
const cors = require('cors');

// Importando os seus Controllers
const telemetriaController = require('./controllers/telemetriaController');
const equipamentosController = require('./controllers/equipamentosController');
const notificacaoController = require('./controllers/notificacaoController');

const app = express();

// Middlewares Globais
app.use(cors()); // Essencial: Permite que o painel (porta 5500) acesse esta API (porta 3000)
app.use(express.json()); // Permite que a API entenda requisições no formato JSON
app.use(express.urlencoded({ extended: true }));
const jwt = require('jsonwebtoken');
const CHAVE_SECRETA = 'cbmpe_chave_super_secreta_preve_2026';

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

// Rota de Login Autenticada via PostgreSQL
app.post('/login', async (req, res) => {
    // 1. Proteção extra contra dados vazios ou formatos não reconhecidos
    const body = req.body || {};
    console.log('🔍 Dados recebidos do painel:', body);

    const usuarioDigitado = body.usuario || body.username || body.login || body.user;
    let senhaDigitada = body.senha || body.password || body.pass;

    // 2. Se as variáveis não vierem, bloqueamos sem travar o servidor
    if (!usuarioDigitado || !senhaDigitada) {
        console.log('❌ Falha: O Frontend não enviou as chaves corretas. Variáveis que chegaram:', Object.keys(body));
        return res.status(400).json({ erro: 'Usuário e senha são obrigatórios.' });
    }

    senhaDigitada = String(senhaDigitada);

    try {
        const resultado = await db.query(
            'SELECT * FROM usuarios WHERE login = $1 AND senha_segura = $2',
            [usuarioDigitado, senhaDigitada]
        );

        if (resultado.rows.length === 0) {
            console.log(`❌ Login falhou para: ${usuarioDigitado}`);
            return res.status(401).json({ erro: 'Acesso negado: Credenciais inválidas.' });
        }

        const usuarioLogado = resultado.rows[0];
        console.log(`✅ Login Aprovado para: ${usuarioLogado.login}`);

        const tokenOficial = jwt.sign(
            { 
                corporacao: 'CBMPE', 
                login: usuarioLogado.login,
                permissao: usuarioLogado.cargo,
                posto: usuarioLogado.posto_grad,   // Puxa o posto
                matricula: usuarioLogado.matricula // Puxa a matrícula
            }, 
            CHAVE_SECRETA, 
            { expiresIn: '8h' }
        );
        
        return res.status(200).json({ token: tokenOficial });

    } catch (erro) {
        console.error('⚠️ Erro interno na consulta:', erro);
        return res.status(500).json({ erro: 'Erro interno ao validar login.' });
    }
});

// Rota para Gerar e Enviar Código de Recuperação (6 dígitos)
const nodemailer = require('nodemailer');

app.post('/recuperar-senha', async (req, res) => {
    const { usuario } = req.body;

    try {
        // 1. Busca o e-mail do usuário no banco
        const resultado = await db.query('SELECT email FROM usuarios WHERE login = $1', [usuario]);
        
        if (resultado.rows.length === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado.' });
        }

        const emailDestino = resultado.rows[0].email;

        // 2. Gera o código de 6 dígitos e o tempo de expiração (15 minutos)
        const codigo = Math.floor(100000 + Math.random() * 900000).toString();
        const expiracao = new Date(Date.now() + 15 * 60000); 

        // 3. Salva o código no banco de dados
        await db.query(
            'UPDATE usuarios SET codigo_recuperacao = $1, expiracao_codigo = $2 WHERE login = $3',
            [codigo, expiracao, usuario]
        );

        // 4. Dispara o e-mail (usando as mesmas credenciais que você já tem no .env)
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_REMETENTE, pass: process.env.EMAIL_SENHA },
            tls: { rejectUnauthorized: false }
        });

        await transporter.sendMail({
            from: process.env.EMAIL_REMETENTE,
            to: emailDestino,
            subject: 'CBMPE - Código de Recuperação de Acesso',
            text: `Seu código de verificação é: ${codigo}\nEle é válido por 15 minutos.\nSe você não solicitou isso, ignore este e-mail.`
        });

        return res.status(200).json({ mensagem: 'Código enviado com sucesso!' });

    } catch (erro) {
        console.error('Erro ao recuperar senha:', erro);
        return res.status(500).json({ erro: 'Falha ao processar recuperação.' });
    }
});

// Rota para Validar o Código de 6 Dígitos e Trocar a Senha
app.post('/trocar-senha-codigo', async (req, res) => {
    const { usuario, codigo, novaSenha } = req.body;

    if (!usuario || !codigo || !novaSenha) {
        return res.status(400).json({ erro: 'Dados incompletos para troca de senha.' });
    }

    try {
        // 1. Verifica se o código bate com o usuário e se a expiração ainda é maior que o momento atual (NOW)
        const resultado = await db.query(
            'SELECT * FROM usuarios WHERE login = $1 AND codigo_recuperacao = $2 AND expiracao_codigo > NOW()',
            [usuario, codigo]
        );

        if (resultado.rows.length === 0) {
            return res.status(400).json({ erro: 'Código inválido ou expirado. Solicite um novo.' });
        }

        // 2. Se o código for válido, atualiza a senha e "limpa" a gaveta do código por segurança
        await db.query(
            'UPDATE usuarios SET senha_segura = $1, codigo_recuperacao = NULL, expiracao_codigo = NULL WHERE login = $2',
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
// ROTAS DE GESTÃO DE USUÁRIOS (CRUD Completo)
// ==========================================

// 1. CADASTRAR NOVO USUÁRIO
app.post('/cadastrar-usuario', async (req, res) => {
    const { login, senha, email, telefone, cargo, posto_grad, matricula } = req.body;

    if (!login || !senha || !cargo) {
        return res.status(400).json({ erro: 'Login, senha e cargo são obrigatórios.' });
    }

    try {
        const userExiste = await db.query('SELECT * FROM usuarios WHERE login = $1', [login]);
        if (userExiste.rows.length > 0) {
            return res.status(400).json({ erro: 'Este nome de Guerra/Login já está em uso.' });
        }

        await db.query(
            'INSERT INTO usuarios (login, senha_segura, email, telefone, cargo, posto_grad, matricula) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [login, String(senha), email, telefone, cargo, posto_grad, matricula]
        );

        return res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso!' });
    } catch (erro) {
        console.error('Erro ao cadastrar usuário:', erro);
        return res.status(500).json({ erro: 'Erro interno ao salvar o usuário no banco de dados.' });
    }
});

// 2. LISTAR TODOS OS USUÁRIOS (Para preencher a tabela no Frontend)
app.get('/listar-usuarios', async (req, res) => {
    try {
        // Trazemos tudo, EXCETO a senha e os códigos, por questões óbvias de segurança
        const resultado = await db.query('SELECT id, login, email, telefone, cargo, posto_grad, matricula FROM usuarios ORDER BY id ASC');
        return res.status(200).json(resultado.rows);
    } catch (erro) {
        console.error('Erro ao listar usuários:', erro);
        return res.status(500).json({ erro: 'Falha ao buscar usuários no banco de dados.' });
    }
});

// 3. EDITAR/ATUALIZAR USUÁRIO EXISTENTE
app.put('/editar-usuario/:id', async (req, res) => {
    const { id } = req.params;
    const { login, email, telefone, cargo, posto_grad, matricula, senha } = req.body;

    try {
        // Se a senha foi preenchida, atualizamos ela também. Se não, mantemos a antiga.
        if (senha && senha.trim() !== '') {
            await db.query(
                'UPDATE usuarios SET login=$1, email=$2, telefone=$3, cargo=$4, posto_grad=$5, matricula=$6, senha_segura=$7 WHERE id=$8',
                [login, email, telefone, cargo, posto_grad, matricula, String(senha), id]
            );
        } else {
            await db.query(
                'UPDATE usuarios SET login=$1, email=$2, telefone=$3, cargo=$4, posto_grad=$5, matricula=$6 WHERE id=$7',
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
app.delete('/excluir-usuario/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await db.query('DELETE FROM usuarios WHERE id = $1', [id]);
        return res.status(200).json({ mensagem: 'Usuário excluído permanentemente.' });
    } catch (erro) {
        console.error('Erro ao excluir usuário:', erro);
        return res.status(500).json({ erro: 'Falha ao excluir o usuário do banco.' });
    }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚒 Servidor do CBMPE rodando com sucesso na porta ${PORT}`);
});