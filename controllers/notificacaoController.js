const express = require('express');
const { Resend } = require('resend'); // 👈 MUDANÇA 1: Importamos a API HTTPS no lugar do nodemailer
const twilio = require('twilio'); 

// 👉 MANTIDO: A sua trava de rede original
require('dns').setDefaultResultOrder('ipv4first'); 

const router = express.Router();

// 👈 MUDANÇA 2: Inicializamos a ferramenta de HTTPS com a sua chave secreta
const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/enviar-alerta', async (req, res) => {
    const { id_equipamento, tipo, local, falhas, responsavel } = req.body;

    // Trava de segurança: Garante que o responsável possui e-mail cadastrado
    if (!responsavel || !responsavel.email) {
        return res.status(400).json({ erro: 'O responsável por este equipamento não possui e-mail cadastrado.' });
    }

    const mensagemTexto = `⚠️ ALERTA URGENTE - PREVENÇÃO ⚠️\nFoi detectada uma falha crítica no ${tipo} (${id_equipamento}) localizado em: ${local}.\n\nProblemas identificados: ${falhas}\n\nSolicitamos a manutenção imediata para garantir a operacionalidade do sistema.`;

    try {
        // 👈 MUDANÇA 3: O disparo de e-mail agora usa a porta 443 (HTTPS)
        const { error } = await resend.emails.send({
            from: 'Sistema Integrado de Monitoramento de Incêndio <onboarding@resend.dev>', // No plano gratuito, este precisa ser o remetente
            to: responsavel.email, 
            subject: `URGENTE: Manutenção Requerida - ${tipo} ${id_equipamento}`,
            html: `<p>${mensagemTexto.replace(/\n/g, '<br>')}</p>`
        });

        if (error) {
            console.error('Erro na API HTTPS da Resend:', error);
            return res.status(500).json({ erro: 'A API recusou o envio do e-mail.' });
        }

        // 👉 MANTIDO INTACTO: Disparo secundário por WhatsApp (Com isolamento de falhas)
        if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && responsavel.tel) {
            try {
                const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                // Limpa o número para garantir que tenha apenas dígitos
                const numTel = responsavel.tel.replace(/\D/g, ''); 
                await twilioClient.messages.create({
                    body: mensagemTexto,
                    from: 'whatsapp:+14155238886', 
                    to: `whatsapp:+55${numTel}` 
                });
            } catch (twErro) {
                console.warn('Alerta Twilio ignorado devido a ausência de chaves ou erro:', twErro.message);
            }
        }

        return res.status(200).json({ mensagem: 'Notificação enviada com sucesso!' });
    } catch (erro) {
        console.error('Erro geral no sistema de mensageria:', erro);
        return res.status(500).json({ erro: 'Falha ao enviar notificações via HTTPS.' });
    }
});

module.exports = router;