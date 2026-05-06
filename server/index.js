const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Store connected users: { socketId: { username, publicKey } }
const users = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // When a user joins, they send their username and public key
  socket.on('join', ({ username, publicKey }) => {
    users[socket.id] = { username, publicKey, socketId: socket.id };
    
    // Broadcast updated user list to everyone
    io.emit('users-update', Object.values(users));
    console.log(`${username} joined with socket ${socket.id}`);
  });

  // Relay an encrypted private message
  socket.on('private-message', ({ to, ciphertext, nonce, fromUsername, messageId }) => {
    // Send to the specific socket
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
  socket.on('message-delivered', ({ to, messageId }) => {
    socket.to(to).emit('message-delivered', {
      from: socket.id,
      messageId,
    });
  });

  // Relay message read acknowledgment
  socket.on('message-read', ({ to, messageId }) => {
    socket.to(to).emit('message-read', {
      from: socket.id,
      messageId,
    });
  });

  // Relay message delete for everyone
  socket.on('message-delete-everyone', ({ to, messageId }) => {
    socket.to(to).emit('message-delete-everyone', {
      from: socket.id,
      messageId,
    });
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
