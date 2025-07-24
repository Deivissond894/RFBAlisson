const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

// Carrega variáveis de ambiente do arquivo .env
dotenv.config();

const app = express();
// A porta em que o servidor irá rodar. Fly.io espera a porta 8080.
const PORT = process.env.PORT || 8080;

// Middleware para analisar corpos de requisição JSON e URL-encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURAÇÕES GERAIS DO BOT (PERSONALIZÁVEIS) ---

// Credenciais do seu BSP (Business Solution Provider - Ex: Ultramsg)
const BSP_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID; // Obtido do seu provedor, definido no .env
const BSP_TOKEN = process.env.ULTRAMSG_TOKEN;       // Obtido do seu provedor, definido no .env
// URL da API do seu provedor para envio de mensagens
const BSP_API_URL = `https://api.ultramsg.com/${BSP_INSTANCE_ID}/messages/chat`;

// Mensagens Padrão do Bot (Personalize para cada novo cliente/bot)
const BOT_NAME = "Bravobot"; // Nome do seu bot (ex: Bravobot)
const COMPANY_NAME = "Refrigera"; // Nome da empresa para a qual o bot está trabalhando (ex: Refrigera)

// Mensagem de boas-vindas e menu principal
const WELCOME_MESSAGE = `Olá, tudo bem? Sou o ${BOT_NAME} do Vend. Alisson da ${COMPANY_NAME}. Como posso ajudar?\n1. Compra de peças.\n2. Garantia.\n3. Consulta de preços.\n4. Falar com Vend. Alisson.`;

// Respostas para as opções do menu (personalize conforme as opções do seu cliente)
const OPTION_1_RESPONSE = `Bom, para agilizar o seu atendimento e para te passar o valor da peça que você precisa, me mande o modelo do seu produto.\nNormalmente ele pode estar ao lado ou atrás do produto.\nConsegue me mandar uma foto ?`;
const OPTION_2_RESPONSE = `Para acionar a garantia, é necessário trazer a peça até a nossa loja, portando a nota ou cupom fiscal, apresentando o na expedição, dentro dos conformes, a peça será trocada em garantia.`;
const OPTION_3_RESPONSE = `Para consulta de preços, informe o nome do produto e me mande o modelo do seu produto, Normalmente ele pode estar ao lado ou atrás do produto.Consegue me mandar uma foto ?`;
const OPTION_4_RESPONSE = `Entendido. Vend. Alisson, entrará em contato com você em breve. Tempo médio de atendimento em até 10 minutos Por favor, aguarde.`;

// Mensagens para tipos de mídia e não reconhecimento
const IMAGE_RECEIVED_RESPONSE = `Ótima foto, logo logo o Vend. Alisson, informará o preço da sua peça...`;
const UNSUPPORTED_MEDIA_MESSAGE = `Desculpe, no momento só consigo processar mensagens de texto e imagens.`;

// Frases de controle para atendimento humano
// A frase que o HUMANO (você) envia pelo número do bot para o bot ficar em silêncio
const HUMAN_ASSUME_CHAT_PHRASE = "Obrigado por aguardar!";
// A frase que o HUMANO envia pelo número do bot para o bot poder re-engajar o cliente
const HUMAN_END_CHAT_PHRASE = "Agradeço pelo contato! Qualquer coisa, é só chamar por aqui";

// --- GESTÃO DE ESTADO (EM MEMÓRIA) ---
// ATENÇÃO: Os dados neste Map serão perdidos se a máquina do bot reiniciar (comum no plano gratuito do Fly.io).
// Para persistência e confiabilidade em produção, use um banco de dados (ex: Firestore).
const userStates = new Map(); // Armazena o estado de cada usuário
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000; // 24 horas em milissegundos
// Quantas vezes o bot tenta responder a uma mensagem não entendida antes de parar.
// 0 = para de responder na primeira mensagem não entendida.
const MAX_UNRECOGNIZED_MESSAGES = 0;

// --- LISTAS DE CONTROLE ---
// Frases de agradecimento do CLIENTE (usado para o bot não re-engajar se o cliente só agradecer)
const THANK_YOU_PHRASES = [
    'obrigado', 'obrigada', 'ok', 'certo', 'valeu', 'vlw', 'ate mais', 'tchau', 'grato', 'grata', 'agradeco', 'blz', 'beleza'
];

// Saudações iniciais que o bot deve reconhecer para enviar a mensagem de boas-vindas completa
const INITIAL_GREETINGS = new Set([
    'oi', 'bom dia', 'boa tarde', 'boa noite', 'eae', 'ei', 'opa', 'tudo bem', 'como esta', 'ola', 'oi bot', 'olá',
    'bom dia!', 'boa tarde!', 'boa noite!', 'olá!', 'oi!' // Incluindo variações com pontuação
]);

// Números de WhatsApp que o bot não deve responder de jeito nenhum
// Formato para Ultramsg: '55DDNNNNNNNNN@c.us' (substitua DD pelo DDD e NNNNNNNNN pelo número).
const BLOCKED_NUMBERS = new Set([
    '557182363173@c.us',
    '557188852435@c.us',
    '557193507843@c.us',
    '557188963640@c.us',
    '557193661827@c.us',
    '557186247714@c.us',
    '557181498044@c.us',
    '557186802477@c.us',
    '557184496604@c.us',
    '557186940566@c.us',
    '557192023899@c.us',
    '557191645289@c.us',
    '557183438841@c.us',
    '557583173104@c.us',
    '557186782610@c.us',
    '557185360476@c.us',
    '557191695755@c.us',
    '557184518695@c.us',
]);

// --- FUNÇÕES AUXILIARES ---

/**
 * Envia uma mensagem de volta ao WhatsApp via API do BSP (Ultramsg).
 * @param {string} to - Número do destinatário no formato do BSP (ex: '5571987654321@c.us').
 * @param {string} message - O texto da mensagem a ser enviada.
 */
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
        // console.log('Resposta do BSP:', response.data); // Opcional: para ver a resposta da API do BSP
    } catch (error) {
        console.error('Erro ao enviar mensagem via BSP:', error.response ? error.response.data : error.message);
    }
}

/**
 * Normaliza o texto e verifica se é uma das frases de agradecimento.
 * @param {string} text - O texto da mensagem do cliente.
 * @returns {boolean} - True se for uma mensagem de agradecimento, False caso contrário.
 */
function isThankYouMessage(text) {
    const normalizedText = text.toLowerCase().trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove acentos
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"") // Remove pontuação
        .replace(/\s{2,}/g," "); // Remove espaços duplos
    return THANK_YOU_PHRASES.includes(normalizedText);
}

/**
 * Normaliza o texto e verifica se é uma das saudações iniciais.
 * @param {string} text - O texto da mensagem do cliente.
 * @returns {boolean} - True se for uma saudação inicial, False caso contrário.
 */
function isInitialGreeting(text) {
    const normalizedText = text.toLowerCase().trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove acentos
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"") // Remove pontuação
        .replace(/\s{2,}/g,""); // Remove espaços duplos e garante uma string compacta
    // Verifica se a saudação exata ou uma variação sem pontuação/acentos está na lista
    return INITIAL_GREETINGS.has(normalizedText) || INITIAL_GREETINGS.has(text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

// --- ENDPOINT PRINCIPAL PARA RECEBER MENSAGENS (WEBHOOK) ---
app.post('/webhook', async (req, res) => {
    // Log do corpo completo da requisição recebida (RAW) para depuração
    console.log('Webhook recebido. Body (RAW):', JSON.stringify(req.body, null, 2));

    let eventData = req.body; // Objeto principal do webhook do BSP
    let messageData = eventData.data; // A mensagem real está DENTRO da propriedade 'data' (formato Ultramsg)

    // Verificação inicial: garante que os dados essenciais da mensagem estão presentes
    if (!messageData || !messageData.from) {
        console.log('Webhook recebido sem messageData ou from. Ignorando.');
        return res.status(200).send('Webhook inválido.'); // Retorna 200 OK para evitar reenvios do webhook
    }

    const from = messageData.from; // Número do remetente (cliente)

    // Inicializa o estado do usuário se não existir (ou se o bot reiniciou e perdeu o estado)
    if (!userStates.has(from)) {
        userStates.set(from, {
            lastBotMessageTime: 0, // Timestamp da última mensagem enviada pelo bot para este cliente
            unrecognizedCount: 0, // Contador de mensagens não entendidas consecutivamente
            humanAssumedChat: false, // Flag: true se um humano assumiu o chat para este cliente
            lastHumanBotMessage: null, // Conteúdo da última mensagem enviada pelo HUMANO (via bot)
            dialogflowSessionId: '' // Mantido para compatibilidade, mesmo sem Dialogflow ativo
        });
    }
    const currentUserState = userStates.get(from); // Obtém o estado atual do usuário

    console.log(`DEBUG: Estado atual para ${from}:`, JSON.stringify(currentUserState));

    // --- LÓGICA PARA MENSAGENS ENVIADAS PELO PRÓPRIO BOT (fromMe: true) ---
    // Estas são as mensagens que o atendente HUMANO (você) envia através do número do bot.
    if (messageData.fromMe) {
        const humanMessageText = messageData.body.trim();
        console.log(`Mensagem fromMe recebida: "${humanMessageText}"`);

        // Gatilho: Humano assumiu o chat
        if (humanMessageText === HUMAN_ASSUME_CHAT_PHRASE) {
            currentUserState.humanAssumedChat = true;
            currentUserState.lastBotMessageTime = Date.now(); // Marca o início do período de silêncio
            currentUserState.unrecognizedCount = 0; // Reseta o contador de não entendidos
            currentUserState.lastHumanBotMessage = humanMessageText; // Guarda a frase gatilho
            console.log(`Atendente humano assumiu o chat com ${from}. Bot ficará em silêncio por 24h.`);
        }
        // Gatilho: Humano finalizou o atendimento, bot pode re-engajar
        else if (humanMessageText === HUMAN_END_CHAT_PHRASE) {
            currentUserState.humanAssumedChat = false; // Bot pode voltar a falar
            currentUserState.unrecognizedCount = 0; // Reseta o contador
            currentUserState.lastHumanBotMessage = humanMessageText; // Guarda a frase gatilho
            console.log(`Atendente humano finalizou o atendimento com ${from}. Bot pronto para re-engajar.`);
        }
        // Outras mensagens fromMe: true, apenas registra (opcional) e ignora para o cliente
        else {
            console.log(`Mensagem fromMe: true não é um gatilho de controle. Ignorando.`);
        }
        userStates.set(from, currentUserState); // Salva o estado atualizado do usuário
        return res.status(200).send('Mensagem fromMe processada.'); // Retorna OK sem enviar mensagem ao cliente
    }

    // --- LÓGICA PARA MENSAGENS DE CLIENTES (fromMe: false) ---

    // 1. Ignorar mensagens de grupos (se o número termina com '@g.us')
    if (from.endsWith('@g.us')) {
        console.log(`Mensagem de grupo recebida de ${from}. Ignorando.`);
        return res.status(200).send('Mensagem de grupo ignorada.');
    }

    // 2. Ignorar números bloqueados
    // Normaliza o número para o formato do Set (ex: '5571987654321@c.us')
    const normalizedFromForBlocked = from.includes('@c.us') ? from : `whatsapp:${from}`; 
    if (BLOCKED_NUMBERS.has(normalizedFromForBlocked)) {
        console.log(`Mensagem de número bloqueado (${from}). Ignorando completamente.`);
        return res.status(200).send('Mensagem de número bloqueado ignorada.');
    }

    const type = messageData.type; // Tipo da mensagem (ex: 'chat', 'image', 'video')
    let text = messageData.body; // Conteúdo da mensagem de texto (pode ser vazio para mídias)

    console.log(`Mensagem recebida de ${from} (Tipo: ${type}): "${text || '[sem corpo de texto]'}"`);

    const currentTime = Date.now(); // Timestamp atual para controle de tempo

    // --- LÓGICA DE CONTROLE DE FLUXO DE CONVERSA E RE-ENGAJAMENTO ---
    // Verifica se o humano assumiu o chat e se o período de silêncio ainda está ativo
    if (currentUserState.humanAssumedChat) {
        const timeSinceLastBotMessage = currentTime - currentUserState.lastBotMessageTime;

        if (timeSinceLastBotMessage < TWENTY_FOUR_HOURS_MS) {
            // Ainda dentro do período de silêncio de 24h
            console.log(`Cliente ${from} em modo de atendimento humano/silêncio. Ignorando resposta do bot.`);

            // Lógica de re-engajamento se o humano enviou HUMAN_END_CHAT_PHRASE
            if (currentUserState.lastHumanBotMessage === HUMAN_END_CHAT_PHRASE) {
                // Se o cliente responder com uma mensagem de agradecimento, o bot continua em silêncio.
                if (isThankYouMessage(text)) {
                    console.log(`Cliente ${from} agradeceu após finalização. Bot permanece em silêncio.`);
                    return res.status(200).send('Agradecimento processado, bot em silêncio.');
                } else {
                    // Se o cliente responder com algo que NÃO é agradecimento, re-engajar o bot.
                    console.log(`Cliente ${from} respondeu com nova intenção após finalização. Re-engajando.`);
                    currentUserState.humanAssumedChat = false; // Bot pode voltar a falar
                    currentUserState.unrecognizedCount = 0; // Reseta o contador de não entendidos
                    currentUserState.lastBotMessageTime = currentTime; // Atualiza o timestamp para o próximo ciclo
                    userStates.set(from, currentUserState); // Salva o estado atualizado
                    await sendMessage(from, WELCOME_MESSAGE); // Envia a mensagem de boas-vindas para re-engajar
                    return res.status(200).send('Bot re-engajado.');
                }
            } else {
                // Se o humano assumiu com HUMAN_ASSUME_CHAT_PHRASE ou outra mensagem, bot permanece em silêncio.
                return res.status(200).send('Bot em silêncio por atendimento humano.');
            }
        } else {
            // Passou mais de 24h desde que o humano assumiu, bot pode voltar a falar.
            console.log(`Mais de 24h se passaram para ${from}. Bot pode voltar a falar.`);
            currentUserState.humanAssumedChat = false; // Reinicia o modo de chat com o bot
            currentUserState.unrecognizedCount = 0; // Reseta o contador
            userStates.set(from, currentUserState); // Salva o estado
            // Continua para a lógica normal do chatbot abaixo (será processada na próxima checagem)
        }
    }

    // --- LÓGICA PRINCIPAL DO CHATBOT (SE NÃO ESTIVER EM MODO DE SILÊNCIO) ---

    if (type === 'chat') { // Se a mensagem for de texto
        text = text.toLowerCase().trim(); // Normaliza o texto para comparação

        // 1. Verificar saudações iniciais
        if (isInitialGreeting(text)) {
            await sendMessage(from, WELCOME_MESSAGE);
            currentUserState.unrecognizedCount = 0; // Reseta o contador se a saudação for entendida
            currentUserState.lastBotMessageTime = currentTime; // Atualiza o tempo da última mensagem do bot
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
            currentUserState.lastBotMessageTime = currentTime; // Atualiza timestamp para o menu completo
        }
        // 3. Mensagem de texto não reconhecida (após saudações e opções)
        else {
            currentUserState.unrecognizedCount++; // Incrementa o contador de mensagens não entendidas
            console.log(`Bot não entendeu a mensagem de ${from}. Contador: ${currentUserState.unrecognizedCount}`);

            // Se o bot atingiu o limite de mensagens não entendidas, ele para de responder.
            if (currentUserState.unrecognizedCount > MAX_UNRECOGNIZED_MESSAGES) {
                console.log(`Bot parando de responder para ${from} (atingiu limite de não entendidos).`);
                currentUserState.humanAssumedChat = true; // Sinaliza que humano deve assumir o chat
                currentUserState.lastBotMessageTime = currentTime; // Marca o início do período de silêncio
                // Não envia mensagem para o cliente, conforme solicitado (MAX_UNRECOGNIZED_MESSAGES = 0)
            } else {
                // Como MAX_UNRECOGNIZED_MESSAGES é 0, este bloco não será executado.
                // Se MAX_UNRECOGNIZED_MESSAGES fosse > 0, aqui enviaria uma mensagem "Desculpe, não entendi..."
                console.log(`Bot não enviará mensagem "não entendi" pois MAX_UNRECOGNIZED_MESSAGES é 0.`);
            }
        }
    }
    // 4. Lógica para outros tipos de mídia
    else if (type === 'image') { // Se a mensagem for uma imagem
        await sendMessage(from, IMAGE_RECEIVED_RESPONSE);
        currentUserState.unrecognizedCount = 0; // Reseta o contador
        currentUserState.lastBotMessageTime = currentTime; // Atualiza o tempo da última mensagem do bot
    } else { // Para outros tipos de mensagem (vídeo, áudio, documentos, etc.)
        await sendMessage(from, UNSUPPORTED_MEDIA_MESSAGE);
        currentUserState.unrecognizedCount++; // Incrementa o contador para tipos não suportados
        currentUserState.lastBotMessageTime = currentTime; // Atualiza o tempo da última mensagem do bot
    }

    // Salva o estado atualizado do usuário no Map
    userStates.set(from, currentUserState);

    // Sempre responde com 200 OK para o webhook do BSP para indicar que a requisição foi recebida
    res.status(200).send('Mensagem processada com sucesso.');
});

// Inicia o servidor Node.js
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta 8080`);
});
