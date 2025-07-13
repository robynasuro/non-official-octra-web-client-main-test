import useSWR, { useSWRConfig } from 'swr';
import { useWallet } from '@/context/WalletContext';
import { fetcher } from '@/lib/api';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { useState } from "react";
import { getKeyPair } from "@/lib/crypto";
import { useMemo } from "react";
import { sha256 } from 'js-sha256';

// Helper function to derive encryption key (matches CLI implementation)
const deriveEncryptionKey = (privkeyB64: string): Uint8Array => {
  const privkeyBytes = Buffer.from(privkeyB64, 'base64');
  const salt = new TextEncoder().encode("octra_encrypted_balance_v2");
  const combined = new Uint8Array(salt.length + privkeyBytes.length);
  combined.set(salt);
  combined.set(privkeyBytes, salt.length);
  
  const hash = new Uint8Array(sha256.arrayBuffer(combined));
  return hash.slice(0, nacl.secretbox.keyLength);
};

// Helper function to encrypt balance (matches CLI implementation)
const encryptClientBalance = (balance: number, privkeyB64: string): string => {
  const key = deriveEncryptionKey(privkeyB64);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const plaintext = new TextEncoder().encode(balance.toString());
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  
  if (!ciphertext) {
    throw new Error('Encryption failed');
  }

  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  return "v2|" + encodeBase64(combined);
};

// Wallet balance hook
export function useWalletBalance() {
  const { wallet } = useWallet();
  const rpcUrl = 'https://octra.network';

  const balanceKey = wallet ? [`/balance/${wallet.address}`, rpcUrl, {}] : null;
  const { 
    data: balanceData, 
    error: _balanceError, 
    isLoading: balanceLoading 
  } = useSWR(
    balanceKey,
    fetcher,
    { refreshInterval: 30000 }
  );

  const stagingKey = wallet ? ['/staging', rpcUrl] : null;
  const { 
    data: stagingData, 
    error: _stagingError, 
    isLoading: stagingLoading 
  } = useSWR(
    stagingKey,
    fetcher,
    { refreshInterval: 30000 }
  );

  const getCombinedNonce = () => {
    if (!wallet || !balanceData) return balanceData?.nonce;
    const baseNonce = balanceData.nonce ?? 0;
    if (stagingData?.staged_transactions) {
      const ourStagedTxs = stagingData.staged_transactions.filter((tx: any) => tx.from === wallet.address);
      if (ourStagedTxs.length > 0) {
        const maxStagedNonce = Math.max(...ourStagedTxs.map((tx: any) => Number(tx.nonce)));
        return Math.max(baseNonce, maxStagedNonce);
      }
    }
    return baseNonce;
  };

  return {
    balance: balanceData?.balance || 0,
    nonce: getCombinedNonce() || 0,
    isLoading: balanceLoading || stagingLoading,
  };
}

// Transaction history types and hook
interface TransactionReference { 
  hash: string; 
  epoch?: number; 
}

interface ParsedTransaction { 
  from: string; 
  to: string; 
  amount: string; 
  amount_raw?: string; 
  nonce: number; 
  timestamp: number; 
  message?: string; 
}

export interface ProcessedTransaction { 
  time: Date; 
  hash: string; 
  amount: number; 
  to: string; 
  type: 'in' | 'out'; 
  nonce: number; 
  epoch?: number; 
  ok: boolean; 
  message?: string;
  isPrivate?: boolean;
}

// Enhanced transaction history hook
export function useTransactionHistory() {
  const { wallet } = useWallet();
  const rpcUrl = 'https://octra.network';

  // Regular transactions
  const stagingKey = wallet ? ['/staging', rpcUrl] : null;
  const { data: stagingData } = useSWR(stagingKey, fetcher, { 
    refreshInterval: 30000, 
    revalidateOnFocus: false 
  });

  const addressKey = wallet ? [`/balance/${wallet.address}?limit=20`, rpcUrl, {}] : null;
  const { 
    data: addressData, 
    error: _addressError, 
    isLoading: addressLoading 
  } = useSWR(
    addressKey,
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: false }
  );

  // Private transactions
  const privateTxKey = wallet ? [`/private_transactions/${wallet.address}`, rpcUrl] : null;
  const { data: privateTxData } = useSWR(privateTxKey, fetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false
  });

  // Transaction details
  const transactionHashes = addressData?.recent_transactions?.map((tx: TransactionReference) => tx.hash) || [];
  const transactionDetailsKey = transactionHashes.length > 0 && wallet ? ['transaction-details', transactionHashes, rpcUrl] : null;
  const { 
    data: transactionDetails, 
    error: _detailsError, 
    isLoading: detailsLoading 
  } = useSWR(
    transactionDetailsKey,
    async ([_, hashes, rpcUrl]) => {
      const transactionPromises = hashes.map(async (hash: string) => {
        try { 
          return { hash, data: await fetcher([`/tx/${hash}`, rpcUrl]) }; 
        } catch (_) { 
          return null; 
        }
      });
      const results = await Promise.all(transactionPromises);
      return results.filter(result => result !== null);
    },
    { refreshInterval: 60000, revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  const processedTransactions = useMemo((): ProcessedTransaction[] => {
    if (!wallet?.address) return [];
    
    const finalTransactions: ProcessedTransaction[] = [];
    const processedHashes = new Set<string>();
    
    const parseAmount = (amountRaw: string | undefined): number => {
      const amountStr = String(amountRaw || '0');
      return amountStr.includes('.') ? parseFloat(amountStr) : parseInt(amountStr) / 1_000_000;
    };

    // Process private transactions first
    if (privateTxData?.transactions) {
      privateTxData.transactions.forEach((tx: any) => {
        if (processedHashes.has(tx.hash)) return;
        
        finalTransactions.push({
          time: new Date(tx.timestamp * 1000),
          hash: tx.hash,
          amount: parseAmount(tx.amount),
          to: tx.recipient === wallet.address ? tx.sender : tx.recipient,
          type: tx.recipient === wallet.address ? 'in' : 'out',
          ok: true,
          nonce: tx.nonce,
          isPrivate: true,
          message: tx.message
        });
        processedHashes.add(tx.hash);
      });
    }

    // Process regular transactions
    if (transactionDetails?.length && addressData?.recent_transactions?.length) {
      transactionDetails.forEach((result: any) => {
        if (!result?.data?.parsed_tx) return;
        const { hash, data } = result;
        if (processedHashes.has(hash)) return;
        
        const parsedTx: ParsedTransaction = data.parsed_tx;
        const txRef = addressData.recent_transactions.find((ref: TransactionReference) => ref.hash === hash);
        const isIncoming = parsedTx.to === wallet.address;
        
        finalTransactions.push({
          time: new Date(parsedTx.timestamp * 1000),
          hash,
          amount: parseAmount(parsedTx.amount_raw || parsedTx.amount),
          to: isIncoming ? parsedTx.from : parsedTx.to,
          type: isIncoming ? 'in' : 'out',
          ok: true,
          nonce: parsedTx.nonce,
          epoch: txRef?.epoch,
          message: parsedTx.message || undefined,
          isPrivate: false
        });
        processedHashes.add(hash);
      });
    }

    // Process staged transactions
    if (stagingData?.staged_transactions) {
      const ourStagedTxs = stagingData.staged_transactions.filter(
        (tx: any) => tx.from === wallet.address && tx.hash && !processedHashes.has(tx.hash)
      );
      ourStagedTxs.forEach((stagedTx: any) => {
        const isIncoming = stagedTx.to === wallet.address;
        finalTransactions.push({
          time: new Date(stagedTx.timestamp * 1000),
          hash: stagedTx.hash,
          amount: parseAmount(stagedTx.amount_raw || stagedTx.amount),
          to: isIncoming ? stagedTx.from : stagedTx.to,
          type: isIncoming ? 'in' : 'out',
          ok: true,
          nonce: stagedTx.nonce,
          epoch: undefined,
          message: stagedTx.message || undefined,
          isPrivate: false
        });
        processedHashes.add(stagedTx.hash);
      });
    }

    return finalTransactions.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 50);
  }, [wallet?.address, privateTxData, transactionDetails, addressData?.recent_transactions, stagingData]);

  const isLoading = addressLoading || detailsLoading;
  
  return { 
    history: processedTransactions, 
    isLoading
  };
}

// Send transaction hook
interface SendTransactionParams { 
  to: string; 
  amount: number; 
  _nonce?: number; 
  message?: string; 
}

interface SendTransactionResult { 
  success: boolean; 
  txHash?: string; 
  error?: string; 
  responseTime?: number; 
  poolInfo?: any; 
  message?: string; 
}

export function useSendTransaction() {
  const { wallet } = useWallet();
  const { nonce, balance } = useWalletBalance();
  const [isLoading, setIsLoading] = useState(false);
  const { mutate } = useSWRConfig();
  const rpcUrl = 'https://octra.network';

  const sendTransaction = async ({ 
    to, 
    amount, 
    _nonce, 
    message 
  }: SendTransactionParams): Promise<SendTransactionResult> => {
    if (!wallet) return { success: false, error: 'Wallet not connected' };
    
    const currentNonce = _nonce ?? nonce ?? 0;
    if (balance === undefined) return { success: false, error: 'Failed to get wallet state' };
    if (balance < amount) return { 
      success: false, 
      error: `Insufficient balance (${balance?.toFixed(6)} < ${amount})` 
    };
    
    setIsLoading(true);
    try {
      const keyPair = getKeyPair(wallet.privateKey);
      const transaction = { 
        from: wallet.address, 
        to_: to, 
        amount: String(Math.floor(amount * 1_000_000)), 
        nonce: _nonce ? _nonce : currentNonce + 1, 
        ou: amount < 1000 ? "1" : "3", 
        timestamp: Date.now() / 1000 + Math.random() * 0.01, 
        message: message || undefined 
      };
      
      const signableData = { ...transaction };
      delete signableData.message;
      const transactionString = JSON.stringify(signableData, null, 0);
      const messageBytes = new TextEncoder().encode(transactionString);
      const signature = nacl.sign.detached(messageBytes, keyPair.secretKey);
      const signatureB64 = encodeBase64(signature);
      const publicKeyB64 = encodeBase64(keyPair.publicKey);
      
      const signedTransaction = { 
        ...transaction, 
        signature: signatureB64, 
        public_key: publicKeyB64 
      };
      
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('/api/proxy', { 
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json',
          'X-Private-Key': wallet.privateKey
        }, 
        body: JSON.stringify({ 
          method: 'POST', 
          endpoint: '/send-tx', 
          rpcUrl, 
          payload: signedTransaction 
        }), 
        signal: controller.signal 
      });
      
      clearTimeout(timeoutId);
      const responseTime = (Date.now() - startTime) / 1000;
      
      if (!response.ok) {
        const errorData = await response.json();
        return { 
          success: false, 
          error: errorData.error || 'Transaction failed', 
          responseTime 
        };
      }
      
      const result = await response.json();
      let txHash: string | undefined;
      let success = false;
      
      if (result.status === 'accepted') { 
        success = true; 
        txHash = result.tx_hash; 
      } else if (typeof result === 'string' && result.toLowerCase().startsWith('ok')) { 
        success = true; 
        txHash = result.split(' ').pop(); 
      }
      
      if (success && txHash) {
        // Update local cache
        const stagingKey = ['/staging', rpcUrl];
        mutate(stagingKey, (currentData: any) => {
          const newStagedTx = { 
            from: wallet.address, 
            to, 
            amount: String(Math.floor(amount * 1_000_000)), 
            nonce: currentNonce + 1, 
            hash: txHash, 
            timestamp: Date.now() / 1000, 
            message: message || undefined 
          };
          return { 
            ...(currentData || {}), 
            staged_transactions: [newStagedTx, ...(currentData?.staged_transactions || [])] 
          };
        }, { revalidate: false });
        
        mutate([`/balance/${wallet.address}`, rpcUrl, {}]);
        
        return { 
          success, 
          txHash, 
          responseTime, 
          poolInfo: result.pool_info, 
          message: message || undefined 
        };
      } else {
        return { 
          success: false, 
          error: JSON.stringify(result), 
          responseTime 
        };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    } finally {
      setIsLoading(false);
    }
  };

  return { 
    sendTransaction, 
    isLoading 
  };
}

// Encryption/decryption hook
export function useEncryptDecrypt() {
  const { wallet } = useWallet();
  const { mutate } = useSWRConfig();
  const [isLoading, setIsLoading] = useState(false);
  const rpcUrl = 'https://octra.network';

  const getEncryptedBalance = async (): Promise<any> => {
    if (!wallet) return null;
    
    try {
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Private-Key': wallet.privateKey
        },
        body: JSON.stringify({
          method: 'GET',
          endpoint: `/view_encrypted_balance/${wallet.address}`,
          rpcUrl
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching encrypted balance:', error);
      return null;
    }
  };

  const encryptDecryptBalance = async (
    amount: number, 
    action: 'encrypt' | 'decrypt'
  ): Promise<SendTransactionResult> => {
    if (!wallet) return { success: false, error: 'Wallet not connected' };
    
    setIsLoading(true);
    try {
      const encData = await getEncryptedBalance();
      if (!encData) {
        return { success: false, error: 'Failed to get encrypted balance' };
      }

      const currentEncrypted = encData.encrypted_raw || 0;
      const amountRaw = Math.floor(amount * 1_000_000);
      let newEncrypted: number;

      if (action === 'encrypt') {
        newEncrypted = currentEncrypted + amountRaw;
      } else {
        if (currentEncrypted < amountRaw) {
          return { success: false, error: 'Insufficient encrypted balance' };
        }
        newEncrypted = currentEncrypted - amountRaw;
      }

      const encryptedValue = encryptClientBalance(newEncrypted, wallet.privateKey);

      const endpoint = action === 'encrypt' ? '/encrypt_balance' : '/decrypt_balance';
      const payload = {
        address: wallet.address,
        amount: String(amountRaw),
        private_key: wallet.privateKey,
        encrypted_data: encryptedValue
      };

      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Private-Key': wallet.privateKey
        },
        body: JSON.stringify({
          method: 'POST',
          endpoint,
          rpcUrl,
          payload
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const responseTime = (Date.now() - startTime) / 1000;

      if (!response.ok) {
        const errorData = await response.json();
        console.error('API Error:', errorData);
        return { 
          success: false, 
          error: errorData?.error || `Transaction failed with status ${response.status}`, 
          responseTime 
        };
      }

      const result = await response.json();
      if (result.status === 'accepted' || (typeof result === 'string' && result.toLowerCase().startsWith('ok'))) {
        const txHash = result.tx_hash || (typeof result === 'string' ? result.split(' ').pop() : undefined);
        mutate([`/balance/${wallet.address}`, rpcUrl, {}]);
        return { 
          success: true, 
          txHash, 
          responseTime, 
          message: `Successfully ${action}ed ${amount} OCT` 
        };
      } else {
        return { 
          success: false, 
          error: result.error || 'Unknown error', 
          responseTime 
        };
      }
    } catch (error) {
      console.error('Error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    } finally {
      setIsLoading(false);
    }
  };

  return { 
    encryptDecryptBalance, 
    isLoading 
  };
}

// Encrypted balance hook
export function useEncryptedBalance() {
  const { wallet } = useWallet();
  const rpcUrl = 'https://octra.network';
  
  const { 
    data: encryptedBalanceData, 
    error: _encryptedBalanceError, 
    isLoading: encryptedBalanceLoading 
  } = useSWR(
    wallet ? ['encrypted-balance', wallet.address] : null,
    async () => {
      if (!wallet) return null;
      
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Private-Key': wallet.privateKey
        },
        body: JSON.stringify({
          method: 'GET',
          endpoint: `/view_encrypted_balance/${wallet.address}`,
          rpcUrl
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch encrypted balance: ${response.status}`);
      }
      return await response.json();
    },
    { refreshInterval: 30000 }
  );

  return {
    publicBalance: encryptedBalanceData?.public_balance || 0,
    encryptedBalance: encryptedBalanceData?.encrypted_balance || 0,
    totalBalance: encryptedBalanceData?.total_balance || 0,
    isLoading: encryptedBalanceLoading,
  };
}