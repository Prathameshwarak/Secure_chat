const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://warakprathamesh27542754_db_user:hxwFvWsrASksDOKV@chathistory.syv6vb4.mongodb.net/?appName=chatHistory';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mongoose Schema
const messageSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true },
  senderUsername: { type: String, required: true },
  receiverUsername: { type: String, required: true },
  senderPublicKey: { type: String, required: true },
  receiverPublicKey: { type: String, required: true },
  ciphertext: { type: String, required: true },
  nonce: { type: String, required: true },
  timestamp: { type: Number, required: true },
  status: { type: String, default: 'sent' }, // sent, delivered, read
  isDeleted: { type: Boolean, default: false }
});

const Message = mongoose.model('Message', messageSchema);

// Store connected users: { socketId: { username, publicKey } }
const users = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // When a user joins, they send their username and public key
  socket.on('join', async ({ username, publicKey }) => {
    users[socket.id] = { username, publicKey, socketId: socket.id };
    
    // Broadcast updated user list to everyone
    io.emit('users-update', Object.values(users));
    console.log(`${username} joined with socket ${socket.id}`);

    // Send chat history to this user
    try {
      const history = await Message.find({
        $or: [
          { senderUsername: username },
          { receiverUsername: username }
        ]
      }).sort({ timestamp: 1 }); // chronological order
      socket.emit('chat-history', history);
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  });

  // Relay an encrypted private message
  socket.on('private-message', async ({ to, ciphertext, nonce, fromUsername, messageId }) => {
    const receiver = users[to];
    const receiverUsername = receiver ? receiver.username : null;
    const receiverPublicKey = receiver ? receiver.publicKey : null;
    
    const senderInfo = users[socket.id];
    const senderPublicKey = senderInfo ? senderInfo.publicKey : null;

    if (receiverUsername && receiverPublicKey && senderPublicKey) {
      try {
        const msg = new Message({
          messageId,
          senderUsername: fromUsername,
          receiverUsername,
          senderPublicKey,
          receiverPublicKey,
          ciphertext,
          nonce,
          timestamp: Date.now()
        });
        // Save to database in the background so it doesn't delay real-time delivery
        msg.save().catch(err => console.error('Error saving message:', err));
      } catch (err) {
        console.error('Error constructing message:', err);
      }
    }

    // Send to the specific socket immediately
    socket.to(to).emit('private-message', {
      from: socket.id,
      fromUsername,
      ciphertext,
      nonce,
      timestamp: Date.now(),
      messageId,
    });
  });

  // Relay message delivered acknowledgment
  socket.on('message-delivered', async ({ to, messageId }) => {
    // Update DB in background
    Message.updateOne({ messageId }, { status: 'delivered' }).catch(err => console.error(err));

    socket.to(to).emit('message-delivered', {
      from: socket.id,
      messageId,
    });
  });

  // Relay message read acknowledgment
  socket.on('message-read', async ({ to, messageId }) => {
    // Update DB in background
    Message.updateOne({ messageId }, { status: 'read' }).catch(err => console.error(err));

    socket.to(to).emit('message-read', {
      from: socket.id,
      messageId,
    });
  });

  // Relay message delete for everyone
  socket.on('message-delete-everyone', async ({ to, messageId }) => {
    // Update DB in background
    Message.updateOne({ messageId }, { isDeleted: true }).catch(err => console.error(err));

    if (to) {
      socket.to(to).emit('message-delete-everyone', {
        from: socket.id,
        messageId,
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (users[socket.id]) {
      delete users[socket.id];
      // Broadcast updated user list
      io.emit('users-update', Object.values(users));
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
