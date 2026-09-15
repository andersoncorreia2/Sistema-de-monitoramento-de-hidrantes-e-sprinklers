const express = require('express');
const twilio = require('twilio'); 

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

    if (!responsavel || !responsavel.email) {
        return res.status(400).json({ erro: 'O responsável por este equipamento não possui e-mail cadastrado.' });
    }

    const mensagemTexto = `⚠️ ALERTA URGENTE - PREVENÇÃO ⚠️\nFoi detectada uma falha crítica no ${tipo} (${id_equipamento}) localizado em: ${local}.\n\nProblemas identificados: ${falhas}\n\nSolicitamos a manutenção imediata para garantir a operacionalidade do sistema.`;

    try {
        // 1. Disparo de e-mail via Brevo
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

        // Disparo por WhatsApp via Twilio
        // 🟢 Prioriza Content Template aprovado (produção). Se não houver template
        // configurado, cai para mensagem de texto livre (só funciona no Sandbox
        // dentro da janela de 72h de opt-in do destinatário).
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && responsavel.tel) {
    try {
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        const numTel = responsavel.tel.replace(/\D/g, ''); 
        const destinoWhatsApp = numTel.startsWith('55') ? `whatsapp:+${numTel}` : `whatsapp:+55${numTel}`;

        // Número remetente: em produção use seu número de WhatsApp Business
        // aprovado (TWILIO_WHATSAPP_FROM). Sem isso, cai no Sandbox de testes.
        const remetenteWhatsApp = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

        console.log(`📲 Tentando enviar WhatsApp para: ${destinoWhatsApp}`);

        const payloadBase = {
            from: remetenteWhatsApp,
            to: destinoWhatsApp
        };

        if (process.env.TWILIO_TEMPLATE_ALERTA_SID) {
            // 🟢 Envio via Content Template aprovado (funciona fora da janela de
            // 24h/72h e não exige opt-in prévio do destinatário).
            // As variáveis abaixo devem corresponder, na mesma ordem, às
            // variáveis {{1}}, {{2}}, {{3}}, {{4}} definidas no template
            // criado no Twilio Content Template Builder.
            await twilioClient.messages.create({
                ...payloadBase,
                contentSid: process.env.TWILIO_TEMPLATE_ALERTA_SID,
                contentVariables: JSON.stringify({
                    1: String(tipo),
                    2: String(id_equipamento),
                    3: String(local),
                    4: String(falhas)
                })
            });

            console.log('✅ Mensagem de WhatsApp (template) enviada com sucesso pela Twilio!');
        } else {
            // Fallback: texto livre — só entrega se o destinatário tiver dado
            // opt-in no Sandbox nas últimas 72h.
            await twilioClient.messages.create({
                ...payloadBase,
                body: mensagemTexto
            });

            console.log('✅ Mensagem de WhatsApp (texto livre) enviada com sucesso pela Twilio!');
        }
    } catch (twErro) {
        console.error('❌ Erro no Twilio:', twErro.code, twErro.message);
    }
} else {
            console.warn('⚠️ Twilio ignorado: Faltam chaves de ambiente ou telefone do responsável.');
        }

        return res.status(200).json({ mensagem: 'Notificação processada com sucesso!' });
    } catch (erro) {
        console.error('Erro geral no sistema de mensageria:', erro);
        return res.status(500).json({ erro: 'Falha ao enviar notificações via HTTPS.' });
    }
});

module.exports = router;