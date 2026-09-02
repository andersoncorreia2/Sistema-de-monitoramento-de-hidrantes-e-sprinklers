const db = require('../config/db');

const Usuario = {
    // 1. Busca um militar pelo login (Usado na tela de Entrada)
    buscarPorLogin: async (login) => {
        const query = 'SELECT * FROM usuarios WHERE login = $1';
        const { rows } = await db.query(query, [login]);
        return rows[0]; // Retorna o usuário ou undefined
    },

    // 2. Lista todos os militares (Usado na tabela de Gestão)
    listarTodos: async () => {
        const query = 'SELECT id, login, email, telefone, cargo, posto_grad, matricula FROM usuarios ORDER BY id ASC';
        const { rows } = await db.query(query);
        return rows;
    },

    // 3. Cadastra um novo militar no banco
    cadastrar: async (dados) => {
        const query = `
            INSERT INTO usuarios (login, senha_segura, email, telefone, cargo, posto_grad, matricula) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        const valores = [
            dados.login, String(dados.senha), dados.email, 
            dados.telefone, dados.cargo, dados.posto_grad, dados.matricula
        ];
        await db.query(query, valores);
    },

    // 4. Exclui um militar do banco
    excluir: async (id) => {
        const query = 'DELETE FROM usuarios WHERE id = $1';
        await db.query(query, [id]);
    },

    // 5. Valida credenciais de login
    validarLogin: async (login, senha) => {
        const query = 'SELECT * FROM usuarios WHERE login = $1 AND senha_segura = $2';
        const { rows } = await db.query(query, [login, senha]);
        return rows[0]; // Retorna usuário logado ou undefined
    },

    // 6. Busca email para recuperação de senha
    buscarEmailPorLogin: async (login) => {
        const query = 'SELECT email FROM usuarios WHERE login = $1';
        const { rows } = await db.query(query, [login]);
        return rows[0] ? rows[0].email : null;
    },

    // 7. Salva código MFA e tempo de expiração
    salvarCodigoMFA: async (login, codigo, expiracao) => {
        const query = 'UPDATE usuarios SET codigo_recuperacao = $1, expiracao_codigo = $2 WHERE login = $3';
        await db.query(query, [codigo, expiracao, login]);
    },

    // 8. Valida código MFA antes de trocar senha
    validarCodigoMFA: async (login, codigo) => {
        const query = 'SELECT * FROM usuarios WHERE login = $1 AND codigo_recuperacao = $2 AND expiracao_codigo > NOW()';
        const { rows } = await db.query(query, [login, codigo]);
        return rows[0]; // Retorna os dados se válido, ou undefined se expirado/inválido
    },

    // 9. Atualiza senha nova e limpa campos do MFA
    atualizarSenhaELimparMFA: async (login, novaSenha) => {
        const query = 'UPDATE usuarios SET senha_segura = $1, codigo_recuperacao = NULL, expiracao_codigo = NULL WHERE login = $2';
        await db.query(query, [String(novaSenha), login]);
    }
};

module.exports = Usuario;