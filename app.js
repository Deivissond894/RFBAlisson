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
const BOT_NAME = "Bravobot"; // Nome do seu bot
const COMPANY_NAME = "Refrigera Brasil"; // Nome da sua empresa

const WELCOME_MESSAGE = `Olá, tudo bem? Sou o ${BOT_NAME} da ${COMPANY_NAME}. Como posso ajudar?\n1. Opção Um\n2. Opção Dois\n3. Opção Três\n4. Opção Quatro`;
const OPTION_1_RESPONSE = `Para consultar o preço, me informe o nome do produto e o modelo. Esse modelo geralmente fica ao lado ou atrás do aparelho. Se preferir, pode me mandar uma foto da etiqueta — assim consigo te ajudar mais rápido e com mais precisão! 😊`;
const OPTION_2_RESPONSE = `Para acionar a garantia, é só levar a peça até nossa loja com a nota ou cupom fiscal. Apresentando tudo certinho na expedição, a troca será feita pela garantia.`;
const OPTION_3_RESPONSE = `Para consultar o preço, me informe o nome do produto e o modelo. Esse modelo geralmente fica ao lado ou atrás do aparelho. Se preferir, pode me mandar uma foto da etiqueta — assim consigo te ajudar mais rápido e com mais precisão! 😊`;
const OPTION_4_RESPONSE = `Alisson entrará em contato com você em breve. Tempo médio de atendimento em até 10 minutos Por favor, aguarde.`;
const IMAGE_RECEIVED_RESPONSE = `Ótima imagem! Um de nossos atendentes irá analisar e entrará em contato em breve.`;
const UNSUPPORTED_MEDIA_MESSAGE = `Desculpe, no momento só consigo processar mensagens de texto e imagens.`;

// Frases de controle para atendimento humano
const HUMAN_ASSUME_CHAT_PHRASE = "Obrigado por aguardar!"; // Frase que o HUMANO envia para o bot ficar em silêncio
const HUMAN_END_CHAT_PHRASE = "Agradeço pelo contato! Qualquer coisa, é só chamar por aqui"; // Frase que o HUMANO envia para o bot poder re-engajar

// --- GESTÃO DE ESTADO (EM MEMÓRIA) ---
// ATENÇÃO: Os dados neste Map serão perdidos se a máquina do bot reiniciar (comum no plano gratuito do Fly.io).
// Para um negócio real, use um banco de dados persistente (ex: Firestore) para userStates!
const userStates = new Map();
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000; // 24 horas em milissegundos
const MAX_UNRECOGNIZED_MESSAGES = 0; // Quantas vezes o bot tenta responder antes de parar (0 = para na 1a)

// --- LISTAS DE CONTROLE ---
const THANK_YOU_PHRASES = [ // Usado para identificar agradecimentos do cliente após finalizar atendimento
    'obrigado', 'obrigada', 'ok', 'certo', 'valeu', 'vlw', 'ate mais', 'tchau', 'grato', 'grata', 'agradeco', 'blz', 'beleza'
];

const INITIAL_GREETINGS = new Set([ // Frases que disparam a mensagem de boas-vindas
    'oi', 'bom dia', 'boa tarde', 'boa noite', 'eae', 'ei', 'opa', 'tudo bem', 'como esta', 'ola', 'oi bot', 'olá'
]);

const BLOCKED_NUMBERS = new Set([ // Números que o bot não deve responder de jeito nenhum
    // Formato para Ultramsg: '55DDNNNNNNNNN@c.us' (substitua DD pelo DDD e NNNNNNNNN pelo número)
    // Exemplo: '5571987654321@c.us'
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

function isInitialGreeting(text) {
    const normalizedText = text.toLowerCase().trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"")
        .replace(/\s{2,}/g," ");
    return INITIAL_GREETINGS.has(normalizedText);
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

    const from = messageData.from; // Número do remetente (cliente)

    // Inicializa o estado do usuário se não existir
    if (!userStates.has(from)) {
        userStates.set(from, {
            lastBotMessageTime: 0,
            unrecognizedCount: 0,
            humanAssumedChat: false,
            lastHumanBotMessage: null,
            dialogflowSessionId: '' // Mantido para compatibilidade, não usado nesta versão
        });
    }
    const currentUserState = userStates.get(from);

    console.log(`DEBUG: Estado atual para ${from}:`, JSON.stringify(currentUserState));

    // --- Lógica para mensagens enviadas pelo próprio bot (fromMe: true) ---
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

    // --- Ignora mensagens de grupos ---
    if (from.endsWith('@g.us')) {
        console.log(`Mensagem de grupo recebida de ${from}. Ignorando.`);
        return res.status(200).send('Mensagem de grupo ignorada.');
    }

    // --- Ignora números bloqueados ---
    // Adapte o formato do número bloqueado conforme o seu BSP (Ultramsg: @c.us, Twilio: whatsapp:+)
    const normalizedFromForBlocked = from.includes('@c.us') ? from : `whatsapp:${from}`; 
    if (BLOCKED_NUMBERS.has(normalizedFromForBlocked)) {
        console.log(`Mensagem de número bloqueado (${from}). Ignorando completamente.`);
        return res.status(200).send('Mensagem de número bloqueado ignorada.');
    }

    // Extrai o tipo e o corpo da mensagem
    const type = messageData.type;
    let text = messageData.body;

    console.log(`Mensagem recebida de ${from} (Tipo: ${type}): "${text || '[sem corpo de texto]'}"`);

    const currentTime = Date.now();

    // --- LÓGICA DE CONTROLE DE FLUXO DE CONVERSA E RE-ENGAJAMENTO ---
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
                // Continua para a lógica normal do chatbot abaixo
            } else {
                return res.status(200).send('Bot em silêncio por atendimento humano.');
            }
        } else {
            console.log(`Mais de 24h se passaram para ${from}. Bot pode voltar a falar.`);
            currentUserState.humanAssumedChat = false;
            currentUserState.unrecognizedCount = 0;
            userStates.set(from, currentUserState);
            // Continua para a lógica normal do chatbot abaixo
        }
    }

    // --- LÓGICA PRINCIPAL DO CHATBOT ---

    if (type === 'chat') {
        text = text.toLowerCase().trim();

        // 1. Verificar saudações iniciais
        if (isInitialGreeting(text)) {
            await sendMessage(from, WELCOME_MESSAGE);
            currentUserState.unrecognizedCount = 0;
            currentUserState.lastBotMessageTime = currentTime;
        }
        // 2. Opções diretas do menu
        else if (text === '1') {
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
        } else if (text === 'menu') { // Opção para ver o menu principal
            await sendMessage(from, WELCOME_MESSAGE);
            currentUserState.unrecognizedCount = 0;
            currentUserState.lastBotMessageTime = currentTime;
        }
        // 3. Mensagem não reconhecida pelo bot (após saudações e opções)
        else {
            currentUserState.unrecognizedCount++; // Incrementa o contador
            console.log(`Bot não entendeu a mensagem de ${from}. Contador: ${currentUserState.unrecognizedCount}`);

            if (currentUserState.unrecognizedCount > MAX_UNRECOGNIZED_MESSAGES) {
                console.log(`Bot parando de responder para ${from} (atingiu limite de não entendidos).`);
                currentUserState.humanAssumedChat = true;
                currentUserState.lastBotMessageTime = currentTime;
            } else {
                console.log(`Bot não enviará mensagem "não entendi" pois MAX_UNRECOGNIZED_MESSAGES é 0.`);
            }
        }
    } else if (type === 'image') { // Se for uma imagem
        await sendMessage(from, IMAGE_RECEIVED_RESPONSE);
        currentUserState.unrecognizedCount = 0;
    } else {
        // Para outros tipos de mensagem (vídeo, áudio, etc.)
        await sendMessage(from, UNSUPPORTED_MEDIA_MESSAGE);
        currentUserState.unrecognizedCount++;
    }

    userStates.set(from, currentUserState);
    res.status(200).send('Mensagem processada com sucesso.');
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
