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
// 2. Disparo por WhatsApp via Twilio
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && responsavel.tel) {
    try {
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        
        // Limpa o número para garantir que tenha apenas dígitos
        const numTel = responsavel.tel.replace(/\D/g, ''); 
        
        // Garante o formato DDI +55
        const destinoWhatsApp = numTel.startsWith('55') ? `whatsapp:+${numTel}` : `whatsapp:+55${numTel}`;

        console.log(`📲 Tentando enviar WhatsApp para: ${destinoWhatsApp}`);

        await twilioClient.messages.create({
            body: mensagemTexto,
            from: 'whatsapp:+14155238886', // Número padrão do Sandbox da Twilio
            to: destinoWhatsApp 
        });
        
        console.log('✅ Mensagem de WhatsApp enviada com sucesso pela Twilio!');
    } catch (twErro) {
        // Exibe o erro crítico para diagnóstico
        console.error('❌ ERRO CRÍTICO NO TWILIO:', twErro.message);
    }
} else {
    console.warn('⚠️ Twilio ignorado: Faltam chaves de ambiente ou telefone do responsável.');
}
});

module.exports = router;