import nacl from 'tweetnacl';
import { decodeUTF8, encodeUTF8, encodeBase64, decodeBase64 } from 'tweetnacl-util';

// Generates a new X25519 key pair for E2EE
export const generateKeyPair = () => {
  return nacl.box.keyPair();
};

// Generates a 24-byte random nonce
export const generateNonce = () => {
  return nacl.randomBytes(nacl.box.nonceLength);
};

// Encrypts a string message
export const encryptMessage = (
  message: string,
  receiverPublicKeyBase64: string,
  senderSecretKey: Uint8Array
): { ciphertext: string; nonce: string } => {
  const nonce = generateNonce();
  const messageUint8 = decodeUTF8(message);
  const receiverPublicKey = decodeBase64(receiverPublicKeyBase64);

  const encrypted = nacl.box(messageUint8, nonce, receiverPublicKey, senderSecretKey);

  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
};

// Decrypts an encrypted message
export const decryptMessage = (
  ciphertextBase64: string,
  nonceBase64: string,
  senderPublicKeyBase64: string,
  receiverSecretKey: Uint8Array
): string | null => {
  try {
    const ciphertext = decodeBase64(ciphertextBase64);
    const nonce = decodeBase64(nonceBase64);
    const senderPublicKey = decodeBase64(senderPublicKeyBase64);

    const decrypted = nacl.box.open(ciphertext, nonce, senderPublicKey, receiverSecretKey);

    if (!decrypted) {
      return null;
    }

    return encodeUTF8(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
};
