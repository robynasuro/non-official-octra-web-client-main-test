import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Copy, Droplets, Send, Lock, Unlock, Download, Gift, Shield, RefreshCw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { SendDialog } from "./send-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWallet } from "@/context/WalletContext";
import { useWalletBalance, useEncryptedBalance } from "@/hooks/use-wallet-data";
import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { saveAs } from "file-saver";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const MU_FACTOR = 1_000_000;

export function Sidebar() {
  const { wallet, refreshEncryptedBalance } = useWallet();
  const { 
    publicBalance = 0, 
    refresh: refreshPublicBalance 
  } = useWalletBalance();
  const { 
    encryptedBalance: encryptedBal = 0,
    error: encryptedBalanceError
  } = useEncryptedBalance();
  
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [decryptOpen, setDecryptOpen] = useState(false);
  const [privateTransferOpen, setPrivateTransferOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [claimId, setClaimId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingTransfers, setPendingTransfers] = useState<any[]>([]);

  const maxEncryptable = Math.max(0, publicBalance - 1.0);

  const makeProxyRequest = async (method: string, endpoint: string, payload?: any) => {
    if (!wallet?.privateKey) {
      throw new Error("Wallet not connected");
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${wallet.privateKey}`,
      'X-Private-Key': wallet.privateKey
    };

    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        method,
        endpoint,
        rpcUrl: 'https://octra.network',
        payload
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Request failed");
    }

    return response.json();
  };

  const refreshAllBalances = async () => {
    try {
      await Promise.all([
        refreshPublicBalance(),
        refreshEncryptedBalance()
      ]);
    } catch (error) {
      console.error('Balance refresh error:', error);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setMessage("Copied to clipboard!");
    setTimeout(() => setMessage(""), 3000);
  };

  const safeToFixed = (value: any, decimals: number = 6): string => {
    const num = typeof value === 'number' ? value :
               typeof value === 'string' ? parseFloat(value) : 0;
    return num.toFixed(decimals);
  };

  const handleEncrypt = async () => {
    if (!wallet || !amount) {
      setMessage("Please enter an amount");
      return;
    }
    
    const amt = parseFloat(amount);
    if (isNaN(amt)) {
      setMessage("Invalid amount");
      return;
    }

    if (amt <= 0) {
      setMessage("Amount must be positive");
      return;
    }

    if (amt > maxEncryptable) {
      setMessage(`Amount exceeds maximum encryptable balance (${safeToFixed(maxEncryptable)} OCT)`);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const amountRaw = Math.floor(amt * MU_FACTOR);
      await makeProxyRequest('POST', '/encrypt_balance', {
        address: wallet.address,
        amount: amountRaw.toString(),
        private_key: wallet.privateKey
      });

      setMessage(`Successfully encrypted ${safeToFixed(amt)} OCT`);
      setTimeout(refreshAllBalances, 2000);
      setEncryptOpen(false);
      setAmount("");
    } catch (error: any) {
      console.error('Encryption error:', error);
      setMessage(error.message || "Encryption failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDecrypt = async () => {
    if (!wallet || !amount) {
      setMessage("Please enter an amount");
      return;
    }
    
    const amt = parseFloat(amount);
    if (isNaN(amt)) {
      setMessage("Invalid amount");
      return;
    }

    if (amt <= 0) {
      setMessage("Amount must be positive");
      return;
    }

    if (amt > Number(encryptedBal)) {
      setMessage(`Amount exceeds encrypted balance (${safeToFixed(encryptedBal)} OCT)`);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const amountRaw = Math.floor(amt * MU_FACTOR);
      await makeProxyRequest('POST', '/decrypt_balance', {
        address: wallet.address,
        amount: amountRaw.toString(),
        private_key: wallet.privateKey
      });

      setMessage(`Successfully decrypted ${safeToFixed(amt)} OCT`);
      setTimeout(refreshAllBalances, 2000);
      setDecryptOpen(false);
      setAmount("");
    } catch (error: any) {
      console.error('Decryption error:', error);
      setMessage(error.message || "Decryption failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePrivateTransfer = async () => {
    if (!wallet || !recipient || !amount) {
      setMessage("Please fill all fields");
      return;
    }
    
    const amt = parseFloat(amount);
    if (isNaN(amt)) {
      setMessage("Invalid amount");
      return;
    }

    if (amt <= 0) {
      setMessage("Amount must be positive");
      return;
    }

    if (amt > Number(encryptedBal)) {
      setMessage(`Amount exceeds encrypted balance (${safeToFixed(encryptedBal)} OCT)`);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const amountRaw = Math.floor(amt * MU_FACTOR);
      await makeProxyRequest('POST', '/private_transfer', {
        from: wallet.address,
        to: recipient,
        amount: amountRaw.toString(),
        from_private_key: wallet.privateKey
      });

      setMessage("Private transfer submitted!");
      setTimeout(refreshEncryptedBalance, 2000);
      setPrivateTransferOpen(false);
      setRecipient("");
      setAmount("");
    } catch (error: any) {
      console.error('Private transfer error:', error);
      setMessage(error.message || "Private transfer failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const loadPendingTransfers = async () => {
    if (!wallet) return;
    
    setLoading(true);
    setMessage("");
    try {
      const data = await makeProxyRequest('GET', `/pending_private_transfers/${wallet.address}`);
      setPendingTransfers(data.pending_transfers || []);
    } catch (error: any) {
      console.error('Failed to load transfers:', error);
      setMessage(error.message || "Failed to load transfers");
      setPendingTransfers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!wallet || !claimId) {
      setMessage("Please select a transfer to claim");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      await makeProxyRequest('POST', '/claim_private_transfer', {
        recipient_address: wallet.address,
        private_key: wallet.privateKey,
        transfer_id: claimId
      });

      setMessage("Successfully claimed transfer!");
      await refreshAllBalances();
      await loadPendingTransfers();
      setClaimId("");
    } catch (error: any) {
      console.error('Claim error:', error);
      setMessage(error.message || "Claim failed");
    } finally {
      setLoading(false);
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
      console.error('Export error:', error);
      setMessage("Failed to export wallet");
    }
  };

  useEffect(() => {
    if (encryptedBalanceError) {
      console.error('Encrypted balance error:', encryptedBalanceError);
      setMessage(`Failed to load encrypted balance: ${encryptedBalanceError.message || encryptedBalanceError}`);
    }
  }, [encryptedBalanceError]);

  if (!wallet) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Wallet Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <div className="flex items-start space-x-3">
              <Shield className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <AlertDescription>
                No wallet connected. Please connect or create a wallet to view details.
              </AlertDescription>
            </div>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallet Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1">
          <Label className="text-sm font-medium text-muted-foreground">Public Balance</Label>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold">{safeToFixed(publicBalance)} OCT</p>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={refreshPublicBalance}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        <div className="space-y-1">
          <Label className="text-sm font-medium text-muted-foreground">Encrypted Balance</Label>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-yellow-600">{safeToFixed(encryptedBal)} OCT</p>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={refreshEncryptedBalance}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        <Separator />
        
        <div className="space-y-2">
          <Label className="text-sm font-medium text-muted-foreground">Address</Label>
          <div className="flex items-center space-x-2">
            <p 
              className="text-sm font-mono break-all text-muted-foreground cursor-pointer hover:underline" 
              onClick={() => wallet?.address && window.open(`https://octrascan.io/addr/${wallet.address}`, "_blank")}
            >
              {wallet?.address ? `${wallet.address.substring(0, 12)}...${wallet.address.substring(wallet.address.length - 8)}` : 'Not connected'}
            </p>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => wallet?.address && handleCopy(wallet.address)}
              disabled={!wallet?.address}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label className="text-sm font-medium text-muted-foreground">Public Key</Label>
          <div className="flex items-center space-x-2">
            <p className="text-sm font-mono break-all text-muted-foreground">
              {wallet?.publicKey ? `${wallet.publicKey.substring(0, 12)}...` : 'Not connected'}
            </p>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => wallet?.publicKey && handleCopy(wallet.publicKey)}
              disabled={!wallet?.publicKey}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        <Separator />
        
        <div className="space-y-4">
          <SendDialog>
            <Button className="w-full">
              <Send className="w-4 h-4 mr-2" />Send Public
            </Button>
          </SendDialog>

          <Dialog open={encryptOpen} onOpenChange={setEncryptOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" variant="outline">
                <Lock className="w-4 h-4 mr-2" />Encrypt Balance
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Encrypt Balance</DialogTitle>
                <DialogDescription>
                  Convert public OCT to private OCT. Requires transaction fee.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Available Public Balance</Label>
                  <div className="p-2 bg-muted rounded-md font-mono">
                    {safeToFixed(publicBalance)} OCT
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Amount to Encrypt</Label>
                  <Input
                    type="number"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    step="0.000001"
                    min="0"
                    max={maxEncryptable}
                  />
                  <p className="text-xs text-muted-foreground">
                    Max: {safeToFixed(maxEncryptable)} OCT (1 OCT reserved for fees)
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleEncrypt} disabled={loading}>
                  {loading ? "Processing..." : "Encrypt"}
                </Button>
              </DialogFooter>
              {message && (
                <Alert variant={message.includes("Success") ? "default" : "destructive"}>
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={decryptOpen} onOpenChange={setDecryptOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" variant="outline">
                <Unlock className="w-4 h-4 mr-2" />Decrypt Balance
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Decrypt Balance</DialogTitle>
                <DialogDescription>
                  Convert private OCT back to public OCT. Requires transaction fee.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Available Private Balance</Label>
                  <div className="p-2 bg-muted rounded-md font-mono text-yellow-600">
                    {safeToFixed(encryptedBal)} OCT
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Amount to Decrypt</Label>
                  <Input
                    type="number"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    step="0.000001"
                    min="0"
                    max={encryptedBal}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleDecrypt} disabled={loading}>
                  {loading ? "Processing..." : "Decrypt"}
                </Button>
              </DialogFooter>
              {message && (
                <Alert variant={message.includes("Success") ? "default" : "destructive"}>
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={privateTransferOpen} onOpenChange={setPrivateTransferOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" variant="outline">
                <Shield className="w-4 h-4 mr-2" />Private Transfer
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Private Transfer</DialogTitle>
                <DialogDescription>
                  Send private OCT to another address. Recipient can claim in next epoch.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Available Private Balance</Label>
                  <div className="p-2 bg-muted rounded-md font-mono text-yellow-600">
                    {safeToFixed(encryptedBal)} OCT
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Recipient Address</Label>
                  <Input
                    placeholder="oct1..."
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    step="0.000001"
                    min="0"
                    max={encryptedBal}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handlePrivateTransfer} disabled={loading}>
                  {loading ? "Processing..." : "Send Private Transfer"}
                </Button>
              </DialogFooter>
              {message && (
                <Alert variant={message.includes("Success") ? "default" : "destructive"}>
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={claimOpen} onOpenChange={(open) => {
            setClaimOpen(open);
            if (open) loadPendingTransfers();
          }}>
            <DialogTrigger asChild>
              <Button className="w-full" variant="outline">
                <Gift className="w-4 h-4 mr-2" />Claim Private Transfers
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Claim Private Transfers</DialogTitle>
                <DialogDescription>
                  Claim private OCT sent to your address
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {pendingTransfers.length > 0 ? (
                  <ScrollArea className="h-64 rounded-md border">
                    <div className="p-4 space-y-4">
                      {pendingTransfers.map((transfer) => (
                        <div key={transfer.id} className="flex items-center justify-between p-3 border rounded-md">
                          <div>
                            <p className="text-sm font-medium">
                              From: {transfer.sender.substring(0, 12)}...{transfer.sender.slice(-8)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Amount: {safeToFixed(transfer.amount / MU_FACTOR)} OCT
                            </p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => {
                              setClaimId(transfer.id);
                              handleClaim();
                            }}
                            disabled={loading}
                          >
                            Claim
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <Alert>
                    <AlertDescription>No pending private transfers found</AlertDescription>
                  </Alert>
                )}
              </div>
              {message && (
                <Alert variant={message.includes("Success") ? "default" : "destructive"}>
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={exportOpen} onOpenChange={setExportOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" variant="outline">
                <Download className="w-4 h-4 mr-2" />Export Wallet
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Export Wallet</DialogTitle>
                <DialogDescription>
                  Backup your wallet private key securely
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Alert variant="destructive">
                  <AlertDescription>
                    Warning: Anyone with your private key can access your funds. Store it securely.
                  </AlertDescription>
                </Alert>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => wallet.privateKey && handleCopy(wallet.privateKey)}
                >
                  <Copy className="w-4 h-4 mr-2" /> Copy Private Key
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={handleExport}>
                  <Download className="w-4 h-4 mr-2" /> Export to File
                </Button>
              </DialogFooter>
              {message && (
                <Alert variant={message.includes("Success") ? "default" : "destructive"}>
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )}
            </DialogContent>
          </Dialog>

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