const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURAÇÕES GERAIS DO BOT (PERSONALIZÁVEIS) ---

// Credenciais do seu BSP (Ultramsg)
const BSP_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID; // Use ULTRAMSG_INSTANCE_ID no .env
const BSP_TOKEN = process.env.ULTRAMSG_TOKEN;       // Use ULTRAMSG_TOKEN no .env
const BSP_API_URL = `https://api.ultramsg.com/${BSP_INSTANCE_ID}/messages/chat`;

// Mensagens Padrão do Bot
const BOT_NAME = "Seu Bot"; // Nome do seu bot
const COMPANY_NAME = "Sua Empresa"; // Nome da sua empresa

const WELCOME_MESSAGE = `Olá, tudo bem? Sou o ${BOT_NAME} da ${COMPANY_NAME}. Como posso ajudar?\n1. Opção Um\n2. Opção Dois\n3. Opção Três\n4. Opção Quatro`;
const OPTION_1_RESPONSE = `Resposta detalhada para a Opção Um.`;
const OPTION_2_RESPONSE = `Resposta detalhada para a Opção Dois.`;
const OPTION_3_RESPONSE = `Resposta detalhada para a Opção Três.`;
const OPTION_4_RESPONSE = `Resposta detalhada para a Opção Quatro.`;
const IMAGE_RECEIVED_RESPONSE = `Ótima imagem! Um de nossos atendentes irá analisar e entrará em contato em breve.`;
const UNSUPPORTED_MEDIA_MESSAGE = `Desculpe, no momento só consigo processar mensagens de texto e imagens.`;

// Frases de controle para atendimento humano
const HUMAN_ASSUME_CHAT_PHRASE = "Obrigado por aguardar!"; // Frase que o HUMANO envia para o bot ficar em silêncio
const HUMAN_END_CHAT_PHRASE = "Agradeço pelo contato! Qualquer coisa, é só chamar por aqui"; // Frase que o HUMANO envia para o bot poder re-engajar

// --- GESTÃO DE ESTADO (EM MEMÓRIA) ---
const userStates = new Map();
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MAX_UNRECOGNIZED_MESSAGES = 0; // Bot para de responder após a primeira mensagem não entendida

// --- LISTAS DE CONTROLE ---
const THANK_YOU_PHRASES = [
    'obrigado', 'obrigada', 'ok', 'certo', 'valeu', 'vlw', 'ate mais', 'tchau', 'grato', 'grata', 'agradeco', 'blz', 'beleza'
];

// LISTA APRIMORADA DE SAUDAÇÕES INICIAIS
const INITIAL_GREETINGS = new Set([
    'oi', 'bom dia', 'boa tarde', 'boa noite', 'eae', 'ei', 'opa', 'tudo bem', 'como esta', 'ola', 'oi bot', 'olá',
    'bom dia!', 'boa tarde!', 'boa noite!', 'olá!', 'oi!' // Adicionado com pontuação e acento para robustez
]);

const BLOCKED_NUMBERS = new Set([
    // Adicione seus números aqui no formato correto para Ultramsg (ex: '5571987654321@c.us')
]);

// --- FUNÇÕES AUXILIARES ---

async function sendMessage(to, message) {
    console.log(`DEBUG: sendMessage sendo chamado para ${to} com a mensagem: "${message}"`);
    const params = new URLSearchParams();
    params.append('token', BSP_TOKEN);
    params.append('to', to);
    params.append('body', message);

    try {
        const response = await axios.post(BSP_API_URL, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        console.log(`Mensagem enviada para ${to}: ${message}`);
    } catch (error) {
        console.error('Erro ao enviar mensagem via BSP:', error.response ? error.response.data : error.message);
    }
}

function isThankYouMessage(text) {
    const normalizedText = text.toLowerCase().trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"")
        .replace(/\s{2,}/g," ");
    return THANK_YOU_PHRASES.includes(normalizedText);
}

// FUNÇÃO APRIMORADA DE RECONHECIMENTO DE SAUDAÇÕES
function isInitialGreeting(text) {
    const normalizedText = text.toLowerCase().trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove acentos
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"") // Remove pontuação
        .replace(/\s{2,}/g,""); // Remove espaços duplos e garante uma string compacta
    // Verifica se a saudação exata ou uma variação sem pontuação/acentos está na lista
    return INITIAL_GREETINGS.has(normalizedText) || INITIAL_GREETINGS.has(text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

// --- ENDPOINT PARA RECEBER MENSAGENS (WEBHOOK) ---
app.post('/webhook', async (req, res) => {
    console.log('Webhook recebido. Body (RAW):', JSON.stringify(req.body, null, 2));

    let eventData = req.body;
    let messageData = eventData.data;

    if (!messageData || !messageData.from) {
        console.log('Webhook recebido sem messageData ou from. Ignorando.');
        return res.status(200).send('Webhook inválido.');
    }

    const from = messageData.from;

    if (!userStates.has(from)) {
        userStates.set(from, {
            lastBotMessageTime: 0,
            unrecognizedCount: 0,
            humanAssumedChat: false,
            lastHumanBotMessage: null,
            dialogflowSessionId: ''
        });
    }
    const currentUserState = userStates.get(from);

    console.log(`DEBUG: Estado atual para ${from}:`, JSON.stringify(currentUserState));

    if (messageData.fromMe) {
        const humanMessageText = messageData.body.trim();
        console.log(`Mensagem fromMe recebida: "${humanMessageText}"`);

        if (humanMessageText === HUMAN_ASSUME_CHAT_PHRASE) {
            currentUserState.humanAssumedChat = true;
            currentUserState.lastBotMessageTime = Date.now();
            currentUserState.unrecognizedCount = 0;
            currentUserState.lastHumanBotMessage = humanMessageText;
            console.log(`Atendente humano assumiu o chat com ${from}. Bot ficará em silêncio por 24h.`);
        } else if (humanMessageText === HUMAN_END_CHAT_PHRASE) {
            currentUserState.humanAssumedChat = false;
            currentUserState.unrecognizedCount = 0;
            currentUserState.lastHumanBotMessage = humanMessageText;
            console.log(`Atendente humano finalizou o atendimento com ${from}. Bot pronto para re-engajar.`);
        } else {
            console.log(`Mensagem fromMe: true não é um gatilho de controle. Ignorando.`);
        }
        userStates.set(from, currentUserState);
        return res.status(200).send('Mensagem fromMe processada.');
    }

    if (from.endsWith('@g.us')) {
        console.log(`Mensagem de grupo recebida de ${from}. Ignorando.`);
        return res.status(200).send('Mensagem de grupo ignorada.');
    }

    const normalizedFromForBlocked = from.includes('@c.us') ? from : `whatsapp:${from}`; 
    if (BLOCKED_NUMBERS.has(normalizedFromForBlocked)) {
        console.log(`Mensagem de número bloqueado (${from}). Ignorando completamente.`);
        return res.status(200).send('Mensagem de número bloqueado ignorada.');
    }

    const type = messageData.type;
    let text = messageData.body;

    console.log(`Mensagem recebida de ${from} (Tipo: ${type}): "${text || '[sem corpo de texto]'}"`);

    const currentTime = Date.now();

    if (currentUserState.humanAssumedChat) {
        const timeSinceLastBotMessage = currentTime - currentUserState.lastBotMessageTime;

        if (timeSinceLastBotMessage < TWENTY_FOUR_HOURS_MS) {
            console.log(`Cliente ${from} em modo de atendimento humano/silêncio. Ignorando resposta do bot.`);
            if (currentUserState.lastHumanBotMessage === HUMAN_END_CHAT_PHRASE && isThankYouMessage(text)) {
                console.log(`Cliente ${from} agradeceu após finalização. Bot permanece em silêncio.`);
                return res.status(200).send('Agradecimento processado, bot em silêncio.');
            } else if (currentUserState.lastHumanBotMessage === HUMAN_END_CHAT_PHRASE && !isThankYouMessage(text)) {
                console.log(`Cliente ${from} respondeu com nova intenção após finalização. Re-engajando.`);
                currentUserState.humanAssumedChat = false;
                currentUserState.unrecognizedCount = 0;
                currentUserState.lastBotMessageTime = currentTime;
                userStates.set(from, currentUserState);
            } else {
                return res.status(200).send('Bot em silêncio por atendimento humano.');
            }
        } else {
            console.log(`Mais de 24h se passaram para ${from}. Bot pode voltar a falar.`);
            currentUserState.humanAssumedChat = false;
            currentUserState.unrecognizedCount = 0;
            userStates.set(from, currentUserState);
        }
    }

    if (type === 'chat') {
        text = text.toLowerCase().trim();

        if (isInitialGreeting(text)) { // SAUDOES INICIAIS
            await sendMessage(from, WELCOME_MESSAGE);
            currentUserState.unrecognizedCount = 0;
            currentUserState.lastBotMessageTime = currentTime;
        } else if (text === '1') {
            await sendMessage(from, OPTION_1_RESPONSE);
            currentUserState.unrecognizedCount = 0;
            currentUserState.lastBotMessageTime = currentTime;
        } else if (text === '2') {
            await sendMessage(from, OPTION_2_RESPONSE);
            currentUserState.unrecognizedCount = 0;
            currentUserState.lastBotMessageTime = currentTime;
        } else if (text === '3') {
            await sendMessage(from, OPTION_3_RESPONSE);
            currentUserState.unrecognizedCount = 0;
            currentUserState.lastBotMessageTime = currentTime;
        } else if (text === '4') {
            await sendMessage(from, OPTION_4_RESPONSE);
            currentUserState.unrecognizedCount = 0;
            currentUserState.lastBotMessageTime = currentTime;
        } else if (text === 'menu') {
            await sendMessage(from, WELCOME_MESSAGE);
            currentUserState.unrecognizedCount = 0;
            currentUserState.lastBotMessageTime = currentTime;
        } else {
            currentUserState.unrecognizedCount++;
            console.log(`Bot não entendeu a mensagem de ${from}. Contador: ${currentUserState.unrecognizedCount}`);

            if (currentUserState.unrecognizedCount > MAX_UNRECOGNIZED_MESSAGES) {
                console.log(`Bot parando de responder para ${from} (atingiu limite de não entendidos).`);
                currentUserState.humanAssumedChat = true;
                currentUserState.lastBotMessageTime = currentTime;
            } else {
                console.log(`Bot não enviará mensagem "não entendi" pois MAX_UNRECOGNIZED_MESSAGES é 0.`);
            }
        }
    } else if (type === 'image') {
        await sendMessage(from, IMAGE_RECEIVED_RESPONSE);
        currentUserState.unrecognizedCount = 0;
    } else {
        await sendMessage(from, UNSUPPORTED_MEDIA_MESSAGE);
        currentUserState.unrecognizedCount++;
    }

    userStates.set(from, currentUserState);
    res.status(200).send('Mensagem processada com sucesso.');
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta 8080`);
});