-- ====================================================================================
-- SISTEMA DE MONITORAMENTO DE HIDRANTES E SPRINKLERS - CBMPE
-- SCRIPT DE INAUGURAÇÃO DE SISTEMA (EXECUTAR APENAS NA IMPLANTAÇÃO)
-- ====================================================================================

-- 1. Inserção do "Master Admin" (Comandante Geral)
-- OBS: A TI deve fornecer a senha 'cbmpe@2026' em envelope de segurança para o Oficial.

INSERT INTO usuarios (login, senha_segura, email, telefone, cargo, posto_grad, matricula) 
VALUES (
    'comando_geral', 
    'cbmpe@2026', 
    'comando.geral@cbm.pe.gov.br', 
    '81900000000', 
    'Comando', 
    'Cel', 
    '000001-1'
);

-- FIM DO SCRIPT