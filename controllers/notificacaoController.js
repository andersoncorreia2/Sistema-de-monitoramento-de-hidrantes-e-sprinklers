const express = require('express');
const nodemailer = require('nodemailer');
const twilio = require('twilio'); 

// 👉 ADICIONE ESTA LINHA PARA FORÇAR O IPv4 TAMBÉM AQUI
require('dns').setDefaultResultOrder('ipv4first'); 

const router = express.Router();

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', // Usar o host explícito
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_REMETENTE, 
        pass: process.env.EMAIL_SENHA 
    },
    tls: {
        rejectUnauthorized: false
    }
});

router.post('/enviar-alerta', async (req, res) => {
    const { id_equipamento, tipo, local, falhas, responsavel } = req.body;

    // Trava de segurança: Garante que o responsável possui e-mail cadastrado
    if (!responsavel || !responsavel.email) {
        return res.status(400).json({ erro: 'O responsável por este equipamento não possui e-mail cadastrado.' });
    }

    const mensagemTexto = `⚠️ ALERTA URGENTE - PREVENÇÃO ⚠️\nFoi detectada uma falha crítica no ${tipo} (${id_equipamento}) localizado em: ${local}.\n\nProblemas identificados: ${falhas}\n\nSolicitamos a manutenção imediata para garantir a operacionalidade do sistema.`;

    try {
        // Disparo primário por E-mail
        await transporter.sendMail({
            from: process.env.EMAIL_REMETENTE, 
            to: responsavel.email, 
            subject: `URGENTE: Manutenção Requerida - ${tipo} ${id_equipamento}`,
            text: mensagemTexto
        });

        // Disparo secundário por WhatsApp (Com isolamento de falhas)
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
        console.error('Erro no Nodemailer:', erro);
        return res.status(500).json({ erro: 'Falha ao enviar notificações. Verifique as credenciais do Gmail.' });
    }
});

module.exports = router;