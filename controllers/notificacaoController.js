const express = require('express');
const { Resend } = require('resend'); 
const twilio = require('twilio'); 

require('dns').setDefaultResultOrder('ipv4first'); 

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/enviar-alerta', async (req, res) => {
    const { id_equipamento, tipo, local, falhas, responsavel } = req.body;

    if (!responsavel || !responsavel.email) {
        return res.status(400).json({ erro: 'O responsável por este equipamento não possui e-mail cadastrado.' });
    }

    const mensagemTexto = `⚠️ ALERTA URGENTE - PREVENÇÃO ⚠️\nFoi detectada uma falha crítica no ${tipo} (${id_equipamento}) localizado em: ${local}.\n\nProblemas identificados: ${falhas}\n\nSolicitamos a manutenção imediata para garantir a operacionalidade do sistema.`;

    try {
        // 1. Disparo de e-mail via Resend
        const { error } = await resend.emails.send({
            from: 'Sistema Integrado de Monitoramento de Incêndio <onboarding@resend.dev>',
            to: responsavel.email, 
            subject: `URGENTE: Manutenção Requerida - ${tipo} ${id_equipamento}`,
            html: `<p>${mensagemTexto.replace(/\n/g, '<br>')}</p>`
        });

        if (error) {
            console.error('Erro na API HTTPS da Resend:', error);
            return res.status(500).json({ erro: 'A API recusou o envio do e-mail.' });
        }

        // 2. Disparo por WhatsApp via Twilio (Com suporte a ContentSid)
        if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && responsavel.tel) {
            try {
                const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                
                const numTel = responsavel.tel.replace(/\D/g, ''); 
                const destinoWhatsApp = numTel.startsWith('55') ? `whatsapp:+${numTel}` : `whatsapp:+55${numTel}`;

                console.log(`📲 Tentando enviar WhatsApp para: ${destinoWhatsApp}`);

                // Envio utilizando Content API do Sandbox da Twilio para evitar o erro de ContentSid
                await twilioClient.messages.create({
                    contentSid: 'HXb3238a1670d378089bc9f539f4088a53', // Template padrão de teste da Twilio Sandbox
                    contentVariables: JSON.stringify({
                        1: tipo,
                        2: id_equipamento,
                        3: local
                    }),
                    from: 'whatsapp:+14155238886',
                    to: destinoWhatsApp 
                });
                
                console.log('✅ Mensagem de WhatsApp enviada com sucesso pela Twilio!');
            } catch (twErro) {
                console.error('❌ ERRO CRÍTICO NO TWILIO:', twErro.message);
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