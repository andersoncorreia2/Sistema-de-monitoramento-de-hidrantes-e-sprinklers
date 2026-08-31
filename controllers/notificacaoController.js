const express = require('express');
const nodemailer = require('nodemailer');
const twilio = require('twilio'); 

const router = express.Router();

// 1. Configurando E-mail com Gmail Gratuito
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_REMETENTE, 
        pass: process.env.EMAIL_SENHA 
    },
    // Correção para evitar bloqueio de Antivírus/Firewall local
    tls: {
        rejectUnauthorized: false
    }
});

// 2. Configurando o Twilio de forma segura
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

router.post('/enviar-alerta', async (req, res) => {
    const { id_equipamento, tipo, local, falhas, responsavel } = req.body;

    const mensagemTexto = `⚠️ ALERTA CBMPE - PREVENÇÃO ⚠️\nFoi detectada uma falha crítica no ${tipo} (${id_equipamento}) localizado em: ${local}.\n\nProblemas identificados: ${falhas}\n\nSolicitamos a manutenção imediata para garantir a operacionalidade do sistema.`;

    try {
        // Disparo por E-mail
        await transporter.sendMail({
            from: process.env.EMAIL_REMETENTE, 
            to: responsavel.email, 
            subject: `URGENTE: Manutenção Requerida - ${tipo} ${id_equipamento}`,
            text: mensagemTexto
        });

        // Disparo por WhatsApp - Comentado até você ter as chaves reais do Twilio no .env
        /*
        await twilioClient.messages.create({
            body: mensagemTexto,
            from: 'whatsapp:+14155238886', 
            to: `whatsapp:${responsavel.tel}` 
        });
        */

        return res.status(200).json({ mensagem: 'Notificação enviada com sucesso!' });
    } catch (erro) {
        console.error(erro);
        return res.status(500).json({ erro: 'Falha ao enviar notificações.' });
    }
});

module.exports = router;