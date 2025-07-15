import { sign, SignKeyPair } from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import base58 from 'bs58';
import { createHash, randomBytes, createHmac } from 'crypto';
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from "bip39";

interface MasterKey {
  masterPrivateKey: Buffer;
  masterChainCode: Buffer;
}

export interface WalletData {
  mnemonic: string[];
  seed_hex: string;
  master_chain_hex: string;
  private_key_hex: string;
  public_key_hex: string;
  private_key_b64: string;
  public_key_b64: string;
  address: string;
  entropy_hex: string;
  test_message: string;
  test_signature: string;
  signature_valid: boolean;
}

/**
 * Validates a private key.
 * @param {string} privateKeyB64 - The Base64 encoded private key string
 * @returns {boolean} Returns true if valid, otherwise throws an error
 * @throws {Error} If the key is invalid
 */
export function validatePrivateKey(privateKeyB64: string): boolean {
  try {
    const decodedKey = decodeBase64(privateKeyB64);
    if (decodedKey.length !== 32 && decodedKey.length !== 64) {
      throw new Error(`Invalid key length. Expected 32 or 64 bytes, got ${decodedKey.length}`);
    }
    return true;
  } catch (_error) {
    throw new Error('Invalid private key format');
  }
}

/**
 * Gets a key pair from a base64 encoded private key
 * @param {string} privateKeyB64 - The Base64 encoded private key string
 * @returns {SignKeyPair} A tweetnacl key pair object
 * @throws {Error} If key generation fails
 */
export function getKeyPair(privateKeyB64: string): SignKeyPair {
  try {
    validatePrivateKey(privateKeyB64);
    const decodedKey = decodeBase64(privateKeyB64);
    return sign.keyPair.fromSeed(decodedKey);
  } catch (error: unknown) {
    console.error('Key pair generation error');
    throw new Error('Failed to generate key pair');
  }
}

/**
 * Derives a public key from a private key
 * @param {string} privateKeyB64 - The Base64 encoded private key string
 * @returns {string} The Base64 encoded public key
 * @throws {Error} If derivation fails
 */
export function derivePublicKey(privateKeyB64: string): string {
  try {
    const keyPair = getKeyPair(privateKeyB64);
    return encodeBase64(keyPair.publicKey);
  } catch (error: unknown) {
    console.error('Public key derivation error');
    throw new Error('Failed to derive public key');
  }
}

/**
 * Derives an Octra address from a private key
 * @param {string} privateKeyB64 - The Base64 encoded private key string
 * @returns {string} The Octra address (oct + Base58(SHA256(pubkey)))
 * @throws {Error} If address derivation fails
 */
export function deriveAddress(privateKeyB64: string): string {
  try {
    const keyPair = getKeyPair(privateKeyB64);
    const hash = createHash("sha256").update(keyPair.publicKey).digest();
    const base58Hash = base58.encode(hash);
    return 'oct' + base58Hash;
  } catch (error: unknown) {
    console.error('Address derivation error');
    throw new Error('Failed to derive address');
  }
}

/**
 * Derives a private key from a mnemonic phrase
 * @param {string} mnemonic - The mnemonic phrase (space-separated words)
 * @returns {string} The Base64 encoded private key
 * @throws {Error} If the mnemonic is invalid or derivation fails
 */
export function derivePrivateKeyFromMnemonic(mnemonic: string): string {
  try {
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }
    
    const seed = mnemonicToSeedSync(mnemonic);
    const { masterPrivateKey } = deriveMasterKey(seed);
    const keyPair = sign.keyPair.fromSeed(masterPrivateKey);
    const privateKeyRaw = Buffer.from(keyPair.secretKey.slice(0, 32));
    return encodeBase64(privateKeyRaw);
  } catch (error: unknown) {
    console.error('Private key derivation error');
    throw new Error('Failed to derive private key');
  }
}

function generateEntropy(strength: number = 128): Buffer {
  if (![128, 160, 192, 224, 256].includes(strength)) {
    throw new Error("Invalid entropy strength");
  }
  return randomBytes(strength / 8);
}

function deriveMasterKey(seed: Buffer): MasterKey {
  try {
    const key = Buffer.from("Octra seed", "utf8");
    const mac = createHmac("sha512", key).update(seed).digest();
    return {
      masterPrivateKey: mac.slice(0, 32),
      masterChainCode: mac.slice(32, 64)
    };
  } catch (_error) {
    throw new Error('Failed to derive master key');
  }
}

function createOctraAddress(publicKey: Buffer): string {
  try {
    const hash = createHash("sha256").update(publicKey).digest();
    const base58Hash = base58.encode(hash);
    return "oct" + base58Hash;
  } catch (_error) {
    throw new Error('Failed to create address');
  }
}

function bufferToHex(buffer: Buffer | Uint8Array): string {
  return Buffer.from(buffer).toString("hex");
}

/**
 * Creates a new Octra wallet
 * @returns {WalletData} Wallet data object containing all key information
 * @throws {Error} If wallet creation fails
 */
export function createWallet(): WalletData {
  try {
    const entropy = generateEntropy(128);
    const mnemonic = entropyToMnemonic(entropy.toString("hex"));
    const mnemonicWords = mnemonic.split(" ");
    const seed = mnemonicToSeedSync(mnemonic);
    const { masterPrivateKey, masterChainCode } = deriveMasterKey(seed);
    const keyPair = sign.keyPair.fromSeed(masterPrivateKey);
    const privateKeyRaw = Buffer.from(keyPair.secretKey.slice(0, 32));
    const publicKeyRaw = Buffer.from(keyPair.publicKey);
    const address = createOctraAddress(publicKeyRaw);

    // Create test signature for verification
    const testMessage = '{"from":"test","to":"test","amount":"1000000","nonce":1}';
    const messageBytes = Buffer.from(testMessage, "utf8");
    const signature = sign.detached(messageBytes, keyPair.secretKey);
    const signatureB64 = encodeBase64(signature);
    const signatureValid = sign.detached.verify(messageBytes, signature, keyPair.publicKey);

    return {
      mnemonic: mnemonicWords,
      seed_hex: bufferToHex(seed),
      master_chain_hex: bufferToHex(masterChainCode),
      private_key_hex: bufferToHex(privateKeyRaw),
      public_key_hex: bufferToHex(publicKeyRaw),
      private_key_b64: encodeBase64(privateKeyRaw),
      public_key_b64: encodeBase64(publicKeyRaw),
      address: address,
      entropy_hex: bufferToHex(entropy),
      test_message: testMessage,
      test_signature: signatureB64,
      signature_valid: signatureValid,
    };
  } catch (error: unknown) {
    console.error('Wallet creation error');
    throw new Error('Failed to create wallet');
  }
}

/**
 * Validates a wallet address
 * @param {string} address - The address to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function validateAddress(address: string): boolean {
  try {
    if (!address.startsWith('oct')) return false;
    const hashPart = address.slice(3);
    const decoded = base58.decode(hashPart);
    return decoded.length === 32;
  } catch (_error) {
    return false;
  }
}

/**
 * Signs a message with a private key
 * @param {string} message - The message to sign
 * @param {string} privateKeyB64 - Base64 encoded private key
 * @returns {string} Base64 encoded signature
 * @throws {Error} If signing fails
 */
export function signMessage(message: string, privateKeyB64: string): string {
  try {
    const keyPair = getKeyPair(privateKeyB64);
    const messageBytes = new TextEncoder().encode(message);
    const signature = sign.detached(messageBytes, keyPair.secretKey);
    return encodeBase64(signature);
  } catch (error: unknown) {
    console.error('Message signing error');
    throw new Error('Failed to sign message');
  }
}

/**
 * Verifies a message signature
 * @param {string} message - The original message
 * @param {string} signatureB64 - Base64 encoded signature
 * @param {string} publicKeyB64 - Base64 encoded public key
 * @returns {boolean} True if signature is valid, false otherwise
 * @throws {Error} If verification fails
 */
export function verifySignature(
  message: string,
  signatureB64: string,
  publicKeyB64: string
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signature = decodeBase64(signatureB64);
    const publicKey = decodeBase64(publicKeyB64);
    return sign.detached.verify(messageBytes, signature, publicKey);
  } catch (error: unknown) {
    console.error('Signature verification error');
    throw new Error('Failed to verify signature');
  }
}