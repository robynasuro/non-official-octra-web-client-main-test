import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Copy, Droplets, Send, Lock, Unlock, Mail, Download } from "lucide-react";
import { SendDialog } from "./send-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useWallet } from "@/context/WalletContext";
import { useWalletBalance, useEncryptDecrypt, useEncryptedBalance } from "@/hooks/use-wallet-data";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { saveAs } from "file-saver";

export function Sidebar() {
  const { wallet } = useWallet();
  const { balance, nonce, isLoading: balanceLoading } = useWalletBalance();
  const { encryptedBalance, isLoading: encryptedBalanceLoading } = useEncryptedBalance();
  const { encryptDecryptBalance, isLoading: txLoading } = useEncryptDecrypt();

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Dialog states
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [decryptOpen, setDecryptOpen] = useState(false);
  const [privateTransferOpen, setPrivateTransferOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  
  // Form states
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [claimId, setClaimId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingTransfers, setPendingTransfers] = useState<any[]>([]);

  const handleEncrypt = async () => {
    if (!amount) {
      setMessage("Please enter an amount");
      return;
    }
    
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setMessage("Invalid amount");
      return;
    }

    setLoading(true);
    try {
      const result = await encryptDecryptBalance(amt, 'encrypt');
      setMessage(result.error || `Successfully encrypted ${amt} OCT`);
      if (result.success && result.txHash) {
        window.open(`https://octrascan.io/tx/${result.txHash}`, '_blank');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Encryption failed");
    } finally {
      setLoading(false);
      setEncryptOpen(false);
      setAmount("");
    }
  };

  const handleDecrypt = async () => {
    if (!amount) {
      setMessage("Please enter an amount");
      return;
    }
    
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setMessage("Invalid amount");
      return;
    }

    setLoading(true);
    try {
      const result = await encryptDecryptBalance(amt, 'decrypt');
      setMessage(result.error || `Successfully decrypted ${amt} OCT`);
      if (result.success && result.txHash) {
        window.open(`https://octrascan.io/tx/${result.txHash}`, '_blank');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decryption failed");
    } finally {
      setLoading(false);
      setDecryptOpen(false);
      setAmount("");
    }
  };

  const createPrivateTransfer = async (toAddr: string, amount: number) => {
    setLoading(true);
    try {
      const response = await fetch("/api/proxy", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Private-Key": wallet?.privateKey || ""
        },
        body: JSON.stringify({
          method: "POST",
          endpoint: "/private_transfer",
          rpcUrl: "https://octra.network",
          payload: {
            from: wallet?.address,
            to: toAddr,
            amount: String(Math.floor(amount * 1_000_000)),
            private_key: wallet?.privateKey
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Private transfer failed");
      }
      
      setMessage(`Private transfer submitted! Transaction hash: ${data.tx_hash}`);
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Private transfer failed");
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const getPendingTransfers = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/proxy", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Private-Key": wallet?.privateKey || ""
        },
        body: JSON.stringify({
          method: "GET",
          endpoint: `/pending_private_transfers/${wallet?.address}`,
          rpcUrl: "https://octra.network",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch transfers");
      }
      
      setPendingTransfers(data.pending_transfers || []);
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to fetch transfers");
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const claimPrivateTransfer = async (transferId: string) => {
    setLoading(true);
    try {
      const response = await fetch("/api/proxy", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Private-Key": wallet?.privateKey || ""
        },
        body: JSON.stringify({
          method: "POST",
          endpoint: "/claim_private_transfer",
          rpcUrl: "https://octra.network",
          payload: {
            transfer_id: transferId,
            recipient_address: wallet?.address,
            private_key: wallet?.privateKey
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Claim failed");
      }
      
      setMessage(`Successfully claimed transfer! Transaction hash: ${data.tx_hash}`);
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Claim failed");
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handlePrivateTransfer = async () => {
    if (!address) {
      setMessage("Please enter recipient address");
      return;
    }
    
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setMessage("Invalid amount");
      return;
    }

    try {
      await createPrivateTransfer(address, amt);
      setPrivateTransferOpen(false);
      setAddress("");
      setAmount("");
    } catch {
      // Error already handled in createPrivateTransfer
    }
  };

  const handleClaim = async () => {
    if (!claimId) {
      setMessage("Please select a transfer to claim");
      return;
    }

    try {
      await claimPrivateTransfer(claimId);
      setClaimOpen(false);
      setClaimId("");
      // Refresh pending transfers
      await getPendingTransfers();
    } catch {
      // Error already handled in claimPrivateTransfer
    }
  };

  const handleExport = () => {
    if (!wallet?.privateKey) {
      setMessage("No private key available");
      return;
    }

    try {
      const data = { 
        privateKey: wallet.privateKey, 
        address: wallet.address, 
        publicKey: wallet.publicKey,
        network: "https://octra.network"
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      saveAs(blob, `octra_wallet_${Date.now()}.json`);
      setMessage("Wallet exported successfully!");
      setExportOpen(false);
    } catch (error) {
      setMessage("Failed to export wallet");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallet Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Balance Display */}
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Regular Balance</p>
          {balanceLoading ? <Skeleton className="h-8 w-3/4" /> : <p className="text-2xl font-bold">{Number(balance).toFixed(6)} OCT</p>}
        </div>
        
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Encrypted Balance</p>
          {encryptedBalanceLoading ? <Skeleton className="h-8 w-3/4" /> : <p className="text-2xl font-bold">{Number(encryptedBalance).toFixed(6)} OCT</p>}
        </div>
        
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Nonce</p>
          {balanceLoading ? <Skeleton className="h-7 w-1/4" /> : <p className="text-lg font-mono">{nonce}</p>}
        </div>
        
        <Separator />
        
        {/* Address Info */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Address</p>
          <div className="flex items-center space-x-2">
            <p 
              className="text-sm font-mono break-all text-muted-foreground cursor-pointer hover:underline" 
              onClick={() => wallet?.address && window.open(`https://octrascan.io/addr/${wallet.address}`, "_blank")}
            >
              {wallet?.address ? `${wallet.address.substring(0, 12)}...${wallet.address.substring(wallet.address.length - 8)}` : 'Not connected'}
            </p>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => wallet?.address && handleCopy(wallet.address)}
                    disabled={!wallet?.address}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Copy Address</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Public Key</p>
          <div className="flex items-center space-x-2">
            <p className="text-sm font-mono break-all text-muted-foreground">
              {wallet?.publicKey ? `${wallet.publicKey.substring(0, 12)}...` : 'Not connected'}
            </p>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => wallet?.publicKey && handleCopy(wallet.publicKey)}
                    disabled={!wallet?.publicKey}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Copy Public Key</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        
        <Separator />
        
        {/* Action Buttons */}
        <div className="space-y-2">
          <SendDialog>
            <Button className="w-full" disabled={!wallet}>
              <Send className="w-4 h-4 mr-2" />Send
            </Button>
          </SendDialog>
        </div>
        
        <div className="space-y-2">
          <Dialog open={encryptOpen} onOpenChange={setEncryptOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" disabled={!wallet}>
                <Lock className="w-4 h-4 mr-2" />Encrypt Balance
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Encrypt Balance</DialogTitle>
                <DialogDescription>Enter amount to encrypt</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Input 
                  type="number" 
                  placeholder="0.0" 
                  value={amount} 
                  onChange={(e) => setAmount(e.target.value)} 
                  step="0.000001" 
                  min="0" 
                />
              </div>
              <DialogFooter>
                <Button onClick={handleEncrypt} disabled={loading || txLoading}>
                  {loading || txLoading ? "Processing..." : "Encrypt"}
                </Button>
              </DialogFooter>
              {message && <p className="text-sm text-center">{message}</p>}
            </DialogContent>
          </Dialog>
        </div>
        
        <div className="space-y-2">
          <Dialog open={decryptOpen} onOpenChange={setDecryptOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" disabled={!wallet}>
                <Unlock className="w-4 h-4 mr-2" />Decrypt Balance
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Decrypt Balance</DialogTitle>
                <DialogDescription>Enter amount to decrypt</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Input 
                  type="number" 
                  placeholder="0.0" 
                  value={amount} 
                  onChange={(e) => setAmount(e.target.value)} 
                  step="0.000001" 
                  min="0" 
                />
              </div>
              <DialogFooter>
                <Button onClick={handleDecrypt} disabled={loading || txLoading}>
                  {loading || txLoading ? "Processing..." : "Decrypt"}
                </Button>
              </DialogFooter>
              {message && <p className="text-sm text-center">{message}</p>}
            </DialogContent>
          </Dialog>
        </div>
        
        <div className="space-y-2">
          <Dialog open={privateTransferOpen} onOpenChange={setPrivateTransferOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" disabled={!wallet}>
                <Mail className="w-4 h-4 mr-2" />Private Transfer
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Private Transfer</DialogTitle>
                <DialogDescription>Enter recipient address and amount</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Input 
                  placeholder="oct1..." 
                  value={address} 
                  onChange={(e) => setAddress(e.target.value)} 
                />
                <Input 
                  type="number" 
                  placeholder="0.0" 
                  value={amount} 
                  onChange={(e) => setAmount(e.target.value)} 
                  step="0.000001" 
                  min="0" 
                />
              </div>
              <DialogFooter>
                <Button onClick={handlePrivateTransfer} disabled={loading}>
                  {loading ? "Processing..." : "Send"}
                </Button>
              </DialogFooter>
              {message && <p className="text-sm text-center">{message}</p>}
            </DialogContent>
          </Dialog>
        </div>
        
        <div className="space-y-2">
          <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" disabled={!wallet}>
                <Mail className="w-4 h-4 mr-2" />Claim Transfers
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Claim Transfers</DialogTitle>
                <DialogDescription>Select transfer to claim</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Button onClick={getPendingTransfers} disabled={loading}>
                  Refresh Transfers
                </Button>
                
                {pendingTransfers.length > 0 ? (
                  <div className="max-h-60 overflow-y-auto">
                    {pendingTransfers.map((t, i) => (
                      <div key={i} className="flex justify-between items-center py-2 border-b">
                        <div className="text-sm">
                          <p>From: {t.sender}</p>
                          <p>Amount: {(t.amount / 1_000_000).toFixed(6)} OCT</p>
                        </div>
                        <Button 
                          size="sm" 
                          onClick={() => {
                            setClaimId(t.id);
                            handleClaim();
                          }}
                          disabled={loading}
                        >
                          Claim
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-center">No pending transfers</p>
                )}
              </div>
              {message && <p className="text-sm text-center">{message}</p>}
            </DialogContent>
          </Dialog>
        </div>
        
        <div className="space-y-2">
          <Dialog open={exportOpen} onOpenChange={setExportOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" disabled={!wallet}>
                <Download className="w-4 h-4 mr-2" />
                Export Keys
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Export Keys</DialogTitle>
                <DialogDescription>Export or copy your private key</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex items-center space-x-2">
                  <Button variant="outline" onClick={() => wallet?.privateKey && handleCopy(wallet.privateKey)}>
                    <Copy className="w-4 h-4 mr-2" /> Copy Private Key
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleExport} disabled={loading}>
                  {loading ? "Processing..." : "Export to File"}
                </Button>
              </DialogFooter>
              {message && <p className="text-sm text-center">{message}</p>}
            </DialogContent>
          </Dialog>
        </div>
        
        <div className="space-y-2">
          <Button 
            className="w-full" 
            variant="outline" 
            onClick={() => window.open("https://faucet.octra.network/", "_blank")}
          >
            <Droplets className="w-4 h-4 mr-2" />Faucet
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}