"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { validatePrivateKey, deriveAddress, derivePublicKey } from '@/lib/crypto';
import { fetchEncryptedBalance } from '@/lib/api';

// Define the shape of encrypted balance
interface EncryptedBalance {
  public: number;
  public_raw: number;
  encrypted: number;
  encrypted_raw: number;
  total: number;
}

// Define the shape of our wallet object
interface Wallet {
  privateKey: string;
  publicKey: string;
  address: string;
}

// Define the shape of the context value
interface WalletContextType {
  wallet: Wallet | null;
  isLoading: boolean;
  encryptedBalance: EncryptedBalance | null;
  refreshEncryptedBalance: () => Promise<void>;
  login: (privateKey: string) => void;
  logout: () => void;
}

// Create the context with a default value
const WalletContext = createContext<WalletContextType | undefined>(undefined);

// Create the provider component
export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [encryptedBalance, setEncryptedBalance] = useState<EncryptedBalance | null>(null);

  // Fetch encrypted balance
  const refreshEncryptedBalance = async () => {
    if (!wallet) return;
    
    try {
      const balanceData = await fetchEncryptedBalance(wallet.address, wallet.privateKey);
      
      if (balanceData) {
        setEncryptedBalance({
          public: parseFloat(balanceData.public_balance?.split(' ')[0] || '0'),
          public_raw: parseInt(balanceData.public_balance_raw || '0'),
          encrypted: parseFloat(balanceData.encrypted_balance?.split(' ')[0] || '0'),
          encrypted_raw: parseInt(balanceData.encrypted_balance_raw || '0'),
          total: parseFloat(balanceData.total_balance?.split(' ')[0] || '0')
        });
      }
    } catch (error) {
      console.error("Failed to fetch encrypted balance:", error);
      setEncryptedBalance(null);
    }
  };

  useEffect(() => {
    // On initial load, check if a wallet is saved in localStorage
    const loadWallet = async () => {
      try {
        const savedWallet = localStorage.getItem('octraWallet');
        if (savedWallet) {
          const parsedWallet = JSON.parse(savedWallet);
          setWallet(parsedWallet);
          
          // Load encrypted balance if wallet exists
          if (parsedWallet) {
            await refreshEncryptedBalance();
          }
        }
      } catch (error) {
        console.error("Failed to load wallet from storage:", error);
        localStorage.removeItem('octraWallet'); // Clear corrupted data
      } finally {
        setIsLoading(false);
      }
    };

    loadWallet();
  }, []);

  const login = async (privateKey: string) => {
    // This function will be called by the WalletSetup component
    validatePrivateKey(privateKey); // This will throw an error if invalid

    const newWallet: Wallet = {
      privateKey: privateKey,
      publicKey: derivePublicKey(privateKey),
      address: deriveAddress(privateKey),
    };

    localStorage.setItem('octraWallet', JSON.stringify(newWallet));
    setWallet(newWallet);
    
    // Refresh encrypted balance after login
    await refreshEncryptedBalance();
  };

  const logout = () => {
    // This will be called by the Header component
    localStorage.removeItem('octraWallet');
    setWallet(null);
    setEncryptedBalance(null);
  };

  return (
    <WalletContext.Provider value={{ 
      wallet, 
      isLoading, 
      encryptedBalance,
      refreshEncryptedBalance,
      login, 
      logout 
    }}>
      {children}
    </WalletContext.Provider>
  );
}

// Create a custom hook for easy access to the context
export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}