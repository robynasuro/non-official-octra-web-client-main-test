// lib/api.ts

/**
 * A generic SWR fetcher function that uses the native fetch API
 * and our Next.js API proxy route.
 */
const fetcher = async (key: [string, string, object?]) => {
  const [endpoint, rpcUrl, payload = {}] = key;

  const response = await fetch('/api/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      method: payload && Object.keys(payload).length > 0 ? 'POST' : 'GET',
      endpoint,
      rpcUrl,
      payload: {
        address: endpoint.split('/').pop(),
        ...payload,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'An error occurred while fetching the data.');
  }

  return response.json();
};

/**
 * Fetches encrypted balance data for a given address
 */
const fetchEncryptedBalance = async (address: string, privateKey: string) => {
  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Private-Key': privateKey
      },
      body: JSON.stringify({
        method: 'GET',
        endpoint: `/view_encrypted_balance/${address}`,
        rpcUrl: 'https://octra.network'
      })
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return {
      public_balance: data.public_balance || '0 OCT',
      public_balance_raw: data.public_balance_raw || '0',
      encrypted_balance: data.encrypted_balance || '0 OCT',
      encrypted_balance_raw: data.encrypted_balance_raw || '0',
      total_balance: data.total_balance || '0 OCT'
    };
  } catch (error) {
    console.error('Error fetching encrypted balance:', error);
    return null;
  }
};

/**
 * Encrypts a specified amount of balance
 */
const encryptBalance = async (address: string, amount: number, privateKey: string) => {
  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Private-Key': privateKey
      },
      body: JSON.stringify({
        method: 'POST',
        endpoint: '/encrypt_balance',
        rpcUrl: 'https://octra.network',
        payload: {
          address,
          amount: Math.floor(amount * 1000000).toString(),
          private_key: privateKey
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Encryption failed' };
    }
    
    return await response.json();
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Encryption failed' 
    };
  }
};

/**
 * Decrypts a specified amount of balance
 */
const decryptBalance = async (address: string, amount: number, privateKey: string) => {
  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Private-Key': privateKey
      },
      body: JSON.stringify({
        method: 'POST',
        endpoint: '/decrypt_balance',
        rpcUrl: 'https://octra.network',
        payload: {
          address,
          amount: Math.floor(amount * 1000000).toString(),
          private_key: privateKey
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Decryption failed' };
    }
    
    return await response.json();
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Decryption failed' 
    };
  }
};

/**
 * Creates a private transfer
 */
const createPrivateTransfer = async (
  fromAddress: string,
  toAddress: string,
  amount: number,
  privateKey: string
) => {
  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Private-Key': privateKey
      },
      body: JSON.stringify({
        method: 'POST',
        endpoint: '/private_transfer',
        rpcUrl: 'https://octra.network',
        payload: {
          from: fromAddress,
          to: toAddress,
          amount: Math.floor(amount * 1000000).toString(),
          from_private_key: privateKey
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Private transfer failed' };
    }
    
    return await response.json();
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Private transfer failed' 
    };
  }
};

/**
 * Gets pending private transfers for an address
 */
const getPendingPrivateTransfers = async (address: string, privateKey: string) => {
  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Private-Key': privateKey
      },
      body: JSON.stringify({
        method: 'GET',
        endpoint: `/pending_private_transfers/${address}`,
        rpcUrl: 'https://octra.network'
      })
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.pending_transfers || [];
  } catch (error) {
    console.error('Error fetching pending transfers:', error);
    return [];
  }
};

/**
 * Claims a private transfer
 */
const claimPrivateTransfer = async (
  recipientAddress: string,
  privateKey: string,
  transferId: string
) => {
  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Private-Key': privateKey
      },
      body: JSON.stringify({
        method: 'POST',
        endpoint: '/claim_private_transfer',
        rpcUrl: 'https://octra.network',
        payload: {
          recipient_address: recipientAddress,
          private_key: privateKey,
          transfer_id: transferId
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Claim failed' };
    }
    
    return await response.json();
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Claim failed' 
    };
  }
};

// Single export at the bottom of the file
export {
  fetcher,
  fetchEncryptedBalance,
  encryptBalance,
  decryptBalance,
  createPrivateTransfer,
  getPendingPrivateTransfers,
  claimPrivateTransfer
};