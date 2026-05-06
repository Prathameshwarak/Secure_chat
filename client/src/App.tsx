import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Lock, Send, User, MessageSquare, ShieldCheck, Check, CheckCheck, Trash2, Ban, ArrowLeft, LogOut, Sun, Moon } from 'lucide-react';
import { generateKeyPair, encryptMessage, decryptMessage } from './encryption';
import { encodeBase64 } from 'tweetnacl-util';
import nacl from 'tweetnacl';
import { auth, googleProvider } from './firebase';
import { signInWithPopup, signOut } from 'firebase/auth';
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
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [inputText, setInputText] = useState('');
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [activeDeleteMenu, setActiveDeleteMenu] = useState<string | null>(null);
  
  const [isLightMode, setIsLightMode] = useState(() => {
    return localStorage.getItem('e2ee_theme') === 'light';
  });
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.toggle('light-mode', isLightMode);
    localStorage.setItem('e2ee_theme', isLightMode ? 'light' : 'dark');
  }, [isLightMode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedUsername]);

  const executeJoin = (joinUsername: string) => {
    // Retrieve or Generate E2EE keys on login
    let keys = keyPair;
    if (!keys) {
      const storedSecret = localStorage.getItem('e2ee_secretKey');
      if (storedSecret) {
        const secretKey = new Uint8Array(Object.values(JSON.parse(storedSecret)));
        keys = nacl.box.keyPair.fromSecretKey(secretKey);
        setKeyPair(keys);
      } else {
        keys = generateKeyPair();
        localStorage.setItem('e2ee_secretKey', JSON.stringify(keys.secretKey));
        setKeyPair(keys);
      }
    }

    const newSocket = io(SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join', {
        username: joinUsername,
        publicKey: encodeBase64(keys.publicKey),
      });
      setIsJoined(true);
    });

    newSocket.on('users-update', (updatedUsers: UserData[]) => {
      setUsers(updatedUsers);
    });
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    executeJoin(username);
  };

  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      let displayName = user.displayName;
      if (!displayName && user.email) {
        displayName = user.email.split('@')[0];
      }
      if (!displayName) {
        displayName = "User_" + Math.random().toString(36).substring(2, 6);
      }
      
      setUsername(displayName);
      executeJoin(displayName);
    } catch (error) {
      console.error("Google login failed", error);
      alert("Google login failed. Please try again or use the standard username login.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
    setIsJoined(false);
    setUsername('');
    setSelectedUsername(null);
    setMessages({});
  };

  const usersRef = useRef<UserData[]>(users);
  usersRef.current = users;
  
  const selectedUsernameRef = useRef<string | null>(selectedUsername);
  selectedUsernameRef.current = selectedUsername;

  useEffect(() => {
    if (!socket || !keyPair) return;

    socket.on('chat-history', (historyMsgs: any[]) => {
      const grouped: Record<string, Message[]> = {};
      
      historyMsgs.forEach((msg) => {
        try {
          const isMine = msg.senderUsername === username;
          const otherUsername = isMine ? msg.receiverUsername : msg.senderUsername;
          const otherPublicKey = isMine ? msg.receiverPublicKey : msg.senderPublicKey;
          
          let decryptedText = "";
          if (msg.isDeleted) {
             decryptedText = msg.deletedText || 'This message was deleted';
          } else {
             decryptedText = decryptMessage(msg.ciphertext, msg.nonce, otherPublicKey, keyPair.secretKey) || 'Error decrypting message';
          }

          if (!grouped[otherUsername]) grouped[otherUsername] = [];
          grouped[otherUsername].push({
            id: msg.messageId,
            text: decryptedText,
            isMine,
            timestamp: msg.timestamp,
            status: msg.status,
            isDeleted: msg.isDeleted
          });
        } catch(e) { console.error("Could not decrypt historic message", e) }
      });
      
      setMessages(grouped);
    });

    const handlePrivateMessage = ({ from, fromUsername, ciphertext, nonce, timestamp, messageId }: any) => {
      const currentUsers = usersRef.current;
      const sender = currentUsers.find((u) => u.socketId === from);
      
      if (sender) {
        const decryptedText = decryptMessage(ciphertext, nonce, sender.publicKey, keyPair.secretKey);

        if (decryptedText) {
          const isSelected = selectedUsernameRef.current === fromUsername;
          
          setMessages((prev) => {
            const userMessages = prev[fromUsername] || [];
            return {
              ...prev,
              [fromUsername]: [
                ...userMessages,
                { id: messageId || Math.random().toString(), text: decryptedText, isMine: false, timestamp, status: 'received' },
              ],
            };
          });
          
          if (!isSelected) {
            setUnreadCounts((prev) => ({
              ...prev,
              [fromUsername]: (prev[fromUsername] || 0) + 1,
            }));
            socket.emit('message-delivered', { to: from, messageId });
          } else {
            socket.emit('message-read', { to: from, messageId });
          }
        }
      }
    };

    const handleMessageDelivered = ({ from, messageId }: any) => {
      const senderName = usersRef.current.find(u => u.socketId === from)?.username;
      if (!senderName) return;
      setMessages((prev) => {
        const userMsgs = prev[senderName];
        if (!userMsgs) return prev;
        return {
          ...prev,
          [senderName]: userMsgs.map(m => (m.id === messageId && m.status !== 'read') ? { ...m, status: 'delivered' } : m)
        };
      });
    };

    const handleMessageRead = ({ from, messageId }: any) => {
      const senderName = usersRef.current.find(u => u.socketId === from)?.username;
      if (!senderName) return;
      setMessages((prev) => {
        const userMsgs = prev[senderName];
        if (!userMsgs) return prev;
        return {
          ...prev,
          [senderName]: userMsgs.map(m => m.id === messageId ? { ...m, status: 'read' } : m)
        };
      });
    };

    const handleDeleteEveryone = ({ from, messageId }: any) => {
      // the message could be from anyone, but it affects the chat with the sender.
      const senderName = usersRef.current.find(u => u.socketId === from)?.username;
      if (!senderName) return;

      setMessages((prev) => {
        const userMsgs = prev[senderName];
        if (!userMsgs) return prev;
        return {
          ...prev,
          [senderName]: userMsgs.map(m => m.id === messageId ? { ...m, isDeleted: true, text: `This message was deleted by ${senderName}` } : m)
        };
      });
    };

    socket.on('private-message', handlePrivateMessage);
    socket.on('message-delivered', handleMessageDelivered);
    socket.on('message-read', handleMessageRead);
    socket.on('message-delete-everyone', handleDeleteEveryone);

    return () => {
      socket.off('chat-history');
      socket.off('private-message', handlePrivateMessage);
      socket.off('message-delivered', handleMessageDelivered);
      socket.off('message-read', handleMessageRead);
      socket.off('message-delete-everyone', handleDeleteEveryone);
    };
  }, [socket, keyPair, username]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedUsername || !socket || !keyPair) return;

    const recipient = users.find((u) => u.username === selectedUsername);
    if (!recipient) {
      alert('User is currently offline. You cannot send them new messages until they reconnect.');
      return;
    }

    try {
      const { ciphertext, nonce } = encryptMessage(
        inputText,
        recipient.publicKey,
        keyPair.secretKey
      );

      const timestamp = Date.now();
      const messageId = Math.random().toString(36).substr(2, 9);

      socket.emit('private-message', {
        to: recipient.socketId,
        fromUsername: username,
        ciphertext,
        nonce,
        messageId,
      });

      // Optimistically add the plaintext to our local state
      setMessages((prev) => {
        const userMessages = prev[selectedUsername] || [];
        return {
          ...prev,
          [selectedUsername]: [
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

  const handleUserSelect = (targetUsername: string) => {
    setSelectedUsername(targetUsername);
    setUnreadCounts((prev) => ({ ...prev, [targetUsername]: 0 }));
    setActiveDeleteMenu(null);
    
    // Find active socket for the user
    const targetUser = users.find(u => u.username === targetUsername);
    
    // Emit read receipts for any 'received' messages if they are online
    setMessages(prev => {
      const uMsgs = prev[targetUsername];
      if (!uMsgs) return prev;
      let changed = false;
      const newMsgs = uMsgs.map(m => {
        if (!m.isMine && m.status === 'received' && !m.isDeleted) {
          if (targetUser && socket) {
            socket.emit('message-read', { to: targetUser.socketId, messageId: m.id });
          }
          changed = true;
          return { ...m, status: 'read' as const };
        }
        return m;
      });
      return changed ? { ...prev, [targetUsername]: newMsgs } : prev;
    });
  };

  const deleteForMe = (messageId: string) => {
    if (!selectedUsername) return;
    setMessages(prev => {
      const msgs = prev[selectedUsername] || [];
      return {
        ...prev,
        [selectedUsername]: msgs.filter(m => m.id !== messageId)
      };
    });
    setActiveDeleteMenu(null);
  };

  const deleteForEveryone = (messageId: string) => {
    if (!selectedUsername || !socket) return;
    
    const msg = messages[selectedUsername]?.find(m => m.id === messageId);
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
      const msgs = prev[selectedUsername] || [];
      return {
        ...prev,
        [selectedUsername]: msgs.map(m => m.id === messageId ? { ...m, isDeleted: true, text: 'You deleted this message' } : m)
      };
    });
    
    // Emit to server
    const targetUser = users.find(u => u.username === selectedUsername);
    socket.emit('message-delete-everyone', { to: targetUser?.socketId, messageId });
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

          <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0', color: 'var(--text-secondary)' }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
            <span style={{ padding: '0 10px', fontSize: '0.9rem' }}>OR</span>
            <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
          </div>

          <button 
            type="button"
            onClick={handleGoogleLogin} 
            style={{ 
              width: '100%', 
              backgroundColor: '#fff', 
              color: '#333', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '10px',
              fontWeight: 600,
              border: 'none',
              padding: '12px',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f1f1'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#fff'}
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={{ width: '18px' }} />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // Combine online users and users we have history with
  const historyUsernames = Object.keys(messages);
  const allUsernames = Array.from(new Set([
    ...users.filter(u => u.username !== username).map(u => u.username),
    ...historyUsernames
  ]));

  const getLastMessageTime = (uname: string) => {
    const userMessages = messages[uname] || [];
    if (userMessages.length === 0) return 0;
    return userMessages[userMessages.length - 1].timestamp;
  };

  allUsernames.sort((a, b) => getLastMessageTime(b) - getLastMessageTime(a));
  
  const activeMessages = selectedUsername ? messages[selectedUsername] || [] : [];
  const selectedUserOnline = users.find(u => u.username === selectedUsername);

  return (
    <div className="app-container glass-panel">
      {/* Sidebar */}
      <div className={`sidebar ${selectedUsername ? 'hide-on-mobile' : ''}`}>
        <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2><User size={20} /> {username}</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              <Lock size={12} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '2px' }} /> E2EE Active
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              className="action-btn" 
              style={{ display: 'flex', padding: '6px' }}
              onClick={() => setIsLightMode(!isLightMode)}
              title="Toggle Theme"
            >
              {isLightMode ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button 
              className="action-btn" 
              style={{ display: 'flex', padding: '6px', color: '#ef4444' }}
              onClick={handleLogout}
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <div className="users-list">
          {allUsernames.length === 0 ? (
            <p style={{ padding: '20px', color: 'var(--text-secondary)', textAlign: 'center', fontSize: '0.9rem' }}>
              Waiting for others to join...
            </p>
          ) : (
            allUsernames.map((uname) => {
              const isOnline = users.some(u => u.username === uname);
              return (
                <div
                  key={uname}
                  className={`user-item ${selectedUsername === uname ? 'active' : ''}`}
                  onClick={() => handleUserSelect(uname)}
                >
                  <div className="avatar" style={{ opacity: isOnline ? 1 : 0.5 }}>
                    {uname.charAt(0).toUpperCase()}
                  </div>
                  <div className="user-info" style={{ flex: 1 }}>
                    <h4>{uname}</h4>
                    <p style={{ color: isOnline ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {isOnline ? 'Online' : 'Offline'}
                    </p>
                  </div>
                  {unreadCounts[uname] > 0 && (
                    <div className="unread-badge">{unreadCounts[uname]}</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`chat-area ${!selectedUsername ? 'hide-on-mobile' : ''}`} onClick={() => { if (activeDeleteMenu) setActiveDeleteMenu(null) }}>
        {selectedUsername ? (
          <>
            <div className="chat-header">
              <button className="back-btn" onClick={() => setSelectedUsername(null)}>
                <ArrowLeft size={20} />
              </button>
              <div className="avatar" style={{ opacity: selectedUserOnline ? 1 : 0.5 }}>
                {selectedUsername.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 style={{ fontSize: '1.1rem' }}>{selectedUsername}</h3>
                <p style={{ fontSize: '0.8rem', color: selectedUserOnline ? 'var(--success)' : 'var(--text-secondary)' }}>
                  {selectedUserOnline && <span className="status-dot" style={{ display: 'inline-block', marginRight: '6px' }}></span>}
                  {selectedUserOnline ? 'Online - Encrypted Session' : 'Offline - Encrypted History'}
                </p>
              </div>
            </div>
            
            <div className="messages-container">
              {activeMessages.length === 0 ? (
                <div className="empty-state">
                  <ShieldCheck size={48} />
                  <p>Messages with {selectedUsername} are End-to-End Encrypted.</p>
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
                  placeholder={selectedUserOnline ? `Message ${selectedUsername}...` : `${selectedUsername} is offline...`}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={!selectedUserOnline}
                  style={{ opacity: selectedUserOnline ? 1 : 0.7 }}
                />
                <button type="submit" disabled={!inputText.trim() || !selectedUserOnline}>
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
