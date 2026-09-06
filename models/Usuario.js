const db = require('../config/db');

const Usuario = {
    // 1. Busca um militar pelo login
    buscarPorLogin: async (login) => {
        // Correção: login -> usuario
        const query = 'SELECT * FROM usuarios WHERE usuario = $1';
        const { rows } = await db.query(query, [login]);
        return rows[0]; 
    },

    // 2. Lista todos os militares
    listarTodos: async () => {
        // Correção: login -> usuario, cargo -> funcao
        const query = 'SELECT id, usuario as login, email, telefone, funcao as cargo, posto_grad, matricula FROM usuarios ORDER BY id ASC';
        const { rows } = await db.query(query);
        return rows;
    },

    // 3. Cadastra um novo militar
    cadastrar: async (dados) => {
        // Correção: login->usuario, senha_segura->senha_hash, cargo->funcao
        const query = `
            INSERT INTO usuarios (usuario, senha_hash, email, telefone, funcao, posto_grad, matricula) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        const valores = [
            dados.login, String(dados.senha), dados.email, 
            dados.telefone, dados.cargo, dados.posto_grad, dados.matricula
        ];
        await db.query(query, valores);
    },

    // 4. Exclui um militar do banco (Este estava correto)
    excluir: async (id) => {
        const query = 'DELETE FROM usuarios WHERE id = $1';
        await db.query(query, [id]);
    },

    // 5. Valida credenciais de login
    validarLogin: async (login, senha) => {
        // Correção: login->usuario, senha_segura->senha_hash
        const query = 'SELECT * FROM usuarios WHERE usuario = $1 AND senha_hash = $2';
        const { rows } = await db.query(query, [login, senha]);
        // Retornamos mapeando os nomes para não quebrar o server.js
        if (rows[0]) {
            return {
                ...rows[0],
                login: rows[0].usuario,
                cargo: rows[0].funcao
            };
        }
        return undefined;
    },

    // 6. Busca email para recuperação de senha
    buscarEmailPorLogin: async (login) => {
        // Correção: login -> usuario
        const query = 'SELECT email FROM usuarios WHERE usuario = $1';
        const { rows } = await db.query(query, [login]);
        return rows[0] ? rows[0].email : null;
    },

    // 7. Salva código MFA e tempo de expiração
    salvarCodigoMFA: async (login, codigo, expiracao) => {
        // Correção: login -> usuario
        const query = 'UPDATE usuarios SET codigo_recuperacao = $1, expiracao_codigo = $2 WHERE usuario = $3';
        await db.query(query, [codigo, expiracao, login]);
    },

    // 8. Valida código MFA antes de trocar senha
    validarCodigoMFA: async (login, codigo) => {
        // Correção: login -> usuario
        const query = 'SELECT * FROM usuarios WHERE usuario = $1 AND codigo_recuperacao = $2 AND expiracao_codigo > NOW()';
        const { rows } = await db.query(query, [login, codigo]);
        return rows[0]; 
    },

    // 9. Atualiza senha nova e limpa campos do MFA
    atualizarSenhaELimparMFA: async (login, novaSenha) => {
        // Correção: senha_segura->senha_hash, login->usuario
        const query = 'UPDATE usuarios SET senha_hash = $1, codigo_recuperacao = NULL, expiracao_codigo = NULL WHERE usuario = $2';
        await db.query(query, [String(novaSenha), login]);
    }
};

module.exports = Usuario;