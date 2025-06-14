const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios'); // Para enviar solicitudes
const cors = require('cors'); // Para habilitar CORS
const multer = require('multer');
const mysql = require('mysql2'); // Para conectarse a la base de datos
const FormData = require('form-data'); // Add this import at the top of your file
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');


const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.json({ extended: true }));
app.use(express.urlencoded({ extended: true }));

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});


// Verifica la conexión a la base de datos
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error al conectar a la base de datos:', err.message);
    } else {
        console.log('✅ Conectado a la base de datos MySQL');
        connection.release(); // Liberar la conexión
    }
});

// Configuracion de Moodle 
const MOODLE_API_URL = process.env.MOODLE_API_URL;
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// Configure multer to store the file in memory

const storage = multer.memoryStorage();

const upload = multer({ storage }); // Esto es necesario
const xlsx = require('xlsx');

// Token de verificación whatsapp
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

const fs = require('fs');

const messageBuffer = {}; // Almacena temporalmente mensajes por userId
const WAIT_TIME = 20000; // 20 segundos

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

// // 📌 Endpoint para recibir mensajes de WhatsApp y enviarlos a Make (text, audio, image, document)
// app.post('/webhook', async (req, res) => {
//   console.log('Mensaje recibido en Webhook:', JSON.stringify(req.body, null, 2));
//   const body = req.body;

//   if (body.object) {
//       // Assume messages are in: body.entry[0].changes[0].value.messages
//       const messagesArray = body.entry?.[0]?.changes?.[0]?.value?.messages;

//       // Determine message type
//       let messageType = 'text'; // default
//       if (Array.isArray(messagesArray)) {
//           const firstMessage = messagesArray[0];
//           if (firstMessage) {
//               messageType = firstMessage.type;
//           }
//       }

//       // Choose target webhook URL based on message type
//       const webhookMap = {
//           'text': 'https://hook.eu2.make.com/ve2tavn6hjsvscq1t3q5y6jc0m47ee68',
//           'audio': 'https://hook.eu2.make.com/pch3avcjrya2et6gqol5vdoyh11txfrl',
//           'image': 'https://hook.eu2.make.com/smdk4pbh2txc94fdvj73mmpt3ehdxuj3',
//           'document': 'https://hook.eu2.make.com/smdk4pbh2txc94fdvj73mmpt3ehdxuj3'
//       };

//       // Default to text webhook if type is not recognized
//       const targetWebhook = webhookMap[messageType] || webhookMap['text'];

//       try {
//           const makeResponse = await axios.post(targetWebhook, body);
//           console.log('✅ Mensaje enviado a Make:', makeResponse.status, 'Webhook:', targetWebhook);
//       } catch (error) {
//           console.error('❌ Error al enviar mensaje a Make:', error.message);
//       }

//       res.status(200).send('EVENT_RECEIVED');
//   } else {
//       res.status(404).send('No encontrado');
//   }
// });

app.post('/webhook', async (req, res) => {
  console.log('Mensaje recibido en Webhook:', JSON.stringify(req.body, null, 2));
  const body = req.body;

  if (body.object) {
    const messagesArray = body.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!Array.isArray(messagesArray) || messagesArray.length === 0) {
      return res.status(400).send('No messages found');
    }

    const message = messagesArray[0];
    const messageType = message.type;
    const userId = message.from;

    // Función para enviar a Make y limpiar buffer
    const sendToMake = async (payload, webhookUrl) => {
      try {
        const makeResponse = await axios.post(webhookUrl, payload);
        console.log('✅ Mensaje enviado a Make:', makeResponse.status, 'Webhook:', webhookUrl);
      } catch (error) {
        console.error('❌ Error al enviar mensaje a Make:', error.message);
      }
    };

    // Webhooks por tipo
      const webhookMap = {
          'text': 'https://hook.eu2.make.com/ve2tavn6hjsvscq1t3q5y6jc0m47ee68',
          'audio': 'https://hook.eu2.make.com/pch3avcjrya2et6gqol5vdoyh11txfrl',
          'image': 'https://hook.eu2.make.com/smdk4pbh2txc94fdvj73mmpt3ehdxuj3',
          'document': 'https://hook.eu2.make.com/smdk4pbh2txc94fdvj73mmpt3ehdxuj3'
      };

    if (messageType === 'image') {
      // Si es imagen, guarda el mensaje en buffer y espera 20 seg para ver si llega texto relacionado
      messageBuffer[userId] = {
        imageMessage: message,
        textMessage: null,
        timeout: setTimeout(async () => {
          // Pasados 20 seg sin texto, enviar solo imagen sin caption
          const payload = {
            ...body,
            entry: [{
              ...body.entry[0],
              changes: [{
                ...body.entry[0].changes[0],
                value: {
                  ...body.entry[0].changes[0].value,
                  messages: [messageBuffer[userId].imageMessage]
                }
              }]
            }]
          };
          await sendToMake(payload, webhookMap['image']);
          delete messageBuffer[userId];
        }, WAIT_TIME)
      };
      return res.status(200).send('EVENT_RECEIVED');
    }

    if (messageType === 'text') {
      // Si hay imagen previa en buffer para este userId, combinamos el texto como caption y enviamos
      if (messageBuffer[userId] && messageBuffer[userId].imageMessage) {
        clearTimeout(messageBuffer[userId].timeout);

        // Modificamos el mensaje de imagen para agregar caption con el texto recibido
        const combinedImageMessage = {
          ...messageBuffer[userId].imageMessage,
          image: {
            ...messageBuffer[userId].imageMessage.image,
            caption: message.text.body
          }
        };

        const payload = {
          ...body,
          entry: [{
            ...body.entry[0],
            changes: [{
              ...body.entry[0].changes[0],
              value: {
                ...body.entry[0].changes[0].value,
                messages: [combinedImageMessage]
              }
            }]
          }]
        };

        await sendToMake(payload, webhookMap['image']);
        delete messageBuffer[userId];
        return res.status(200).send('EVENT_RECEIVED');
      } else {
        // No hay imagen previa, enviamos texto normalmente
        await sendToMake(body, webhookMap['text']);
        return res.status(200).send('EVENT_RECEIVED');
      }
    }

    // Para otros tipos (audio, documento) enviar normal sin buffer
    const targetWebhook = webhookMap[messageType] || webhookMap['text'];
    await sendToMake(body, targetWebhook);
    return res.status(200).send('EVENT_RECEIVED');
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

app.post('/send-audio', async (req, res) => {
  const { to, audioUrl } = req.body;

  if (!to || !audioUrl) {
    return res.status(400).send('Datos incompletos: se requiere "to" y "audioUrl"');
  }

  try {
    const data = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'audio',
      audio: {
        link: audioUrl
      }
    };

    const url = `https://graph.facebook.com/v21.0/559822483873940/messages`;

    const whatsappResponse = await axios.post(url, data, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Audio enviado a WhatsApp:', whatsappResponse.data);
    res.status(200).send('Audio enviado');
  } catch (error) {
    console.error('❌ Error al enviar audio a WhatsApp:', error.response ? error.response.data : error.message);
    res.status(500).send('Error al enviar audio');
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
    (SELECT message_type FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1) AS last_message_type,
    (SELECT sender FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1) AS last_message_sender,
    c.last_message_at
FROM conversations c
JOIN clients cl ON c.client_id = cl.id
ORDER BY c.last_message_at ASC;
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Error al obtener conversaciones:', err.message);
            return res.status(500).json({ error: 'Error al obtener conversaciones' });
        }
        res.json(results);
    });
});


app.get('/api/messages/:conversationId', (req, res) => {
    const { conversationId } = req.params;

    const sql = `
        SELECT 
            id AS message_id, 
            sender, 
            message_type,
            media_id,
            CASE 
              WHEN message_type = 'audio' THEN media_url 
              ELSE message 
            END AS message,
            sent_at
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


  // 📌 New Endpoint for fetching details of a single conversation
  app.get('/api/conversation-detail/:conversationId', (req, res) => {
    const { conversationId } = req.params;
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
      WHERE c.id = ?
    `;
    db.query(sql, [conversationId], (err, results) => {
      if (err) {
        console.error('❌ Error al obtener la conversación:', err.message);
        return res.status(500).json({ error: 'Error al obtener la conversación' });
      }
      if (results.length === 0) {
        return res.status(404).json({ error: 'Conversación no encontrada' });
      }
      res.json(results[0]);
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


 // Función para actualizar la URL en la base de datos
 async function updateMediaUrlInDatabase(mediaId, newUrl) {
    try {
      const [result] = await db.promise().execute(
        'UPDATE messages SET media_url = ? WHERE media_id = ?',
        [newUrl, mediaId]
      );
      console.log(`✅ URL actualizada para mediaId: ${mediaId}, filas afectadas: ${result.affectedRows}`);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('❌ Error al actualizar la URL en la base de datos:', error.message);
      throw error;
    }
  }
  
 // Endpoint para obtener la URL del audio a partir de su mediaId (primera vez)
app.get('/api/media-url/:mediaId', async (req, res) => {
    const { mediaId } = req.params;
    try {
      const response = await axios.get(`https://graph.facebook.com/v13.0/${mediaId}`, {
        params: { access_token: ACCESS_TOKEN }
      });
      // Simplemente devolvemos la URL, asumiendo que Make se encarga de guardarla
      res.json({ url: response.data.url });
    } catch (error) {
      console.error('❌ Error fetching media URL:', error.message);
      res.status(500).json({ error: 'Error fetching media URL' });
    }
  });

  // Endpoint para renovar una URL expirada
app.get('/api/renew-media-url/:mediaId', async (req, res) => {
    const { mediaId } = req.params;
    try {
      const response = await axios.get(`https://graph.facebook.com/v13.0/${mediaId}`, {
        params: { access_token: ACCESS_TOKEN }
      });
      
      // Actualizar la URL en la base de datos
      await updateMediaUrlInDatabase(mediaId, response.data.url);
      
      res.json({ url: response.data.url });
    } catch (error) {
      console.error('❌ Error renovando media URL:', error.message);
      res.status(500).json({ error: 'Error renovando media URL' });
    }
  });



  // Proxy endpoint para descargar la media y enviarla al frontend
app.get('/api/download-media', async (req, res) => {
    const { url, mediaId } = req.query; // URL del audio y mediaId almacenados en DB
    
    if (!url) {
      return res.status(400).json({ error: 'Se requiere URL' });
    }
    
    // Función para verificar si una respuesta es un archivo de audio válido
    const isValidAudioResponse = (response) => {
      const contentType = response.headers['content-type'] || '';
      // Verificar si el contentType comienza con audio/ o es application/octet-stream
      return contentType.startsWith('audio/') || contentType === 'application/octet-stream';
    };
    
    try {
      let audioResponse;
      let needNewUrl = false;
      
      // Intentar descargar con la URL existente
      try {
        audioResponse = await axios.get(url, { 
          responseType: 'arraybuffer',
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`
          }
        });
        
        // Verificar si la respuesta parece ser un archivo de audio válido
        if (!isValidAudioResponse(audioResponse)) {
          console.log('🔍 La respuesta no parece ser un archivo de audio válido');
          needNewUrl = true;
        }
      } catch (error) {
        console.log('🔄 Error con la URL original:', error.message);
        needNewUrl = true;
      }
      
      // Si necesitamos una nueva URL y tenemos el mediaId
      if (needNewUrl && mediaId) {
        console.log('🔄 Obteniendo una nueva URL para mediaId:', mediaId);
        
        try {
          // Obtener una nueva URL usando el mediaId
          const mediaResponse = await axios.get(`https://graph.facebook.com/v13.0/${mediaId}`, {
            params: { access_token: ACCESS_TOKEN }
          });
          
          const newUrl = mediaResponse.data.url;
          
          // Actualizar la URL en la base de datos
          await updateMediaUrlInDatabase(mediaId, newUrl);
          
          // Intentar la descarga con la nueva URL
          audioResponse = await axios.get(newUrl, { 
            responseType: 'arraybuffer',
            headers: {
              'Authorization': `Bearer ${ACCESS_TOKEN}`
            }
          });
          
          // Verificar nuevamente si parece un archivo de audio válido
          if (!isValidAudioResponse(audioResponse)) {
            throw new Error('La respuesta con la nueva URL tampoco es un archivo de audio válido');
          }
        } catch (refreshError) {
          console.error('❌ Error al obtener o usar la nueva URL:', refreshError.message);
          return res.status(500).json({ error: 'No se pudo obtener o usar una nueva URL para el archivo de audio' });
        }
      }
      
      // Si llegamos aquí, tenemos una respuesta válida
      const contentType = audioResponse.headers['content-type'] || 'audio/ogg';
      res.setHeader('Content-Type', contentType);
      return res.send(Buffer.from(audioResponse.data, 'binary'));
      
    } catch (error) {
      console.error('❌ Error fetching media:', error.message);
      res.status(500).json({ error: 'Error fetching media' });
    }
  });

// 📌 Endpoint para editar mensajes
app.put('/api/edit-message/:messageId', (req, res) => {
  const { messageId } = req.params;
  const { newMessage } = req.body;

  if (!messageId || newMessage === undefined) {
    return res.status(400).json({ error: 'Message ID and new message are required' });
  }

  const sql = 'UPDATE messages SET message = ? WHERE id = ?';
  db.query(sql, [newMessage, messageId], (err, result) => {
    if (err) {
      console.error('❌ Error al actualizar el mensaje en la base de datos:', err.message);
      return res.status(500).json({ error: 'Error al actualizar el mensaje en la base de datos' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Mensaje no encontrado o sin cambios' });
    }

    res.status(200).json({ 
      message: 'Mensaje actualizado correctamente',
      messageId: messageId,
      newContent: newMessage
    });
  });
});
// 📌 Endpoint para eliminar mensajes
app.delete('/api/delete-message/:messageId', (req, res) => {
  const { messageId } = req.params;

  if (!messageId) {
    return res.status(400).json({ error: 'Message ID is required' });
  }

  const sql = 'DELETE FROM messages WHERE id = ?';
  db.query(sql, [messageId], (err, result) => {
    if (err) {
      console.error('❌ Error al eliminar el mensaje en la base de datos:', err.message);
      return res.status(500).json({ error: 'Error al eliminar el mensaje en la base de datos' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }

    res.status(200).json({ 
      message: 'Mensaje eliminado correctamente',
      messageId: messageId
    });
  });
});


  // DASHBOARD //
/// Endpoint para obtener información del dashboard
app.get('/api/dashboard-info', (req, res) => {
    // Total de mensajes en la tabla de mensajes
    const queryTotalMessages = 'SELECT COUNT(*) AS total_mensajes FROM messages';
    // Mensajes enviados por Sharky
    const queryMessagesSharky = 'SELECT COUNT(*) AS mensajes_sharky FROM messages WHERE sender = "Sharky"';
    // Total de usuarios (clientes únicos) en conversaciones
    const queryTotalUsers = 'SELECT COUNT(DISTINCT client_id) AS total_usuarios FROM conversations';
    // Mensajes pendientes: conversaciones cuyo último mensaje no fue enviado por "Sharky"
    const queryPending = `
      SELECT COUNT(*) AS mensajes_pendientes
      FROM (
        SELECT c.id, 
          (SELECT sender FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1) AS last_message_sender
        FROM conversations c
      ) AS conv
      WHERE last_message_sender != 'Sharky'
    `;
    // Timeline global de mensajes recibidos (sender != "Sharky"), agrupados por fecha
    const queryTimeline = `
      SELECT DATE(sent_at) AS date, COUNT(*) AS count 
      FROM messages 
      WHERE sender != 'Sharky'
      GROUP BY DATE(sent_at)
      ORDER BY date ASC
    `;
  
    db.query(queryTotalMessages, (err, totalMessagesResult) => {
      if (err) {
        console.error('❌ Error al obtener total de mensajes:', err.message);
        return res.status(500).json({ error: 'Error al obtener total de mensajes' });
      }
      const total_mensajes = totalMessagesResult[0].total_mensajes;
  
      db.query(queryMessagesSharky, (err, messagesSharkyResult) => {
        if (err) {
          console.error('❌ Error al obtener mensajes de Sharky:', err.message);
          return res.status(500).json({ error: 'Error al obtener mensajes de Sharky' });
        }
        const mensajes_sharky = messagesSharkyResult[0].mensajes_sharky;
  
        db.query(queryTotalUsers, (err, totalUsersResult) => {
          if (err) {
            console.error('❌ Error al obtener total de usuarios:', err.message);
            return res.status(500).json({ error: 'Error al obtener total de usuarios' });
          }
          const total_usuarios = totalUsersResult[0].total_usuarios;
  
          db.query(queryPending, (err, pendingResult) => {
            if (err) {
              console.error('❌ Error al obtener mensajes pendientes:', err.message);
              return res.status(500).json({ error: 'Error al obtener mensajes pendientes' });
            }
            const mensajes_pendientes = pendingResult[0].mensajes_pendientes;
  
            db.query(queryTimeline, (err, timelineResult) => {
              if (err) {
                console.error('❌ Error al obtener timeline de mensajes:', err.message);
                return res.status(500).json({ error: 'Error al obtener timeline de mensajes' });
              }
              res.json({
                total_mensajes,
                mensajes_sharky,
                total_usuarios,
                mensajes_pendientes,
                timeline: timelineResult
              });
            });
          });
        });
      });
    });
  });
  

  // END DASHBOARD //

  // Endpoint to send media messages (documents or images) from the frontend
// Expected fields in the request body:
// - to: recipient phone number
// - mediaType: either "image" or "document"
// - caption: (optional) caption for the media message
// And a file uploaded with key "file"
// Endpoint to send media messages (documents or images) from the frontend
// Endpoint para enviar imágenes según la documentación oficial de WhatsApp
app.post('/api/send-media', upload.single('file'), async (req, res) => {
  try {
    console.log('📝 Solicitud para enviar media recibida');
    const { to, conversationId, caption = '', sender = 'Sharky' } = req.body;
    
    if (!to || !conversationId) {
      console.error('❌ Faltan campos requeridos: to y conversationId');
      return res.status(400).json({ error: 'Missing required fields: to and conversationId are required.' });
    }
    
    if (!req.file) {
      console.error('❌ No se encontró el archivo en la solicitud');
      return res.status(400).json({ error: 'No file was uploaded.' });
    }

    // Determinar el tipo de medio basado en MIME
    let mediaType = 'document';
    if (req.file.mimetype.startsWith('image/')) {
      mediaType = 'image';
    } else if (req.file.mimetype.startsWith('audio/')) {
      mediaType = 'audio';
    } else if (req.file.mimetype.startsWith('video/')) {
      mediaType = 'video';
    }
    
    console.log(`📤 Preparando para enviar ${mediaType} a ${to}`);
    
    // 1. Primero, cargar el archivo multimedia a la API de WhatsApp
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    
    console.log('📤 Subiendo media a WhatsApp API...');
    const mediaUploadUrl = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`;
    
    try {
      const mediaResponse = await axios.post(mediaUploadUrl, form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
      });
      
      if (!mediaResponse.data || !mediaResponse.data.id) {
        console.error('❌ La API de WhatsApp no devolvió un ID de media válido');
        return res.status(500).json({ error: 'Failed to upload media to WhatsApp.' });
      }
      
      const mediaId = mediaResponse.data.id;
      console.log(`✅ Media subido correctamente, ID: ${mediaId}`);
      
      // 2. Enviar el mensaje con el ID del multimedia
      const messagesUrl = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: mediaType
      };
      
      // Añadir el objeto de medio según el tipo
      payload[mediaType] = { 
        id: mediaId,
        caption: caption || ''
      };
      
      console.log(`📤 Enviando mensaje con ${mediaType}...`);
      
      const messageResponse = await axios.post(messagesUrl, payload, {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`✅ Mensaje con media enviado: ${JSON.stringify(messageResponse.data)}`);
      
      // 3. Obtener la URL del multimedia para acceder al contenido
      console.log(`🔍 Obteniendo URL para el media ID: ${mediaId}...`);
      const getMediaUrl = `https://graph.facebook.com/v18.0/${mediaId}`;
      const mediaUrlResponse = await axios.get(getMediaUrl, {
        params: { access_token: ACCESS_TOKEN }
      });
      
      if (!mediaUrlResponse.data || !mediaUrlResponse.data.url) {
        console.error('❌ No se pudo obtener la URL del media');
        return res.status(500).json({ error: 'Failed to get media URL from WhatsApp.' });
      }
      
      const mediaUrl = mediaUrlResponse.data.url;
      console.log(`✅ URL del media obtenida: ${mediaUrl.substring(0, 30)}...`);
      
      // 4. Guardar en la base de datos
      const sql = `
        INSERT INTO messages (conversation_id, sender, message_type, media_id, media_url, message, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
      `;
      
      db.query(sql, [conversationId, sender, mediaType, mediaId, mediaUrl, caption || ''], (err, result) => {
        if (err) {
          console.error(`❌ Error al guardar mensaje en la BD: ${err.message}`);
          return res.status(500).json({ error: 'Error al guardar mensaje en la base de datos' });
        }
        
        console.log(`✅ Mensaje con media guardado en BD, ID: ${result.insertId}`);
        
        // 5. Responder al cliente con la información necesaria
        res.status(200).json({
          message: `${mediaType} sent and stored successfully`,
          mediaId,
          mediaUrl,
          messageId: result.insertId
        });
      });
      
    } catch (apiError) {
      console.error('❌ Error en la API de WhatsApp:', 
                    apiError.response?.data ? JSON.stringify(apiError.response.data) : apiError.message);
      return res.status(apiError.response?.status || 500).json({
        error: 'Error with WhatsApp API',
        details: apiError.response?.data || apiError.message
      });
    }
    
  } catch (error) {
    console.error(`❌ Error general enviando media: ${error.message}`);
    res.status(500).json({ 
      error: 'Error sending media message', 
      details: error.message 
    });
  }
});

// Endpoint para obtener la URL de una imagen desde la base de datos o renovarla si ha expirado
app.get('/api/media-url/:mediaId', async (req, res) => {
  const { mediaId } = req.params;
  const forceRefresh = req.query.refresh === 'true';

  if (!mediaId) {
    return res.status(400).json({ error: 'Media ID is required' });
  }

  console.log(`🔍 Solicitud de URL para media: ${mediaId}${forceRefresh ? ' (forzando actualización)' : ''}`);

  try {
    // Buscar la URL y el tipo de mensaje en la base de datos
    const sql = 'SELECT media_url, message_type FROM messages WHERE media_id = ? LIMIT 1';
    db.query(sql, [mediaId], async (err, results) => {
      if (err) {
        console.error('❌ Error al obtener media_url:', err.message);
        return res.status(500).json({ error: 'Error al obtener media_url' });
      }

      if (results.length === 0) {
        console.error(`❌ Media ID ${mediaId} no encontrado en la base de datos`);
        return res.status(404).json({ error: 'Media not found in database' });
      }

      const mediaUrl = results[0].media_url;
      const messageType = results[0].message_type;
      
      console.log(`ℹ️ Media encontrado: ID=${mediaId}, Type=${messageType}, URL=${mediaUrl?.substring(0, 30)}...`);

      // Si no es una imagen o no tiene URL, solo devolver lo que hay
      if (messageType !== 'image') {
        console.log(`⚠️ Media ID ${mediaId} no es una imagen (tipo: ${messageType}). Retornando URL actual.`);
        return res.json({ mediaUrl });
      }

      // Verificar si debemos renovar la URL (sea porque está expirada o porque se fuerza la actualización)
      let needsRefresh = forceRefresh;
      
      if (!forceRefresh) {
        try {
          const response = await axios.head(mediaUrl);
          if (response.status === 200) {
            console.log(`✅ URL de imagen válida para ${mediaId}`);
            needsRefresh = false;
          } else {
            console.log(`⚠️ URL de imagen para ${mediaId} devolvió estado ${response.status}`);
            needsRefresh = true;
          }
        } catch (error) {
          console.log(`🔄 URL de imagen expirada para ${mediaId}, validación falló: ${error.message}`);
          needsRefresh = true;
        }
      }

      // Si necesitamos actualizar la URL, obtener una nueva desde la API de WhatsApp
      if (needsRefresh) {
        try {
          console.log(`🔄 Obteniendo nueva URL para ${mediaId} desde la API de WhatsApp...`);
          const mediaResponse = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
            params: { access_token: ACCESS_TOKEN }
          });

          if (!mediaResponse.data || !mediaResponse.data.url) {
            console.error(`❌ La API de WhatsApp no devolvió una URL válida para ${mediaId}`);
            return res.status(500).json({ error: 'No se pudo obtener una nueva URL desde WhatsApp' });
          }

          const newMediaUrl = mediaResponse.data.url;
          console.log(`🆕 Nueva URL obtenida para ${mediaId}: ${newMediaUrl.substring(0, 30)}...`);

          // Actualizar la URL en la base de datos
          const updateSql = 'UPDATE messages SET media_url = ? WHERE media_id = ?';
          db.query(updateSql, [newMediaUrl, mediaId], (updateErr) => {
            if (updateErr) {
              console.error(`❌ Error actualizando la media_url en la BD: ${updateErr.message}`);
            } else {
              console.log(`✅ URL actualizada en BD para ${mediaId}`);
            }
          });

          return res.json({ mediaUrl: newMediaUrl });
        } catch (error) {
          console.error(`❌ Error obteniendo la nueva media URL: ${error.message}`);
          return res.status(500).json({ error: 'Error obteniendo la nueva media URL' });
        }
      } else {
        // Devolver la URL actual si sigue siendo válida
        return res.json({ mediaUrl });
      }
    });
  } catch (error) {
    console.error(`❌ Error en el endpoint: ${error.message}`);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint proxy para descargar imágenes desde WhatsApp
app.get('/api/download-image/:mediaId', async (req, res) => {
  const { mediaId } = req.params;
  
  if (!mediaId) {
    return res.status(400).json({ error: 'Media ID is required' });
  }
  
  console.log(`🔍 Solicitud para descargar imagen con ID: ${mediaId}`);
  
  try {
    // 1. Primero obtener la URL desde WhatsApp API o la base de datos
    const sql = 'SELECT media_url, message_type FROM messages WHERE media_id = ? LIMIT 1';
    db.query(sql, [mediaId], async (err, results) => {
      if (err) {
        console.error('❌ Error al obtener media_url:', err.message);
        return res.status(500).json({ error: 'Error al obtener media_url' });
      }

      if (results.length === 0) {
        console.error(`❌ Media ID ${mediaId} no encontrado en la base de datos`);
        return res.status(404).json({ error: 'Media not found in database' });
      }

      let mediaUrl = results[0].media_url;
      const messageType = results[0].message_type;
      
      if (messageType !== 'image') {
        return res.status(400).json({ error: 'El media ID no corresponde a una imagen' });
      }
      
      // Verificar si la URL ha expirado
      let needsRefresh = false;
      try {
        const response = await axios.head(mediaUrl, {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`
          }
        });
        if (response.status !== 200) {
          needsRefresh = true;
        }
      } catch (error) {
        console.log(`🔄 URL de imagen expirada, obteniendo nueva...`);
        needsRefresh = true;
      }
      
      // Si la URL expiró, obtener una nueva
      if (needsRefresh) {
        try {
          const mediaResponse = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
            params: { access_token: ACCESS_TOKEN }
          });
          
          if (!mediaResponse.data || !mediaResponse.data.url) {
            return res.status(500).json({ error: 'No se pudo obtener la URL de la imagen' });
          }
          
          mediaUrl = mediaResponse.data.url;
          
          // Actualizar la URL en la base de datos
          const updateSql = 'UPDATE messages SET media_url = ? WHERE media_id = ?';
          db.query(updateSql, [mediaUrl, mediaId], (updateErr) => {
            if (updateErr) {
              console.error(`❌ Error actualizando la media_url: ${updateErr.message}`);
            } else {
              console.log(`✅ URL actualizada en BD para ${mediaId}`);
            }
          });
        } catch (error) {
          console.error(`❌ Error obteniendo la nueva media URL: ${error.message}`);
          return res.status(500).json({ error: 'Error obteniendo la nueva media URL' });
        }
      }
      
      // 2. Descargar la imagen desde WhatsApp
      try {
        console.log(`📥 Descargando imagen desde URL: ${mediaUrl.substring(0, 30)}...`);
        const imageResponse = await axios.get(mediaUrl, {
          responseType: 'arraybuffer',
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`
          }
        });
        
        // 3. Determinar el tipo de contenido (MIME type)
        const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
        
        // 4. Enviar la imagen al frontend
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'max-age=300'); // Caché de 5 minutos
        return res.send(Buffer.from(imageResponse.data, 'binary'));
        
      } catch (error) {
        console.error(`❌ Error descargando la imagen: ${error.message}`);
        return res.status(500).json({ error: 'Error descargando la imagen' });
      }
    });
  } catch (error) {
    console.error(`❌ Error general: ${error.message}`);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint proxy para descargar documentos desde WhatsApp
app.get('/api/download-document/:mediaId', async (req, res) => {
  const { mediaId } = req.params;
  
  if (!mediaId) {
    return res.status(400).json({ error: 'Media ID is required' });
  }
  
  console.log(`🔍 Solicitud para descargar documento con ID: ${mediaId}`);
  
  try {
    // 1. Primero obtener la URL y el tipo de documento desde la base de datos
    const sql = 'SELECT media_url, message_type, message AS file_name FROM messages WHERE media_id = ? LIMIT 1';
    db.query(sql, [mediaId], async (err, results) => {
      if (err) {
        console.error('❌ Error al obtener media_url:', err.message);
        return res.status(500).json({ error: 'Error al obtener media_url' });
      }

      if (results.length === 0) {
        console.error(`❌ Media ID ${mediaId} no encontrado en la base de datos`);
        return res.status(404).json({ error: 'Media not found in database' });
      }

      let mediaUrl = results[0].media_url;
      const messageType = results[0].message_type;
      // Usar el campo message como nombre del archivo si está disponible
      const fileName = results[0].file_name || `document-${mediaId}.pdf`;
      
      if (messageType !== 'document') {
        return res.status(400).json({ error: 'El media ID no corresponde a un documento' });
      }
      
      // Verificar si la URL ha expirado
      let needsRefresh = false;
      try {
        const response = await axios.head(mediaUrl, {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`
          }
        });
        if (response.status !== 200) {
          needsRefresh = true;
        }
      } catch (error) {
        console.log(`🔄 URL de documento expirada, obteniendo nueva...`);
        needsRefresh = true;
      }
      
      // Si la URL expiró, obtener una nueva
      if (needsRefresh) {
        try {
          const mediaResponse = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
            params: { access_token: ACCESS_TOKEN }
          });
          
          if (!mediaResponse.data || !mediaResponse.data.url) {
            return res.status(500).json({ error: 'No se pudo obtener la URL del documento' });
          }
          
          mediaUrl = mediaResponse.data.url;
          
          // Actualizar la URL en la base de datos
          const updateSql = 'UPDATE messages SET media_url = ? WHERE media_id = ?';
          db.query(updateSql, [mediaUrl, mediaId], (updateErr) => {
            if (updateErr) {
              console.error(`❌ Error actualizando la media_url: ${updateErr.message}`);
            } else {
              console.log(`✅ URL actualizada en BD para ${mediaId}`);
            }
          });
        } catch (error) {
          console.error(`❌ Error obteniendo la nueva media URL: ${error.message}`);
          return res.status(500).json({ error: 'Error obteniendo la nueva media URL' });
        }
      }
      
      // 2. Descargar el documento desde WhatsApp
      try {
        console.log(`📥 Descargando documento desde URL: ${mediaUrl.substring(0, 30)}...`);
        const documentResponse = await axios.get(mediaUrl, {
          responseType: 'arraybuffer',
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`
          }
        });
        
        // 3. Determinar el tipo de contenido (MIME type)
        // Si el nombre del archivo contiene una extensión, intentar determinar el MIME type basado en eso
        let contentType = 'application/octet-stream'; // Default
        
        if (fileName.endsWith('.pdf')) {
          contentType = 'application/pdf';
        } else if (fileName.endsWith('.doc')) {
          contentType = 'application/msword';
        } else if (fileName.endsWith('.docx')) {
          contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (fileName.endsWith('.xls')) {
          contentType = 'application/vnd.ms-excel';
        } else if (fileName.endsWith('.xlsx')) {
          contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        } else if (fileName.endsWith('.ppt')) {
          contentType = 'application/vnd.ms-powerpoint';
        } else if (fileName.endsWith('.pptx')) {
          contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        } else {
          // Intentar determinar a partir de headers de respuesta
          contentType = documentResponse.headers['content-type'] || contentType;
        }
        
        // 4. Enviar el documento al frontend
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Cache-Control', 'max-age=300'); // Caché de 5 minutos
        return res.send(Buffer.from(documentResponse.data, 'binary'));
        
      } catch (error) {
        console.error(`❌ Error descargando el documento: ${error.message}`);
        return res.status(500).json({ error: 'Error descargando el documento' });
      }
    });
  } catch (error) {
    console.error(`❌ Error general: ${error.message}`);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
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


// MOODLE // 

// MOODLE - Obtener usuarios con autenticación manual
app.get('/api/moodle/users', async (req, res) => {
  try {
    const formData = new URLSearchParams();
    formData.append('wstoken', MOODLE_TOKEN); // Asegúrate de tener esta constante configurada
    formData.append('wsfunction', 'core_user_get_users');
    formData.append('moodlewsrestformat', 'json');
    formData.append('criteria[0][key]', 'auth');
    formData.append('criteria[0][value]', 'manual');

    const response = await axios.post(MOODLE_API_URL, formData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios de Moodle:', error.message);
    res.status(500).send('Error al obtener usuarios');
  }
});

// Endpoint para crear un nuevo usuario en Moodle
app.post('/api/moodle/users', async (req, res) => {
  const { username, password, firstname, lastname, email } = req.body;

  if (!username || !password || !firstname || !lastname || !email) {
    return res.status(400).send('Faltan campos obligatorios');
  }

  try {
    const formData = new URLSearchParams();
    formData.append('wstoken', MOODLE_TOKEN);
    formData.append('wsfunction', 'core_user_create_users');
    formData.append('moodlewsrestformat', 'json');
    formData.append('users[0][username]', username);
    formData.append('users[0][password]', password);
    formData.append('users[0][firstname]', firstname);
    formData.append('users[0][lastname]', lastname);
    formData.append('users[0][email]', email);
    formData.append('users[0][auth]', 'manual');

    const response = await axios.post(MOODLE_API_URL, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    res.json(response.data);
  } catch (error) {
    console.error('❌ Error creando usuario:', error.response?.data || error.message);
    res.status(500).send('Error al crear usuario');
  }
});

// 📌 Endpoint para actualizar estudiante en Moodle
app.put('/api/moodle/students/:id/update', async (req, res) => {
  const studentId = req.params.id;
  const { moodleUserId, firstname, lastname, email } = req.body;

  // Validar datos requeridos
  if (!moodleUserId || !firstname || !lastname || !email) {
    return res.status(400).json({ 
      error: 'Datos incompletos', 
      message: 'Se requieren moodleUserId, firstname, lastname y email' 
    });
  }

  try {
    // Construir los datos para la API de Moodle
    const formData = new URLSearchParams();
    formData.append('wstoken', MOODLE_TOKEN);
    formData.append('wsfunction', 'core_user_update_users');
    formData.append('moodlewsrestformat', 'json');
    formData.append('users[0][id]', moodleUserId);
    formData.append('users[0][firstname]', firstname);
    formData.append('users[0][lastname]', lastname);
    formData.append('users[0][email]', email);
    
    console.log(`🔄 Actualizando usuario de Moodle ID=${moodleUserId} para estudiante ID=${studentId}`);
    
    // Llamar a la API de Moodle
    const response = await axios.post(MOODLE_API_URL, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    
    // Verificar respuesta (core_user_update_users devuelve null cuando es exitoso)
    // Moodle solo retorna errores si hay problemas
    if (response.data === null || (Array.isArray(response.data) && response.data.length === 0)) {
      console.log(`✅ Usuario de Moodle actualizado correctamente: ${moodleUserId}`);
      
      // Opcionalmente, actualizar el campo moodle_user_id en la tabla students si no existía
      try {
        await db.promise().query(
          'UPDATE students SET moodle_user_id = ? WHERE id = ? AND (moodle_user_id IS NULL OR moodle_user_id != ?)',
          [moodleUserId, studentId, moodleUserId]
        );
      } catch (dbError) {
        // Solo log, no afecta el éxito de la operación principal
        console.error('Error actualizando moodle_user_id en students:', dbError.message);
      }
      
      res.json({ 
        success: true, 
        message: 'Usuario actualizado correctamente en Moodle'
      });
    } else {
      console.error('❌ Respuesta inesperada de Moodle:', response.data);
      res.status(500).json({
        error: 'Respuesta inesperada de Moodle',
        details: response.data
      });
    }
  } catch (error) {
    console.error('❌ Error actualizando usuario en Moodle:', 
      error.response?.data ? JSON.stringify(error.response.data) : error.message);
    
    res.status(500).json({
      error: 'Error al actualizar usuario en Moodle',
      details: error.response?.data || error.message
    });
  }
});

app.post('/api/moodle/enrol', async (req, res) => {
  const { userId, courseId, roleId = 5 } = req.body; // 5 = student

  if (!userId || !courseId) {
    return res.status(400).send('Faltan userId o courseId');
  }

  try {
    const formData = new URLSearchParams();
    formData.append('wstoken', MOODLE_TOKEN);
    formData.append('wsfunction', 'enrol_manual_enrol_users');
    formData.append('moodlewsrestformat', 'json');
    formData.append('enrolments[0][roleid]', roleId);
    formData.append('enrolments[0][userid]', userId);
    formData.append('enrolments[0][courseid]', courseId);

    const response = await axios.post(MOODLE_API_URL, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    res.json({ message: 'Usuario inscrito correctamente', response: response.data });
  } catch (error) {
    console.error('❌ Error inscribiendo usuario:', error.message);
    res.status(500).send('Error al inscribir usuario');
  }
});

// 📌 Crear estudiante en Moodle desde base de datos interna
app.post('/api/moodle/students/:id/create', async (req, res) => {
  const studentId = req.params.id;

  try {
    // 1. Obtener los datos del estudiante de nuestra base de datos
    const [results] = await db.promise().query('SELECT * FROM students WHERE id = ?', [studentId]);
    if (results.length === 0) return res.status(404).send('Estudiante no encontrado');

    const student = results[0];
    
    // 2. Generar nombre de usuario único basado en email + ID
    // Sanitizamos el nombre de usuario eliminando caracteres especiales
    const username = student.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '') + studentId;
    
    // 3. Generar contraseña según el patrón: primer nombre + número de identificación + *
    // Sanitizamos el nombre para usarlo como parte de la contraseña (quitamos espacios y acentos)
    const sanitizedFirstName = student.first_name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Eliminar acentos
      .replace(/\s+/g, "")             // Eliminar espacios
      .replace(/[^a-zA-Z0-9]/g, "");   // Mantener solo alfanuméricos
    
    // Aseguramos que haya al menos un carácter del nombre y agregamos la identificación + *
    const password = (sanitizedFirstName.charAt(0).toUpperCase() + sanitizedFirstName.substring(1).toLowerCase() || "User") + 
                    student.identification_number + "*";
    
    // 4. Construir los datos para la API de Moodle
    const formData = new URLSearchParams();
    formData.append('wstoken', MOODLE_TOKEN);
    formData.append('wsfunction', 'core_user_create_users');
    formData.append('moodlewsrestformat', 'json');
    formData.append('users[0][username]', username);
    formData.append('users[0][password]', password);
    formData.append('users[0][firstname]', student.first_name);
    formData.append('users[0][lastname]', student.last_name || ' ');
    formData.append('users[0][email]', student.email);
    formData.append('users[0][auth]', 'manual');
    
    // 5. Llamar a la API de Moodle
    console.log(`🔄 Creando usuario ${username} en Moodle...`);
    
    const response = await axios.post(MOODLE_API_URL, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    
    // 6. Verificar respuesta
    if (Array.isArray(response.data) && response.data.length > 0 && response.data[0].id) {
      console.log(`✅ Usuario Moodle creado: ID=${response.data[0].id}, Username=${username}`);
      
      // 7. Opcionalmente, actualizar la base de datos para guardar el ID de Moodle
      // await db.promise().query(
      //   'UPDATE students SET moodle_user_id = ? WHERE id = ?', 
      //   [response.data[0].id, studentId]
      // );
      
      // 8. Devolver éxito con datos
      res.json({
        moodleResponse: {
          id: response.data[0].id,
          username: username
        },
        password: password
      });
    } else {
      console.error('❌ Respuesta inesperada de Moodle:', response.data);
      res.status(500).json({
        error: 'Respuesta inesperada de Moodle',
        details: response.data
      });
    }
  } catch (error) {
    console.error('❌ Error creando estudiante en Moodle:', 
      error.response?.data ? JSON.stringify(error.response.data) : error.message);
    
    res.status(500).json({
      error: 'Error al crear estudiante en Moodle',
      details: error.response?.data || error.message
    });
  }
});

// 📌 Obtener detalles de un usuario específico de Moodle
app.get('/api/moodle/users/:id', async (req, res) => {
  const moodleUserId = req.params.id;
  
  if (!moodleUserId) {
    return res.status(400).json({ error: 'Se requiere ID de usuario de Moodle' });
  }

  try {
    // Construir la solicitud para obtener detalles del usuario específico
    const formData = new URLSearchParams();
    formData.append('wstoken', MOODLE_TOKEN);
    formData.append('wsfunction', 'core_user_get_users_by_field');
    formData.append('moodlewsrestformat', 'json');
    formData.append('field', 'id');
    formData.append('values[0]', moodleUserId);

    // Realizar la llamada a la API de Moodle
    console.log(`🔍 Obteniendo detalles para usuario de Moodle ID=${moodleUserId}`);
    
    const response = await axios.post(MOODLE_API_URL, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // Verificar la respuesta
    if (Array.isArray(response.data) && response.data.length > 0) {
      // Buscamos si tenemos un estudiante asociado en nuestra base de datos
      // (por correo electrónico)
      const moodleUser = response.data[0];
      
      if (moodleUser.email) {
        try {
          const [students] = await db.promise().query(
            'SELECT id, first_name, last_name FROM students WHERE email = ?', 
            [moodleUser.email]
          );
          
          if (students.length > 0) {
            // Añadir información del estudiante a la respuesta
            moodleUser.linkedStudent = {
              id: students[0].id,
              first_name: students[0].first_name,
              last_name: students[0].last_name
            };
            
            // Opcionalmente, actualizar el moodle_user_id en la tabla students si no existe
            try {
              await db.promise().query(
                'UPDATE students SET moodle_user_id = ? WHERE id = ? AND (moodle_user_id IS NULL OR moodle_user_id != ?)',
                [moodleUserId, students[0].id, moodleUserId]
              );
            } catch (dbUpdateError) {
              // Solo log, no afecta la respuesta principal
              console.error('Error actualizando moodle_user_id:', dbUpdateError.message);
            }
          }
        } catch (dbError) {
          console.error('Error buscando estudiante asociado:', dbError.message);
          // Continuamos sin la información de estudiante vinculado
        }
      }
      
      res.json(moodleUser);
    } else if (Array.isArray(response.data) && response.data.length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado en Moodle' });
    } else {
      console.error('❌ Respuesta inesperada de Moodle:', response.data);
      res.status(500).json({
        error: 'Respuesta inesperada de Moodle',
        details: response.data
      });
    }
  } catch (error) {
    console.error('❌ Error obteniendo usuario de Moodle:', 
      error.response?.data ? JSON.stringify(error.response.data) : error.message);
    
    res.status(500).json({
      error: 'Error al obtener usuario de Moodle',
      details: error.response?.data || error.message
    });
  }
});


// SIMULACIONES DE WP // 

app.get('/api/whatsapp-accounts', (req, res) => {
  res.json([
    {
      id: 1,
      number: '0405034804',
      status: 'Verificado',
      created_at: '2024-10-01',
      wa_link: 'https://wa.me/message/M3Q2BGINBFE3P1',
      meta_api: true,
      connected: true
    }
  ]);
});



// 📌 Cargar archivo Excel y registrar clientes

app.post('/api/clients/upload-excel', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se ha enviado ningún archivo' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Lleva la cuenta de cuántos inserts quedan por terminar
    let pending = 0;
    let errorOnInsert = null;

    // Si no hay nada, termina
    if (!data.length) return res.json({ message: 'Archivo vacío o sin datos.' });

    data.forEach((row) => {
      const { name, phone_number, email } = row;
      if (!name || !phone_number) return;

      pending++;
      db.query(
        'INSERT INTO clients (name, phone_number, email) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE updated_at = NOW()',
        [name, phone_number, email || null],
        (err, result) => {
          pending--;
          if (err && !errorOnInsert) {
            errorOnInsert = err;
          }
          if (pending === 0) {
            if (errorOnInsert) {
              return res.status(500).json({ error: 'Error insertando clientes', details: errorOnInsert.message });
            }
            return res.json({ message: 'Clientes cargados exitosamente' });
          }
        }
      );
    });

    // Si no hubo ningún row válido
    if (pending === 0) {
      return res.json({ message: 'No se encontró ningún cliente válido en el archivo.' });
    }
  } catch (error) {
    console.error('❌ Error al procesar Excel:', error.message);
    res.status(500).json({ error: 'Error al procesar el archivo Excel' });
  }
});

// 📌 Envío masivo de texto y registro en BD (estructura original)
app.post('/api/whatsapp/bulk-send', async (req, res) => {
  const { message, clientIds = [] } = req.body;  // ← IDs recibidos del frontend

  if (!message) {
    return res.status(400).json({ error: 'El mensaje es requerido' });
  }

  try {
    /* 1️⃣  Obtener destinatarios */
    const [clients] = await db
      .promise()
      .query(
        clientIds.length
          ? 'SELECT id, phone_number FROM clients WHERE id IN (?) AND phone_number IS NOT NULL'
          : 'SELECT id, phone_number FROM clients WHERE phone_number IS NOT NULL LIMIT 10',
        clientIds.length ? [clientIds] : []
      );

    if (!clients.length) {
      return res.json({ message: 'No hay clientes a quienes enviar.' });
    }

    /* 2️⃣  Enviar mensajes en paralelo */
    const results = await Promise.all(
      clients.map(({ id, phone_number }) => {
        const payload = {
          messaging_product: 'whatsapp',
          to: phone_number,
          type: 'text',
          text: { body: message }
        };
        const url = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;

        return axios
          .post(url, payload, {
            headers: {
              Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            }
          })
          .then(async () => {
            // Guardar SOLO si el envío fue exitoso
            await db
              .promise()
              .query(
                `INSERT INTO messages (conversation_id, sender, message, sent_at)
                 VALUES (?, 'Sharky', ?, NOW())`,
                [id, message]
              );
            return { ok: true, phone_number };
          })
          .catch(err => ({
            ok: false,
            phone_number,
            error: err.message
          }));
      })
    );

    /* 3️⃣  Preparar respuesta */
    const sentTo = results.filter(r => r.ok).map(r => r.phone_number);
    const errors = results.filter(r => !r.ok);

    return errors.length
      ? res.status(207).json({
          message: 'Algunos mensajes fallaron',
          sentTo,
          errors
        })
      : res.json({
          message: `Mensaje enviado a ${sentTo.length} clientes`,
          recipients: sentTo
        });

  } catch (err) {
    console.error('❌ bulk-send error:', err);
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});



// 📌 Endpoint para obtener todos los clientes
// ✅ Método clásico: funciona con 'mysql2'
app.get('/api/clients', (req, res) => {
  db.query('SELECT id, name, phone_number, email FROM clients', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Error getting clients', error: err });
    }
    res.json({ success: true, clients: rows });
  });
});



// ESTUDIANTES EN BASE DE DATOS INTERNA //

// GET: Obtener todos los estudiantes
// 📌 GET: Obtener todos los estudiantes
app.get('/students', async (req, res) => {
  try {
    const [students] = await db.promise().query('SELECT * FROM students ORDER BY created_at DESC');
    res.json(students);
  } catch (err) {
    console.error('❌ Error al obtener estudiantes:', err.message);
    res.status(500).send('Error al obtener estudiantes');
  }
});

// 📌 GET: Obtener un estudiante por ID
app.get('/students/:id', async (req, res) => {
  try {
    const [student] = await db.promise().query('SELECT * FROM students WHERE id = ?', [req.params.id]);
    if (student.length === 0) return res.status(404).send('Estudiante no encontrado');
    res.json(student[0]);
  } catch (err) {
    console.error('❌ Error al obtener estudiante:', err.message);
    res.status(500).send('Error al obtener estudiante');
  }
});

// 📌 POST: Crear nuevo estudiante
app.post('/students', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      identification_type,
      identification_number,
      email,
      phone,
      gender,
      birth_date,
      address,
      city,
      department,
      country
    } = req.body;

    const [result] = await db.promise().query(
      `INSERT INTO students (
        first_name, last_name, identification_type, identification_number,
        email, phone, gender, birth_date, address, city, department, country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        first_name, last_name, identification_type, identification_number,
        email, phone, gender, birth_date, address, city, department, country
      ]
    );

    res.status(201).json({ id: result.insertId, message: 'Estudiante creado correctamente' });
  } catch (err) {
    console.error('❌ Error al crear estudiante:', err.message);
    res.status(500).send('Error al crear estudiante');
  }
});

// 📌 PUT: Actualizar estudiante
app.put('/students/:id', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      identification_type,
      identification_number,
      email,
      phone,
      gender,
      birth_date,
      address,
      city,
      department,
      country
    } = req.body;

    await db.promise().query(
      `UPDATE students SET
        first_name = ?, last_name = ?, identification_type = ?, identification_number = ?,
        email = ?, phone = ?, gender = ?, birth_date = ?, address = ?, city = ?, department = ?, country = ?
      WHERE id = ?`,
      [
        first_name, last_name, identification_type, identification_number,
        email, phone, gender, birth_date, address, city, department, country,
        req.params.id
      ]
    );

    res.json({ message: 'Estudiante actualizado correctamente' });
  } catch (err) {
    console.error('❌ Error al actualizar estudiante:', err.message);
    res.status(500).send('Error al actualizar estudiante');
  }
});

// 📌 DELETE: Eliminar estudiante
app.delete('/students/:id', async (req, res) => {
  try {
    await db.promise().query('DELETE FROM students WHERE id = ?', [req.params.id]);
    res.json({ message: 'Estudiante eliminado correctamente' });
  } catch (err) {
    console.error('❌ Error al eliminar estudiante:', err.message);
    res.status(500).send('Error al eliminar estudiante');
  }
});


//----------------------//
// CRM FUNCIONES NUEVAS //
//----------------------// 

// Endpoint que recibe el redirect de Facebook OAuth
app.get('/auth/facebook/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send('Missing code from Facebook');
  }

  try {
    // 1. Intercambia el code por un access_token
    const tokenRes = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: {
        client_id: process.env.FB_APP_ID,
        redirect_uri: 'https://crm.sharkagency.co/auth/facebook/callback', // debe ser idéntico al configurado en Facebook Developer
        client_secret: process.env.FB_APP_SECRET,
        code,
      },
    });

    const access_token = tokenRes.data.access_token;

    // 2. Obtiene el perfil básico del usuario que autorizó
    const profileRes = await axios.get('https://graph.facebook.com/v23.0/me', {
      params: {
        access_token,
        fields: 'id,name,email'
      }
    });
    const facebookProfile = profileRes.data;

    // 3. Guarda aquí el access_token y el usuario en tu base de datos (puedes implementar esta función)
    // Este código va dentro del try, después de obtener 'facebookProfile' y 'access_token'
const { id: facebook_id, name, email } = facebookProfile;
const access_token_str = access_token; // Ya lo tienes del paso anterior

// Si tienes la info de company_id la puedes pasar aquí, si no, pon NULL o asígnala después.
const company_id = null;

// Guarda (o actualiza si ya existe) el usuario en la base de datos
db.query(
  `INSERT INTO users (company_id, facebook_id, name, email, access_token, updated_at)
   VALUES (?, ?, ?, ?, ?, NOW())
   ON DUPLICATE KEY UPDATE
     name = VALUES(name),
     email = VALUES(email),
     access_token = VALUES(access_token),
     updated_at = NOW()`,
  [company_id, facebook_id, name, email, access_token_str],
  (err, result) => {
    if (err) {
      console.error('❌ Error guardando usuario en DB:', err.message);
      // Puedes responder error o continuar según tu flujo
    } else {
      console.log('✅ Usuario guardado/actualizado en DB:', facebook_id);
      // Aquí puedes hacer el resto de tu flujo
    }
  }
);


    // 4. Redirige al frontend con los datos básicos (en la práctica, deberías enviar solo un token tuyo y guardar el resto en tu backend)
    // Por simplicidad aquí mando todo por query params, pero lo recomendable es guardar el token en backend y usar sesiones seguras
    return res.redirect(
      `https://crm.sharkagency.co/success?fb_token=${encodeURIComponent(access_token)}&fb_id=${facebookProfile.id}&name=${encodeURIComponent(facebookProfile.name)}`
    );
  } catch (error) {
    console.error(error.response?.data || error.message);
    return res.status(500).send('Error authenticating with Facebook');
  }
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
