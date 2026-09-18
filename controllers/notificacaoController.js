const express = require('express');

require('dns').setDefaultResultOrder('ipv4first'); 

const router = express.Router();

// 🟢 Envia via API HTTPS do Brevo (mesma conta usada na recuperação de senha).
// Requer no .env: BREVO_API_KEY e BREVO_SENDER_EMAIL.
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

router.post('/enviar-alerta', async (req, res) => {
    const { id_equipamento, tipo, local, falhas, responsavel } = req.body;

    // Trava de segurança: Garante que o responsável possui e-mail cadastrado
    if (!responsavel || !responsavel.email) {
        return res.status(400).json({ erro: 'O responsável por este equipamento não possui e-mail cadastrado.' });
    }

    const mensagemTexto = `⚠️ ALERTA URGENTE - PREVENÇÃO ⚠️\nFoi detectada uma falha crítica no ${tipo} (${id_equipamento}) localizado em: ${local}.\n\nProblemas identificados: ${falhas}\n\nSolicitamos a manutenção imediata para garantir a operacionalidade do sistema.`;

    try {
        // Disparo de e-mail isolado via Brevo
        try {
            await enviarEmailBrevo({
                to: responsavel.email,
                subject: `URGENTE: Manutenção Requerida - ${tipo} ${id_equipamento}`,
                html: `<p>${mensagemTexto.replace(/\n/g, '<br>')}</p>`
            });
        } catch (erroEnvio) {
            console.error('Erro no envio via Brevo:', erroEnvio);
            return res.status(500).json({ erro: 'A API recusou o envio do e-mail.' });
        }

        return res.status(200).json({ mensagem: 'Notificação processada e enviada por e-mail com sucesso!' });
    } catch (erro) {
        console.error('Erro geral no sistema de mensageria:', erro);
        return res.status(500).json({ erro: 'Falha ao processar notificações via HTTPS.' });
    }
});

module.exports = router;