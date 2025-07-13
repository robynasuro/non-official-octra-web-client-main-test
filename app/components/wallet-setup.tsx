"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockKeyhole, Wallet, Loader2, AlertCircle, CircleAlert, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";
import { createWallet, WalletData, derivePrivateKeyFromMnemonic } from "@/lib/crypto";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function WalletSetup() {
  const { login } = useWallet();
  const [privateKey, setPrivateKey] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newWallet, setNewWallet] = useState<WalletData | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("private-key");

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleConnect = () => {
    setError("");
    setIsConnecting(true);
    try {
      if (activeTab === "private-key") {
        if (!privateKey) {
          throw new Error("Private key cannot be empty.");
        }
        login(privateKey);
      } else {
        if (!mnemonic) {
          throw new Error("Mnemonic phrase cannot be empty.");
        }
        const derivedPrivateKey = derivePrivateKeyFromMnemonic(mnemonic.trim());
        login(derivedPrivateKey);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCreate = () => {
    setError("");
    setIsCreating(true);
    setIsCreateDialogOpen(true);
    try {
      const walletData = createWallet();
      setNewWallet(walletData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDownloadWallet = () => {
    if (!newWallet) return;

    const data = newWallet;
    const timestamp: number = Math.floor(Date.now() / 1000);
    const filename: string = `octra_wallet_${data.address.slice(-8)}_${timestamp}.txt`;

    const content: string = `OCTRA WALLET
${"=".repeat(50)}

SECURITY WARNING: KEEP THIS FILE SECURE AND NEVER SHARE YOUR PRIVATE KEY OR MNEMONIC

Generated: ${new Date().toISOString().replace("T", " ").slice(0, 19)}
Address Format: oct + Base58(SHA256(pubkey))

Mnemonic: ${data.mnemonic.join(" ")}
Private Key (B64): ${data.private_key_b64}
Public Key (B64): ${data.public_key_b64}
Address: ${data.address}

Technical Details:
Entropy: ${data.entropy_hex}
Seed: ${data.seed_hex}
Master Chain Code: ${data.master_chain_hex}
Signature Algorithm: Ed25519
Derivation: BIP39-compatible (PBKDF2-HMAC-SHA512, 2048 iterations)
Test Message: ${data.test_message}
Test Signature: ${data.test_signature}
Signature Valid: ${data.signature_valid}
`;

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Wallet size={48} className="text-primary" />
            </div>
            <CardTitle>Octra Web Client</CardTitle>
            <CardDescription>Connect your wallet using a private key or mnemonic phrase</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="private-key">Private Key</TabsTrigger>
                <TabsTrigger value="mnemonic">Mnemonic</TabsTrigger>
              </TabsList>
              <TabsContent value="private-key" className="space-y-2">
                <Label htmlFor="private-key">Private Key</Label>
                <Input
                  id="private-key"
                  type="password"
                  placeholder="Enter your Base64 private key"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  disabled={isConnecting || isCreating}
                />
              </TabsContent>
              <TabsContent value="mnemonic" className="space-y-2">
                <Label htmlFor="mnemonic">Mnemonic Phrase</Label>
                <Input
                  id="mnemonic"
                  type="text"
                  placeholder="Enter your 12-word mnemonic phrase"
                  value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)}
                  disabled={isConnecting || isCreating}
                />
              </TabsContent>
            </Tabs>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex items-center p-3 space-x-2 text-sm rounded-md bg-muted text-muted-foreground">
              <LockKeyhole className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <p>Your private key and mnemonic are stored securely in your browser&apos;s local storage and never sent to any server.</p>
            </div>
            <div className="flex items-center p-3 space-x-2 text-sm rounded-md bg-muted text-muted-foreground">
              <CircleAlert className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <p><strong>Note:</strong> This is <strong>NOT</strong> an official client.</p>
                <p>The code is open source and available <Link className="underline" rel="noopener noreferrer" target="_blank" href="https://github.com/robynasuro/non-official-octra-web-client-main">here</Link>. <strong>DYOR</strong></p>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <div className="flex flex-col gap-2 w-full">
              <Button className="w-full" onClick={handleConnect} disabled={isConnecting || isCreating}>
                {isConnecting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting...</>
                ) : (
                  "Connect Wallet"
                )}
              </Button>
              <Button className="w-full" variant="secondary" onClick={handleCreate} disabled={isConnecting || isCreating}>
                {isCreating ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</>
                ) : (
                  "Create New Wallet"
                )}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Wallet Created Successfully</DialogTitle>
            <DialogDescription>
              Your new wallet has been created. Please save your mnemonic phrase and private key securely.
              <strong> You will not be able to recover them if you lose them.</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-mnemonic">Mnemonic Phrase</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Input
                      id="new-mnemonic"
                      className="cursor-pointer"
                      readOnly
                      onClick={() => handleCopy(newWallet?.mnemonic.join(" ") || "")}
                      value={newWallet?.mnemonic.join(" ") || ""}
                    />
                  </TooltipTrigger>
                  <TooltipContent><p>Click to copy</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-address">Wallet Address</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Input
                      id="new-address"
                      className="cursor-pointer"
                      readOnly
                      onClick={() => handleCopy(newWallet?.address || "")}
                      value={newWallet?.address || ""}
                    />
                  </TooltipTrigger>
                  <TooltipContent><p>Click to copy</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-private-key">Private Key</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Input
                      id="new-private-key"
                      type="password"
                      className="cursor-pointer"
                      readOnly
                      onClick={() => handleCopy(newWallet?.private_key_b64 || "")}
                      value={newWallet?.private_key_b64 || ""}
                    />
                  </TooltipTrigger>
                  <TooltipContent><p>Click to copy</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Important:</strong> Do not share your mnemonic phrase or private key with anyone. Store them in a safe and secure place.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button type="button" className="w-full" onClick={handleDownloadWallet}>
              <Download className="mr-2 h-4 w-4" />
              Download Wallet File
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}