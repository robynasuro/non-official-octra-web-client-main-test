import useSWR, { useSWRConfig } from 'swr';
import { useWallet } from '@/context/WalletContext';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { useState, useCallback, useEffect, useMemo } from "react";
import { getKeyPair } from "@/lib/crypto";
import { sha256 } from 'js-sha256';

const MU_FACTOR = 1_000_000;
const DEFAULT_RPC_URL = 'https://octra.network';

// Helper function to derive encryption key
const deriveEncryptionKey = (privkeyB64: string): Uint8Array => {
  try {
    const privkeyBytes = Buffer.from(privkeyB64, 'base64');
    const salt = new TextEncoder().encode("octra_encrypted_balance_v2");
    const combined = new Uint8Array(salt.length + privkeyBytes.length);
    combined.set(salt);
    combined.set(privkeyBytes, salt.length);
    
    const hash = new Uint8Array(sha256.arrayBuffer(combined));
    return hash.slice(0, nacl.secretbox.keyLength);
  } catch (error) {
    console.error('Key derivation error:', error);
    throw new Error('Failed to derive encryption key');
  }
};

// Helper function to encrypt balance
const encryptClientBalance = (balance: number, privkeyB64: string): string => {
  try {
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
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt balance');
  }
};

// Enhanced proxy fetcher with better error handling
const createProxyFetcher = (wallet: { privateKey: string } | null) => {
  return async ([endpoint, rpcUrl = DEFAULT_RPC_URL, payload]: [string, string?, any?]) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (wallet?.privateKey) {
      headers['Authorization'] = `Bearer ${wallet.privateKey}`;
      headers['X-Private-Key'] = wallet.privateKey;
    }

    try {
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method: 'GET',
          endpoint,
          rpcUrl,
          payload
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('API Error:', {
          endpoint,
          status: response.status,
          error
        });
        throw new Error(error.error || 'Request failed');
      }

      const data = await response.json();
      
      // Ensure numeric values for balance endpoints
      if (endpoint.startsWith('/balance') || endpoint.startsWith('/view_encrypted_balance')) {
        if (typeof data.balance === 'string') {
          data.balance = parseFloat(data.balance);
        }
        if (typeof data.nonce === 'string') {
          data.nonce = parseInt(data.nonce);
        }
        if (typeof data.encrypted_balance === 'string') {
          data.encrypted_balance = parseFloat(data.encrypted_balance);
        }
        if (typeof data.public_balance === 'string') {
          data.public_balance = parseFloat(data.public_balance);
        }
      }
      
      return data;
    } catch (error) {
      console.error('Fetch Error:', {
        endpoint,
        error
      });
      throw error;
    }
  };
};

// Wallet balance hook with improved typing and error handling
export function useWalletBalance() {
  const { wallet } = useWallet();
  const fetcher = useCallback(createProxyFetcher(wallet), [wallet]);

  const { 
    data: balanceData, 
    error: balanceError, 
    isLoading: balanceLoading,
    mutate: mutateBalance
  } = useSWR(
    wallet ? [`/balance/${wallet.address}`, DEFAULT_RPC_URL] : null,
    fetcher,
    { 
      refreshInterval: 30000,
      revalidateOnFocus: false,
      dedupingInterval: 10000,
      shouldRetryOnError: true,
      errorRetryCount: 3
    }
  );

  const { 
    data: stagingData, 
    error: stagingError, 
    isLoading: stagingLoading,
    mutate: mutateStaging
  } = useSWR(
    wallet ? ['/staging', DEFAULT_RPC_URL] : null,
    fetcher,
    { 
      refreshInterval: 30000,
      revalidateOnFocus: false
    }
  );

  const getCombinedNonce = useCallback(() => {
    if (!wallet || !balanceData) return balanceData?.nonce ?? 0;
    const baseNonce = balanceData.nonce ?? 0;
    if (stagingData?.staged_transactions) {
      const ourStagedTxs = stagingData.staged_transactions.filter((tx: any) => tx.from === wallet.address);
      if (ourStagedTxs.length > 0) {
        const maxStagedNonce = Math.max(...ourStagedTxs.map((tx: any) => Number(tx.nonce)));
        return Math.max(baseNonce, maxStagedNonce);
      }
    }
    return baseNonce;
  }, [wallet, balanceData, stagingData]);

  const refresh = useCallback(async () => {
    await Promise.all([
      mutateBalance(),
      mutateStaging()
    ]);
  }, [mutateBalance, mutateStaging]);

  // Enhanced balance logging
  useEffect(() => {
    if (balanceData) {
      console.log('Balance updated:', {
        balance: balanceData.balance,
        nonce: balanceData.nonce,
        recentTransactions: balanceData.recent_transactions?.length || 0,
        time: new Date().toISOString()
      });
    }
  }, [balanceData]);

  return {
    publicBalance: balanceData?.balance || 0,
    nonce: getCombinedNonce(),
    isLoading: balanceLoading || stagingLoading,
    refresh,
    error: balanceError || stagingError
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

export function useTransactionHistory() {
  const { wallet } = useWallet();
  const fetcher = useCallback(createProxyFetcher(wallet), [wallet]);

  // Regular transactions
  const { data: addressData, mutate: mutateAddress } = useSWR(
    wallet ? [`/balance/${wallet.address}?limit=20`, DEFAULT_RPC_URL] : null,
    fetcher,
    { 
      refreshInterval: 60000, 
      revalidateOnFocus: false 
    }
  );

  // Private transactions
  const { data: privateTxData, mutate: mutatePrivateTx } = useSWR(
    wallet ? [`/private_transactions/${wallet.address}`, DEFAULT_RPC_URL] : null,
    fetcher,
    {
      refreshInterval: 30000,
      revalidateOnFocus: false
    }
  );

  // Pending private transfers
  const { data: pendingPrivateData, mutate: mutatePendingPrivate } = useSWR(
    wallet ? [`/pending_private_transfers/${wallet.address}`, DEFAULT_RPC_URL] : null,
    fetcher,
    {
      refreshInterval: 30000,
      revalidateOnFocus: false,
      onErrorRetry: (error) => {
        if (error.message.includes('Unknown route')) return;
      }
    }
  );

  // Transaction details
  const transactionHashes = addressData?.recent_transactions?.map((tx: TransactionReference) => tx.hash) || [];
  const { 
    data: transactionDetails, 
    error: detailsError, 
    isLoading: detailsLoading,
    mutate: mutateDetails
  } = useSWR(
    transactionHashes.length > 0 && wallet ? ['transaction-details', transactionHashes, DEFAULT_RPC_URL] : null,
    async ([_, hashes, rpcUrl]) => {
      const transactionPromises = hashes.map(async (hash: string) => {
        try { 
          const data = await fetcher([`/tx/${hash}`, rpcUrl]);
          return { hash, data }; 
        } catch (error) { 
          console.error('Failed to fetch tx details:', hash, error);
          return null; 
        }
      });
      const results = await Promise.all(transactionPromises);
      return results.filter(result => result !== null);
    },
    { 
      refreshInterval: 60000, 
      revalidateOnFocus: false, 
      dedupingInterval: 30000 
    }
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      mutateAddress(),
      mutatePrivateTx(),
      mutatePendingPrivate(),
      mutateDetails()
    ]);
  }, [mutateAddress, mutatePrivateTx, mutatePendingPrivate, mutateDetails]);

  const processedTransactions = useMemo((): ProcessedTransaction[] => {
    if (!wallet?.address) return [];
    
    const finalTransactions: ProcessedTransaction[] = [];
    const processedHashes = new Set<string>();
    
    const parseAmount = (amountRaw: string | undefined): number => {
      const amountStr = String(amountRaw || '0');
      return amountStr.includes('.') ? parseFloat(amountStr) : parseInt(amountStr) / MU_FACTOR;
    };

    // Process pending private transfers
    if (pendingPrivateData?.pending_transfers) {
      pendingPrivateData.pending_transfers.forEach((tx: any) => {
        if (processedHashes.has(tx.id)) return;
        
        finalTransactions.push({
          time: new Date(tx.created_at * 1000),
          hash: tx.id,
          amount: parseAmount(tx.amount),
          to: tx.recipient === wallet.address ? tx.sender : tx.recipient,
          type: tx.recipient === wallet.address ? 'in' : 'out',
          ok: true,
          nonce: tx.nonce,
          isPrivate: true,
          message: tx.message
        });
        processedHashes.add(tx.id);
      });
    }

    // Process private transactions
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

    return finalTransactions
      .sort((a, b) => b.time.getTime() - a.time.getTime())
      .slice(0, 50);
  }, [wallet?.address, privateTxData, pendingPrivateData, transactionDetails, addressData?.recent_transactions]);

  const isLoading = detailsLoading;
  
  return { 
    history: processedTransactions, 
    isLoading,
    refresh,
    pendingPrivateTransfers: pendingPrivateData?.pending_transfers || [],
    error: detailsError
  };
}

// Send transaction hook with enhanced error handling
interface SendTransactionParams { 
  to: string; 
  amount: number; 
  _nonce?: number; 
  message?: string; 
  isPrivate?: boolean;
}

interface SendTransactionResult { 
  success: boolean; 
  txHash?: string; 
  error?: string; 
  responseTime?: number; 
  poolInfo?: any; 
  message?: string; 
  ephemeralKey?: string;
}

export function useSendTransaction() {
  const { wallet } = useWallet();
  const { nonce, publicBalance: balance, refresh: refreshBalance } = useWalletBalance();
  const [isLoading, setIsLoading] = useState(false);
  const { mutate } = useSWRConfig();

  const sendTransaction = async ({ 
    to, 
    amount, 
    _nonce, 
    message,
    isPrivate = false
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
        amount: String(Math.floor(amount * MU_FACTOR)), 
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
      
      const endpoint = isPrivate ? '/private_transfer' : '/send-tx';
      const payload = isPrivate ? {
        ...signedTransaction,
        from_private_key: wallet.privateKey
      } : signedTransaction;
      
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('/api/proxy', { 
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${wallet.privateKey}`,
          'X-Private-Key': wallet.privateKey
        }, 
        body: JSON.stringify({ 
          method: 'POST', 
          endpoint, 
          rpcUrl: DEFAULT_RPC_URL, 
          payload
        }), 
        signal: controller.signal 
      });
      
      clearTimeout(timeoutId);
      const responseTime = (Date.now() - startTime) / 1000;
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Transaction failed:', {
          endpoint,
          status: response.status,
          error: errorData
        });
        return { 
          success: false, 
          error: errorData.error || 'Transaction failed', 
          responseTime 
        };
      }
      
      const result = await response.json();
      let txHash: string | undefined;
      let ephemeralKey: string | undefined;
      let success = false;
      
      if (result.status === 'accepted') { 
        success = true; 
        txHash = result.tx_hash;
        ephemeralKey = result.ephemeral_key;
      } else if (typeof result === 'string' && result.toLowerCase().startsWith('ok')) { 
        success = true; 
        txHash = result.split(' ').pop(); 
      }
      
      if (success && txHash) {
        // Invalidate all relevant caches
        await Promise.all([
          refreshBalance(),
          mutate([`/balance/${wallet.address}`, DEFAULT_RPC_URL]),
          mutate(['/staging', DEFAULT_RPC_URL])
        ]);
        
        return { 
          success, 
          txHash, 
          ephemeralKey,
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
      console.error('Transaction error:', error);
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

// Encryption/decryption hook with improved error handling
export function useEncryptDecrypt() {
  const { wallet } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const { mutate } = useSWRConfig();

  const encryptDecryptBalance = async (
    amount: number, 
    action: 'encrypt' | 'decrypt'
  ): Promise<SendTransactionResult> => {
    if (!wallet) return { success: false, error: 'Wallet not connected' };
    
    setIsLoading(true);
    try {
      // Get current encrypted balance
      const encData = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${wallet.privateKey}`,
          'X-Private-Key': wallet.privateKey
        },
        body: JSON.stringify({
          method: 'GET',
          endpoint: `/view_encrypted_balance/${wallet.address}`,
          rpcUrl: DEFAULT_RPC_URL
        })
      });
      
      if (!encData.ok) {
        const error = await encData.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to get encrypted balance');
      }
      
      const balanceData = await encData.json();
      const currentEncryptedRaw = parseInt(balanceData.encrypted_balance_raw || '0');
      const amountRaw = Math.floor(amount * MU_FACTOR);
      
      let newEncryptedRaw: number;
      if (action === 'encrypt') {
        newEncryptedRaw = currentEncryptedRaw + amountRaw;
      } else {
        if (currentEncryptedRaw < amountRaw) {
          throw new Error('Insufficient encrypted balance');
        }
        newEncryptedRaw = currentEncryptedRaw - amountRaw;
      }
      
      // Encrypt the new balance
      const encryptedValue = encryptClientBalance(newEncryptedRaw, wallet.privateKey);
      
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
          'Authorization': `Bearer ${wallet.privateKey}`,
          'X-Private-Key': wallet.privateKey
        },
        body: JSON.stringify({
          method: 'POST',
          endpoint,
          rpcUrl: DEFAULT_RPC_URL,
          payload
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const responseTime = (Date.now() - startTime) / 1000;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('API Error:', {
          endpoint,
          status: response.status,
          error: errorData
        });
        return { 
          success: false, 
          error: errorData?.error || `Transaction failed with status ${response.status}`, 
          responseTime 
        };
      }

      const result = await response.json();
      if (result.status === 'accepted' || (typeof result === 'string' && result.toLowerCase().startsWith('ok'))) {
        const txHash = result.tx_hash || (typeof result === 'string' ? result.split(' ').pop() : undefined);
        
        // Invalidate all relevant caches
        await Promise.all([
          mutate([`/balance/${wallet.address}`, DEFAULT_RPC_URL]),
          mutate([`/view_encrypted_balance/${wallet.address}`, DEFAULT_RPC_URL])
        ]);
        
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
      console.error('Encrypt/Decrypt error:', error);
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

// Encrypted balance hook with improved typing
export function useEncryptedBalance() {
  const { wallet } = useWallet();
  const fetcher = useCallback(createProxyFetcher(wallet), [wallet]);
  
  const { 
    data: encryptedBalanceData, 
    error: encryptedBalanceError, 
    isLoading: encryptedBalanceLoading,
    mutate: mutateEncryptedBalance
  } = useSWR(
    wallet ? [`/view_encrypted_balance/${wallet.address}`, DEFAULT_RPC_URL] : null,
    fetcher,
    { 
      refreshInterval: 30000,
      revalidateOnFocus: false,
      onErrorRetry: (error) => {
        if (error.message.includes('Unknown route')) return;
      }
    }
  );

  const refresh = useCallback(() => {
    mutateEncryptedBalance();
  }, [mutateEncryptedBalance]);

  useEffect(() => {
    if (encryptedBalanceData) {
      console.log('Encrypted balance updated:', {
        public: encryptedBalanceData.public_balance,
        private: encryptedBalanceData.encrypted_balance,
        total: encryptedBalanceData.total_balance,
        time: new Date().toISOString()
      });
    }
  }, [encryptedBalanceData]);

  return {
    publicBalance: encryptedBalanceData?.public_balance || 0,
    encryptedBalance: encryptedBalanceData?.encrypted_balance || 0,
    totalBalance: encryptedBalanceData?.total_balance || 0,
    publicRaw: parseInt(encryptedBalanceData?.public_balance_raw || '0'),
    encryptedRaw: parseInt(encryptedBalanceData?.encrypted_balance_raw || '0'),
    isLoading: encryptedBalanceLoading,
    refresh,
    error: encryptedBalanceError
  };
}

// Private transfers hook with enhanced error handling
export function usePrivateTransfers() {
  const { wallet } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const { mutate } = useSWRConfig();
  
  const getPendingPrivateTransfers = async () => {
    if (!wallet) return [];
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${wallet.privateKey}`,
          'X-Private-Key': wallet.privateKey
        },
        body: JSON.stringify({
          method: 'GET',
          endpoint: `/pending_private_transfers/${wallet.address}`,
          rpcUrl: DEFAULT_RPC_URL
        })
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (response.status === 500 && error.error?.includes('Unknown route')) {
          return [];
        }
        throw new Error(error.error || 'Failed to fetch pending transfers');
      }
      
      const data = await response.json();
      return data.pending_transfers || [];
    } catch (error) {
      console.error('Error fetching pending transfers:', error);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const claimPrivateTransfer = async (transferId: string) => {
    if (!wallet) return { success: false, error: 'Wallet not connected' };
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${wallet.privateKey}`,
          'X-Private-Key': wallet.privateKey
        },
        body: JSON.stringify({
          method: 'POST',
          endpoint: '/claim_private_transfer',
          rpcUrl: DEFAULT_RPC_URL,
          payload: {
            transfer_id: transferId,
            recipient_address: wallet.address,
            private_key: wallet.privateKey
          }
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Claim failed');
      }
      
      const result = await response.json();
      
      // Invalidate all relevant caches
      await Promise.all([
        mutate([`/balance/${wallet.address}`, DEFAULT_RPC_URL]),
        mutate([`/pending_private_transfers/${wallet.address}`, DEFAULT_RPC_URL]),
        mutate([`/view_encrypted_balance/${wallet.address}`, DEFAULT_RPC_URL])
      ]);
      
      return { 
        success: true, 
        amount: result.amount,
        txHash: result.tx_hash
      };
    } catch (error) {
      console.error('Claim error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Claim failed' 
      };
    } finally {
      setIsLoading(false);
    }
  };

  return {
    getPendingPrivateTransfers,
    claimPrivateTransfer,
    isLoading
  };
}