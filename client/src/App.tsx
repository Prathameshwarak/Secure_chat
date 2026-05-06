import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Lock, Send, User, MessageSquare, ShieldCheck, Check, CheckCheck, Trash2, Ban, ArrowLeft } from 'lucide-react';
import { generateKeyPair, encryptMessage, decryptMessage } from './encryption';
import { encodeBase64 } from 'tweetnacl-util';
import './index.css';

interface UserData {
  socketId: string;
  username: string;
  publicKey: string;
}

interface Message {
  id: string;
  text: string;
  isMine: boolean;
  timestamp: number;
  status?: 'sent' | 'delivered' | 'read' | 'received';
  isDeleted?: boolean;
}

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [username, setUsername] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  
  const [keyPair, setKeyPair] = useState<nacl.BoxKeyPair | null>(null);
  
  const [users, setUsers] = useState<UserData[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [inputText, setInputText] = useState('');
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [activeDeleteMenu, setActiveDeleteMenu] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedUserId]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    // Generate E2EE keys on login
    const keys = generateKeyPair();
    setKeyPair(keys);

    const newSocket = io(SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join', {
        username,
        publicKey: encodeBase64(keys.publicKey),
      });
      setIsJoined(true);
    });

    newSocket.on('users-update', (updatedUsers: UserData[]) => {
      setUsers(updatedUsers);
    });
  };

  const usersRef = useRef<UserData[]>(users);
  usersRef.current = users;
  
  const selectedUserIdRef = useRef<string | null>(selectedUserId);
  selectedUserIdRef.current = selectedUserId;

  useEffect(() => {
    if (!socket || !keyPair) return;

    const handlePrivateMessage = ({ from, fromUsername, ciphertext, nonce, timestamp, messageId }: any) => {
      const currentUsers = usersRef.current;
      const sender = currentUsers.find((u) => u.socketId === from);
      
      if (sender) {
        const decryptedText = decryptMessage(
          ciphertext,
          nonce,
          sender.publicKey,
          keyPair.secretKey
        );

        if (decryptedText) {
          const isSelected = selectedUserIdRef.current === from;
          
          setMessages((prev) => {
            const userMessages = prev[from] || [];
            return {
              ...prev,
              [from]: [
                ...userMessages,
                { id: messageId || Math.random().toString(), text: decryptedText, isMine: false, timestamp, status: 'received' },
              ],
            };
          });
          
          if (!isSelected) {
            setUnreadCounts((prev) => ({
              ...prev,
              [from]: (prev[from] || 0) + 1,
            }));
            socket.emit('message-delivered', { to: from, messageId });
          } else {
            socket.emit('message-read', { to: from, messageId });
          }
        } else {
          console.error('Failed to decrypt message from', fromUsername);
        }
      }
    };

    const handleMessageDelivered = ({ from, messageId }: any) => {
      setMessages((prev) => {
        const userMsgs = prev[from];
        if (!userMsgs) return prev;
        return {
          ...prev,
          [from]: userMsgs.map(m => (m.id === messageId && m.status !== 'read') ? { ...m, status: 'delivered' } : m)
        };
      });
    };

    const handleMessageRead = ({ from, messageId }: any) => {
      setMessages((prev) => {
        const userMsgs = prev[from];
        if (!userMsgs) return prev;
        return {
          ...prev,
          [from]: userMsgs.map(m => m.id === messageId ? { ...m, status: 'read' } : m)
        };
      });
    };

    const handleDeleteEveryone = ({ from, messageId }: any) => {
      setMessages((prev) => {
        const userMsgs = prev[from];
        if (!userMsgs) return prev;
        const senderName = usersRef.current.find(u => u.socketId === from)?.username || 'user';
        return {
          ...prev,
          [from]: userMsgs.map(m => m.id === messageId ? { ...m, isDeleted: true, text: `This message was deleted by ${senderName}` } : m)
        };
      });
    };

    socket.on('private-message', handlePrivateMessage);
    socket.on('message-delivered', handleMessageDelivered);
    socket.on('message-read', handleMessageRead);
    socket.on('message-delete-everyone', handleDeleteEveryone);

    return () => {
      socket.off('private-message', handlePrivateMessage);
      socket.off('message-delivered', handleMessageDelivered);
      socket.off('message-read', handleMessageRead);
      socket.off('message-delete-everyone', handleDeleteEveryone);
    };
  }, [socket, keyPair]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedUserId || !socket || !keyPair) return;

    const recipient = users.find((u) => u.socketId === selectedUserId);
    if (!recipient) return;

    try {
      const { ciphertext, nonce } = encryptMessage(
        inputText,
        recipient.publicKey,
        keyPair.secretKey
      );

      const timestamp = Date.now();
      const messageId = Math.random().toString(36).substr(2, 9);

      socket.emit('private-message', {
        to: selectedUserId,
        fromUsername: username,
        ciphertext,
        nonce,
        messageId,
      });

      // Optimistically add the plaintext to our local state
      setMessages((prev) => {
        const userMessages = prev[selectedUserId] || [];
        return {
          ...prev,
          [selectedUserId]: [
            ...userMessages,
            { id: messageId, text: inputText, isMine: true, timestamp, status: 'sent' },
          ],
        };
      });

      setInputText('');
    } catch (error) {
      console.error('Encryption failed:', error);
      alert('Failed to encrypt the message.');
    }
  };

  const handleUserSelect = (userId: string) => {
    setSelectedUserId(userId);
    setUnreadCounts((prev) => ({ ...prev, [userId]: 0 }));
    setActiveDeleteMenu(null);
    
    // Emit read receipts for any 'received' messages
    setMessages(prev => {
      const uMsgs = prev[userId];
      if (!uMsgs) return prev;
      let changed = false;
      const newMsgs = uMsgs.map(m => {
        if (!m.isMine && m.status === 'received' && !m.isDeleted) {
          socket?.emit('message-read', { to: userId, messageId: m.id });
          changed = true;
          return { ...m, status: 'read' as const };
        }
        return m;
      });
      return changed ? { ...prev, [userId]: newMsgs } : prev;
    });
  };

  const deleteForMe = (messageId: string) => {
    if (!selectedUserId) return;
    setMessages(prev => {
      const msgs = prev[selectedUserId] || [];
      return {
        ...prev,
        [selectedUserId]: msgs.filter(m => m.id !== messageId)
      };
    });
    setActiveDeleteMenu(null);
  };

  const deleteForEveryone = (messageId: string) => {
    if (!selectedUserId || !socket) return;
    
    const msg = messages[selectedUserId]?.find(m => m.id === messageId);
    if (!msg || !msg.isMine) return;
    
    const timeSinceSent = Date.now() - msg.timestamp;
    const FIFTEEN_MINUTES = 15 * 60 * 1000;
    
    if (timeSinceSent > FIFTEEN_MINUTES && msg.status === 'read') {
      alert("This message cannot be deleted for everyone because it is older than 15 minutes and has already been read.");
      setActiveDeleteMenu(null);
      return;
    }
    
    // Update locally
    setMessages(prev => {
      const msgs = prev[selectedUserId] || [];
      return {
        ...prev,
        [selectedUserId]: msgs.map(m => m.id === messageId ? { ...m, isDeleted: true, text: 'You deleted this message' } : m)
      };
    });
    
    // Emit to server
    socket.emit('message-delete-everyone', { to: selectedUserId, messageId });
    setActiveDeleteMenu(null);
  };

  if (!isJoined) {
    return (
      <div className="login-screen">
        <div className="glass-panel login-form">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
            <ShieldCheck size={48} color="var(--accent-color)" />
          </div>
          <h1>SecureChat</h1>
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '20px' }}>
            End-to-End Encrypted Messaging
          </p>
          <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
            <button type="submit">
              Join Chat
            </button>
          </form>
        </div>
      </div>
    );
  }

  const selectedUser = users.find((u) => u.socketId === selectedUserId);
  const activeMessages = selectedUserId ? messages[selectedUserId] || [] : [];
  
  const getLastMessageTime = (userId: string) => {
    const userMessages = messages[userId] || [];
    if (userMessages.length === 0) return 0;
    return userMessages[userMessages.length - 1].timestamp;
  };

  const otherUsers = users.filter((u) => u.socketId !== socket?.id).sort((a, b) => {
    return getLastMessageTime(b.socketId) - getLastMessageTime(a.socketId);
  });

  return (
    <div className="app-container glass-panel">
      {/* Sidebar */}
      <div className={`sidebar ${selectedUser ? 'hide-on-mobile' : ''}`}>
        <div className="sidebar-header">
          <h2><User size={20} /> {username}</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            <Lock size={12} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '2px' }} /> E2EE Active
          </p>
        </div>
        <div className="users-list">
          {otherUsers.length === 0 ? (
            <p style={{ padding: '20px', color: 'var(--text-secondary)', textAlign: 'center', fontSize: '0.9rem' }}>
              Waiting for others to join...
            </p>
          ) : (
            otherUsers.map((u) => (
              <div
                key={u.socketId}
                className={`user-item ${selectedUserId === u.socketId ? 'active' : ''}`}
                onClick={() => handleUserSelect(u.socketId)}
              >
                <div className="avatar">{u.username.charAt(0).toUpperCase()}</div>
                <div className="user-info" style={{ flex: 1 }}>
                  <h4>{u.username}</h4>
                  <p>Online</p>
                </div>
                {unreadCounts[u.socketId] > 0 && (
                  <div className="unread-badge">{unreadCounts[u.socketId]}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`chat-area ${!selectedUser ? 'hide-on-mobile' : ''}`} onClick={() => { if (activeDeleteMenu) setActiveDeleteMenu(null) }}>
        {selectedUser ? (
          <>
            <div className="chat-header">
              <button className="back-btn" onClick={() => setSelectedUserId(null)}>
                <ArrowLeft size={20} />
              </button>
              <div className="avatar">{selectedUser.username.charAt(0).toUpperCase()}</div>
              <div>
                <h3 style={{ fontSize: '1.1rem' }}>{selectedUser.username}</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--success)' }}>
                  <span className="status-dot" style={{ display: 'inline-block', marginRight: '6px' }}></span>
                  Online - Encrypted Session
                </p>
              </div>
            </div>
            
            <div className="messages-container">
              {activeMessages.length === 0 ? (
                <div className="empty-state">
                  <ShieldCheck size={48} />
                  <p>Messages with {selectedUser.username} are End-to-End Encrypted.</p>
                  <p style={{ fontSize: '0.85rem' }}>No one else can read them.</p>
                </div>
              ) : (
                activeMessages.map((msg) => (
                  <div key={msg.id} className={`message-wrapper ${msg.isMine ? 'sent' : 'received'}`}>
                    <div className="message-bubble-container">
                      <div className="message-bubble">
                        {msg.isDeleted ? (
                          <span className="deleted-message"><Ban size={14} /> {msg.text}</span>
                        ) : (
                          msg.text
                        )}
                      </div>
                      
                      {!msg.isDeleted && (
                        <div 
                          className="action-icon" 
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDeleteMenu(activeDeleteMenu === msg.id ? null : msg.id);
                          }}
                        >
                          <Trash2 size={16} />
                        </div>
                      )}

                      {activeDeleteMenu === msg.id && (
                        <div className="delete-options" onClick={(e) => e.stopPropagation()}>
                          {msg.isMine && (Date.now() - msg.timestamp <= 15 * 60 * 1000 || msg.status !== 'read') && (
                            <button className="delete-btn" onClick={() => deleteForEveryone(msg.id)}>
                              Delete for everyone
                            </button>
                          )}
                          <button className="delete-btn" onClick={() => deleteForMe(msg.id)}>
                            Delete for me
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="message-meta">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {msg.isMine && !msg.isDeleted && (
                        <>
                          {msg.status === 'sent' && <Check className="receipt-icon receipt-sent" />}
                          {msg.status === 'delivered' && <CheckCheck className="receipt-icon receipt-delivered" />}
                          {msg.status === 'read' && <CheckCheck className="receipt-icon receipt-read" />}
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="input-area">
              <form onSubmit={handleSendMessage} className="input-container">
                <input
                  type="text"
                  placeholder={`Message ${selectedUser.username}...`}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <button type="submit" disabled={!inputText.trim()}>
                  <Send size={18} />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <MessageSquare size={64} />
            <h2>Welcome to SecureChat</h2>
            <p>Select a user from the sidebar to start an encrypted conversation.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
