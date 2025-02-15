const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios'); // Para enviar solicitudes
const cors = require('cors'); // Para habilitar CORS
const mysql = require('mysql2'); // Para conectarse a la base de datos

const app = express();
app.use(bodyParser.json());
app.use(cors());

const db = mysql.createPool({
    host: process.env.DB_HOST,      // Usar variables de entorno
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
});

// Verifica la conexión
db.getConnection((err) => {
    if (err) {
        console.error('Error al conectar a la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos MySQL');
    }
});

// Token de verificación
const VERIFY_TOKEN = 'Mi_Nuevo_Token_Secreto';
const ACCESS_TOKEN = 'EAAG8R2yWJOwBO9ZBFWH5HQzmsmJxLS8hpX1kt05P42HYr2pdfIINTpJAOCWeoSYlat26qCYZBnAMADObZCZBSOxBPI1Aa55Cmn8GfHfWRPVFIBL7U8O4lAfYyDvINtxPUwiTo7Q6ceUqp8oPW2BMvlC98w2QZCpX1GmGj1X6Wpm6cdjIulA3HsedytsVKcpTB8wZDZD'; // Reemplazar con tu token de acceso de Meta

// Endpoint para manejar la verificación del webhook
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        // Responde con el hub.challenge
        res.status(200).send(challenge);
    } else {
        res.status(403).send('Token inválido!');
    }
});

// Endpoint para recibir mensajes entrantes de WhatsApp
app.post('/webhook', async (req, res) => {
    console.log('Mensaje recibido en Webhook:', JSON.stringify(req.body, null, 2));
    const body = req.body;

    if (body.object) {
        console.log('Mensaje recibido:', JSON.stringify(body, null, 2));

        // Redirige el mensaje a Make
        try {
            const makeResponse = await axios.post(
                'https://hook.eu2.make.com/ve2tavn6hjsvscq1t3q5y6jc0m47ee68',
                body
            );
            console.log('Mensaje enviado a Make:', makeResponse.status);
        } catch (error) {
            console.error('Error al enviar el mensaje a Make:', error.message);
        }

        // Confirma la recepción a WhatsApp
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.status(404).send('No encontrado');
    }
});

// Endpoint para recibir la respuesta de Make y enviar el mensaje a través de la API de WhatsApp
app.post('/send-message', async (req, res) => {
    const { to, response } = req.body;

    if (!to || !response) {
        return res.status(400).send('Datos incompletos');
    }

    try {
        // Construir el JSON para enviar el mensaje
        const data = {
            messaging_product: 'whatsapp',
            to: to,
            type: 'text',
            text: {
                body: response
            }
        };

        // URL de la API de WhatsApp
        const url = `https://graph.facebook.com/v21.0/559822483873940/messages`; // Reemplaza <PHONE_NUMBER_ID> con tu número de teléfono ID

        // Enviar el mensaje a través de la API de WhatsApp
        const whatsappResponse = await axios.post(url, data, {
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Mensaje enviado a WhatsApp:', whatsappResponse.data);
        res.status(200).send('Mensaje enviado');
    } catch (error) {
        console.error('Error al enviar mensaje a WhatsApp:', error.response ? error.response.data : error.message);
        res.status(500).send('Error al enviar mensaje');
    }
});


process.on("SIGTERM", () => {
    console.log("Señal SIGTERM recibida. Cerrando servidor...");
    server.close(() => {
        console.log("Servidor cerrado correctamente.");
        process.exit(0);
    });
});


// Inicia el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
