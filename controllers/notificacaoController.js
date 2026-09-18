const express = require('express');
const twilio = require('twilio'); 

require('dns').setDefaultResultOrder('ipv4first'); 

const router = express.Router();

// 🟢 Envia via API HTTPS do Brevo (mesma conta usada na recuperação de senha).
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

    // INÍCIO DO TRY PRINCIPAL
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

        // 2. Disparo por WhatsApp via Twilio
        if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && responsavel.tel) {
            try {
                const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                
                // Limpa o número para garantir que tenha apenas dígitos
                const numTel = responsavel.tel.replace(/\D/g, ''); 
                
                // Garante o formato DDI +55
                const destinoWhatsApp = numTel.startsWith('55') ? `whatsapp:+${numTel}` : `whatsapp:+55${numTel}`;

                console.log(`📲 Tentando enviar WhatsApp para: ${destinoWhatsApp}`);

                // O envio deve conter apenas o body, from e to. Nenhuma referência a contentSid.
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

        // 👇 FECHAMENTO RECUPERADO: Retorna sucesso ao painel web após os disparos
        return res.status(200).json({ mensagem: 'Notificação processada com sucesso!' });

    // FECHAMENTO DO TRY PRINCIPAL COM O CATCH GERAL
    } catch (erro) {
        console.error('Erro geral no sistema de mensageria:', erro);
        return res.status(500).json({ erro: 'Falha ao enviar notificações via HTTPS.' });
    }
});

module.exports = router;