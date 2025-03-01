const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios'); // Para enviar solicitudes
const cors = require('cors'); // Para habilitar CORS
const mysql = require('mysql2'); // Para conectarse a la base de datos

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.json({ extended: true }));
app.use(express.urlencoded({ extended: true }));

const db = mysql.createPool({
    host: 'srv1041.hstgr.io',
    user: 'u255066530_SharkChat',
    password: 'aTg@K7$vP9Fw&iA#nz22mrhg',
    database: 'u255066530_ChatBoot',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
});

// Verifica la conexión
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error al conectar a la base de datos:', err.message);
    } else {
        console.log('✅ Conectado a la base de datos MySQL');
        connection.release(); // Liberar la conexión
    }
});

// Token de verificación
const VERIFY_TOKEN = 'Mi_Nuevo_Token_Secreto';
const ACCESS_TOKEN = 'EAAG8R2yWJOwBO9ZBFWH5HQzmsmJxLS8hpX1kt05P42HYr2pdfIINTpJAOCWeoSYlat26qCYZBnAMADObZCZBSOxBPI1Aa55Cmn8GfHfWRPVFIBL7U8O4lAfYyDvINtxPUwiTo7Q6ceUqp8oPW2BMvlC98w2QZCpX1GmGj1X6Wpm6cdjIulA3HsedytsVKcpTB8wZDZD'; // Reemplazar con tu token real

// 📌 Endpoint para manejar la verificación del webhook
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.status(403).send('Token inválido!');
    }
});

// 📌 Endpoint para recibir mensajes de WhatsApp y enviarlos a Make
app.post('/webhook', async (req, res) => {
    console.log('Mensaje recibido en Webhook:', JSON.stringify(req.body, null, 2));
    const body = req.body;

    if (body.object) {
        try {
            const makeResponse = await axios.post(
                'https://hook.eu2.make.com/ve2tavn6hjsvscq1t3q5y6jc0m47ee68',
                body
            );
            console.log('✅ Mensaje enviado a Make:', makeResponse.status);
        } catch (error) {
            console.error('❌ Error al enviar mensaje a Make:', error.message);
        }

        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.status(404).send('No encontrado');
    }
});

// 📌 Endpoint para enviar mensajes de respuesta a WhatsApp
app.post('/send-message', async (req, res) => {
    const { to, response } = req.body;

    if (!to || !response) {
        return res.status(400).send('Datos incompletos');
    }

    try {
        const data = {
            messaging_product: 'whatsapp',
            to: to,
            type: 'text',
            text: { body: response }
        };

        const url = `https://graph.facebook.com/v21.0/559822483873940/messages`;

        const whatsappResponse = await axios.post(url, data, {
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Mensaje enviado a WhatsApp:', whatsappResponse.data);
        res.status(200).send('Mensaje enviado');
    } catch (error) {
        console.error('❌ Error al enviar mensaje a WhatsApp:', error.response ? error.response.data : error.message);
        res.status(500).send('Error al enviar mensaje');
    }
});

// End point para enviar mensajes desde el frontend a WhatsApp

app.post('/send-manual-message', async (req, res) => {
    // Expecting: to (recipient phone), conversationId, message (text), and optionally sender
    const { to, conversationId, message, sender } = req.body;
  
    if (!to || !conversationId || !message) {
      return res.status(400).send('Missing required fields: to, conversationId, and message are required.');
    }
  
    try {
      // Build the payload to send via WhatsApp API
      const data = {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: message }
      };
  
      const url = `https://graph.facebook.com/v21.0/559822483873940/messages`;
  
      // Send the message via the WhatsApp API
      const whatsappResponse = await axios.post(url, data, {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
  
      console.log('✅ Manual message sent to WhatsApp:', whatsappResponse.data);
  
      // After successful sending, insert the message into the database
      const sql = `
        INSERT INTO messages (conversation_id, sender, message, sent_at)
        VALUES (?, ?, ?, NOW())
      `;
      // Use "Sharky" as default sender if not provided
      db.query(sql, [conversationId, sender || 'Sharky', message], (err, result) => {
        if (err) {
          console.error('❌ Error storing message in DB:', err.message);
          return res.status(500).json({ error: 'Error storing message in DB' });
        }
        res.status(200).json({ message: 'Message sent and stored successfully', insertId: result.insertId });
      });
    } catch (error) {
      console.error('❌ Error sending manual message:', error.response ? error.response.data : error.message);
      res.status(500).send('Error sending manual message');
    }
  });

// 📌 Endpoint para obtener todas las conversaciones con el último mensaje
app.get('/api/conversations', (req, res) => {
    const sql = `
SELECT 
    c.id AS conversation_id, 
    c.client_id, 
    cl.name AS client_name, 
    c.status,
    c.autoresponse,
    (SELECT message FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1) AS last_message,
    c.last_message_at
FROM conversations c
JOIN clients cl ON c.client_id = cl.id
ORDER BY c.last_message_at DESC;

    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Error al obtener conversaciones:', err.message);
            return res.status(500).json({ error: 'Error al obtener conversaciones' });
        }
        res.json(results);
    });
});

// 📌 Endpoint para obtener los mensajes de una conversación específica
app.get('/api/messages/:conversationId', (req, res) => {
    const { conversationId } = req.params;

    const sql = `
        SELECT id AS message_id, sender, message, sent_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY sent_at ASC;
    `;

    db.query(sql, [conversationId], (err, results) => {
        if (err) {
            console.error('❌ Error al obtener mensajes:', err.message);
            return res.status(500).json({ error: 'Error al obtener mensajes' });
        }
        res.json(results);
    });
});


// 📌 Endpoint to update the autoresponse value for a conversation
app.put('/api/conversations/:conversationId/autoresponse', (req, res) => {
    const { conversationId } = req.params;
    const { autoresponse } = req.body;
  
    // Validate that the autoresponse field is provided
    if (typeof autoresponse === 'undefined') {
      return res.status(400).json({ error: 'Missing autoresponse field in request body' });
    }
  
    const sql = 'UPDATE conversations SET autoresponse = ? WHERE id = ?';
    db.query(sql, [autoresponse, conversationId], (err, result) => {
      if (err) {
        console.error('❌ Error updating autoresponse:', err.message);
        return res.status(500).json({ error: 'Error updating autoresponse' });
      }
      res.status(200).json({ message: 'Autoresponse updated successfully' });
    });
  });


  
// 📌 Endpoint para agendar citas en la base de datos
app.post('/appointments', (req, res) => {
    const { phone_number, name, email, city, description, preferred_date, preferred_time, mode } = req.body;

    if (!phone_number || !name || !city || !description || !preferred_date || !preferred_time) {
        return res.status(400).send('Todos los campos obligatorios deben completarse');
    }

    const validCities = ['Barranquilla', 'Melbourne'];
    if (validCities.includes(city) && !['Presencial', 'Virtual'].includes(mode)) {
        return res.status(400).send('Debe especificar si la cita será Presencial o Virtual para esta ciudad');
    }

    const sql = `
        INSERT INTO appointments 
        (phone_number, name, email, city, description, preferred_date, preferred_time, mode) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [phone_number, name, email, city, description, preferred_date, preferred_time, mode], (err, result) => {
        if (err) {
            console.error('❌ Error al guardar la cita:', err.message);
            return res.status(500).send('Error al guardar la cita');
        }
        res.status(201).send({ message: '✅ Cita creada con éxito', id: result.insertId });
    });
});

// Manejo de SIGTERM para evitar cierre abrupto en Railway
process.on("SIGTERM", () => {
    console.log("🔻 Señal SIGTERM recibida. Cerrando servidor...");
    server.close(() => {
        console.log("✅ Servidor cerrado correctamente.");
        process.exit(0);
    });
});

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en el puerto ${PORT}`));
