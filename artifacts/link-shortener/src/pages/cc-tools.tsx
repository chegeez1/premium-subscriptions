import { useState } from "react";
import { Copy, CreditCard, Play, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useGenerateCards, useCheckCard } from "@workspace/api-client-react";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function CcTools() {
  const { toast } = useToast();
  
  // Generator State
  const [genBin, setGenBin] = useState("");
  const [genCount, setGenCount] = useState("10");
  const [genMonth, setGenMonth] = useState("");
  const [genYear, setGenYear] = useState("");
  const [genCvv, setGenCvv] = useState("");
  
  // Checker State
  const [chkNumber, setChkNumber] = useState("");
  const [chkMonth, setChkMonth] = useState("");
  const [chkYear, setChkYear] = useState("");
  const [chkCvv, setChkCvv] = useState("");

  const generateMutation = useGenerateCards();
  const checkMutation = useCheckCard();

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    generateMutation.mutate({
      data: {
        bin: genBin || undefined,
        count: parseInt(genCount) || 10,
        month: genMonth || undefined,
        year: genYear || undefined,
        cvv: genCvv || undefined
      }
    });
  };

  const handleCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chkNumber) return;
    
    checkMutation.mutate({
      data: {
        number: chkNumber.replace(/\s+/g, ''),
        month: chkMonth,
        year: chkYear,
        cvv: chkCvv
      }
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "Copied to clipboard.",
      duration: 2000,
    });
  };

  const copyAll = () => {
    if (!generateMutation.data) return;
    const all = generateMutation.data.map(c => c.formatted).join('\n');
    copyToClipboard(all);
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center bg-background text-foreground pb-24">
      <NavBar />
      
      <main className="w-full max-w-4xl px-6 flex flex-col gap-8 mt-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
            CC <span className="text-primary">Tools</span>
          </h1>
          <p className="text-muted-foreground">
            Generate test numbers or check card validity.
          </p>
        </div>

        <Tabs defaultValue="generate" className="w-full">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 bg-card/80 border border-border h-14">
            <TabsTrigger value="generate" className="text-base data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Generate
            </TabsTrigger>
            <TabsTrigger value="check" className="text-base data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Check
            </TabsTrigger>
          </TabsList>
          
          <div className="mt-8 grid md:grid-cols-12 gap-8 items-start">
            <div className="md:col-span-5">
              <TabsContent value="generate" className="m-0 space-y-0">
                <Card className="border-border bg-card/50 backdrop-blur-xl">
                  <CardHeader>
                    <CardTitle>Generator Settings</CardTitle>
                    <CardDescription>Leave fields blank for random values.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleGenerate} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="bin">BIN Prefix</Label>
                        <Input 
                          id="bin"
                          placeholder="Random Visa (e.g. 4)" 
                          value={genBin}
                          onChange={e => setGenBin(e.target.value)}
                          className="bg-background border-border focus-visible:ring-primary font-mono"
                          data-testid="input-gen-bin"
                        />
                      </div>
                      
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="month">Month</Label>
                          <Input 
                            id="month"
                            placeholder="MM" 
                            maxLength={2}
                            value={genMonth}
                            onChange={e => setGenMonth(e.target.value)}
                            className="bg-background border-border focus-visible:ring-primary text-center"
                            data-testid="input-gen-month"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="year">Year</Label>
                          <Input 
                            id="year"
                            placeholder="YYYY" 
                            maxLength={4}
                            value={genYear}
                            onChange={e => setGenYear(e.target.value)}
                            className="bg-background border-border focus-visible:ring-primary text-center"
                            data-testid="input-gen-year"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="cvv">CVV</Label>
                          <Input 
                            id="cvv"
                            placeholder="CVV" 
                            maxLength={4}
                            value={genCvv}
                            onChange={e => setGenCvv(e.target.value)}
                            className="bg-background border-border focus-visible:ring-primary text-center"
                            data-testid="input-gen-cvv"
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="count">Quantity</Label>
                        <Input 
                          id="count"
                          type="number"
                          min="1"
                          max="20"
                          value={genCount}
                          onChange={e => setGenCount(e.target.value)}
                          className="bg-background border-border focus-visible:ring-primary"
                          data-testid="input-gen-count"
                        />
                      </div>
                      
                      <Button 
                        type="submit" 
                        className="w-full h-12 font-semibold mt-2"
                        disabled={generateMutation.isPending}
                        data-testid="button-generate"
                      >
                        {generateMutation.isPending ? "Generating..." : "Generate Cards"}
                        <Play className="ml-2 h-4 w-4" />
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="check" className="m-0 space-y-0">
                <Card className="border-border bg-card/50 backdrop-blur-xl">
                  <CardHeader>
                    <CardTitle>Card Checker</CardTitle>
                    <CardDescription>Verify live status and details.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleCheck} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="chk-number">Card Number</Label>
                        <Input 
                          id="chk-number"
                          placeholder="0000 0000 0000 0000" 
                          value={chkNumber}
                          onChange={e => setChkNumber(e.target.value)}
                          className="bg-background border-border focus-visible:ring-primary font-mono"
                          required
                          data-testid="input-chk-number"
                        />
                      </div>
                      
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="chk-month">Month</Label>
                          <Input 
                            id="chk-month"
                            placeholder="MM" 
                            maxLength={2}
                            value={chkMonth}
                            onChange={e => setChkMonth(e.target.value)}
                            className="bg-background border-border focus-visible:ring-primary text-center"
                            data-testid="input-chk-month"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="chk-year">Year</Label>
                          <Input 
                            id="chk-year"
                            placeholder="YY/YYYY" 
                            maxLength={4}
                            value={chkYear}
                            onChange={e => setChkYear(e.target.value)}
                            className="bg-background border-border focus-visible:ring-primary text-center"
                            data-testid="input-chk-year"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="chk-cvv">CVV</Label>
                          <Input 
                            id="chk-cvv"
                            placeholder="***" 
                            maxLength={4}
                            value={chkCvv}
                            onChange={e => setChkCvv(e.target.value)}
                            className="bg-background border-border focus-visible:ring-primary text-center"
                            data-testid="input-chk-cvv"
                          />
                        </div>
                      </div>
                      
                      <Button 
                        type="submit" 
                        className="w-full h-12 font-semibold mt-2"
                        disabled={checkMutation.isPending || !chkNumber}
                        data-testid="button-check-card"
                      >
                        {checkMutation.isPending ? "Checking..." : "Check Card"}
                        <ShieldCheck className="ml-2 h-5 w-5" />
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </TabsContent>
            </div>

            <div className="md:col-span-7">
              {/* Generator Results */}
              <TabsContent value="generate" className="m-0 space-y-0 h-full">
                <Card className="border-border bg-card/30 h-full flex flex-col min-h-[400px]">
                  <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/50">
                    <CardTitle className="text-lg">Generated Output</CardTitle>
                    {generateMutation.data && generateMutation.data.length > 0 && (
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        onClick={copyAll}
                        data-testid="button-copy-all"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy All
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="flex-1 overflow-auto pt-4 p-0">
                    {generateMutation.isPending ? (
                      <div className="p-6 space-y-3">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    ) : generateMutation.data ? (
                      <div className="divide-y divide-border/50">
                        {generateMutation.data.map((card, i) => (
                          <div 
                            key={i} 
                            className="px-6 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors group"
                            data-testid={`row-gen-card-${i}`}
                          >
                            <span className="font-mono text-sm tracking-wider text-muted-foreground group-hover:text-white transition-colors">
                              {card.formatted}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 h-8 w-8 text-muted-foreground hover:text-white"
                              onClick={() => copyToClipboard(card.formatted)}
                              data-testid={`button-copy-gen-${i}`}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-12 text-center">
                        <CreditCard className="h-12 w-12 mb-4 opacity-20" />
                        <p>Fill out the settings and click generate to see results here.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Checker Results */}
              <TabsContent value="check" className="m-0 space-y-0 h-full">
                <Card className="border-border bg-card/30 h-full flex flex-col min-h-[400px]">
                  <CardHeader className="border-b border-border/50">
                    <CardTitle className="text-lg">Check Result</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 pt-6">
                    {checkMutation.isPending ? (
                      <div className="space-y-6">
                        <Skeleton className="h-24 w-full rounded-lg" />
                        <div className="space-y-4">
                          <Skeleton className="h-6 w-3/4" />
                          <Skeleton className="h-6 w-1/2" />
                          <Skeleton className="h-6 w-2/3" />
                        </div>
                      </div>
                    ) : checkMutation.isError ? (
                      <div className="p-6 border border-destructive/30 bg-destructive/10 rounded-lg flex flex-col items-center text-center">
                        <XCircle className="h-12 w-12 text-destructive mb-3" />
                        <h3 className="font-bold text-destructive mb-1">Check Failed</h3>
                        <p className="text-muted-foreground text-sm">
                          {(checkMutation.error as any)?.error || "An error occurred while checking the card."}
                        </p>
                      </div>
                    ) : checkMutation.data ? (
                      <div className="space-y-6">
                        {checkMutation.data.status === "Live" ? (
                          <div className="p-6 border border-primary/30 bg-primary/10 rounded-lg flex items-center gap-4" data-testid="status-live">
                            <CheckCircle2 className="h-10 w-10 text-primary shrink-0" />
                            <div>
                              <h3 className="font-bold text-primary text-xl tracking-tight">LIVE MATCH</h3>
                              <p className="text-primary/80 text-sm mt-1">{checkMutation.data.message}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="p-6 border border-destructive/30 bg-destructive/10 rounded-lg flex items-center gap-4" data-testid="status-dead">
                            <XCircle className="h-10 w-10 text-destructive shrink-0" />
                            <div>
                              <h3 className="font-bold text-destructive text-xl tracking-tight">DEAD</h3>
                              <p className="text-destructive/80 text-sm mt-1">{checkMutation.data.message}</p>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-y-6 gap-x-4 p-4">
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Card</p>
                            <p className="font-mono text-white text-sm">{checkMutation.data.card || "N/A"}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Bank</p>
                            <p className="text-white text-sm font-medium">{checkMutation.data.bank || "N/A"}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Type</p>
                            <p className="text-white text-sm capitalize">{checkMutation.data.type || "N/A"}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Level</p>
                            <p className="text-white text-sm">{checkMutation.data.category || "N/A"}</p>
                          </div>
                          <div className="space-y-1 col-span-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Country</p>
                            <p className="text-white text-sm flex items-center gap-2">
                              {checkMutation.data.emoji && <span className="text-base">{checkMutation.data.emoji}</span>}
                              {checkMutation.data.country || "N/A"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-12 text-center pt-20">
                        <ShieldCheck className="h-12 w-12 mb-4 opacity-20" />
                        <p>Enter card details and check to see live status here.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </div>
        </Tabs>
      </main>
    </div>
  );
}