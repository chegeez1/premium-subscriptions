import { useState } from "react";
import { Search, CreditCard, AlertCircle } from "lucide-react";
import { useCheckBin, getCheckBinQueryKey } from "@workspace/api-client-react";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function BinChecker() {
  const [inputValue, setInputValue] = useState("");
  const [searchBin, setSearchBin] = useState("");

  const isSearchable = searchBin.length >= 6;

  const { data: binResult, isLoading, isError, error } = useCheckBin(searchBin, {
    query: {
      enabled: isSearchable,
      queryKey: getCheckBinQueryKey(searchBin),
      retry: false
    }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = inputValue.replace(/\D/g, "");
    if (cleaned.length >= 6) {
      setSearchBin(cleaned.substring(0, 8));
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center bg-background text-foreground pb-24">
      <NavBar />
      
      <main className="w-full max-w-2xl px-6 flex flex-col gap-8 mt-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
            BIN <span className="text-primary">Checker</span>
          </h1>
          <p className="text-muted-foreground">
            Look up card issuer, scheme, and country using the first 6-8 digits.
          </p>
        </div>

        <Card className="border-border bg-card/50 backdrop-blur-xl">
          <CardContent className="pt-6">
            <form onSubmit={handleSearch} className="flex gap-4">
              <Input
                placeholder="Enter first 6-8 digits (e.g. 424242)"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="bg-background border-border focus-visible:ring-primary h-12 text-base font-mono"
                maxLength={16}
                data-testid="input-bin"
              />
              <Button 
                type="submit" 
                className="h-12 px-8 font-semibold shrink-0"
                disabled={inputValue.replace(/\D/g, "").length < 6}
                data-testid="button-check-bin"
              >
                <Search className="mr-2 h-5 w-5" />
                Check BIN
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="min-h-[200px]">
          {isLoading && isSearchable ? (
            <Card className="border-border bg-card/50">
              <CardContent className="pt-6 space-y-4">
                <Skeleton className="h-8 w-1/3" />
                <div className="grid grid-cols-2 gap-4">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              </CardContent>
            </Card>
          ) : isError ? (
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                {error?.error || "Could not find details for this BIN. It may be invalid or not in our database."}
              </AlertDescription>
            </Alert>
          ) : binResult ? (
            <Card className="border-border bg-card/50 overflow-hidden">
              <div className="bg-primary/10 border-b border-border p-4 flex items-center gap-3">
                <CreditCard className="h-6 w-6 text-primary" />
                <h3 className="font-bold text-lg text-white font-mono tracking-widest">{binResult.bin.padEnd(8, "X")}</h3>
              </div>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Bank</p>
                    <p className="font-semibold text-white">{binResult.bank || "Unknown"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Scheme</p>
                    <p className="font-semibold text-white capitalize">{binResult.scheme}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Type</p>
                    <p className="font-semibold text-white capitalize">{binResult.type}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Brand</p>
                    <p className="font-semibold text-white">{binResult.brand || "N/A"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Country</p>
                    <p className="font-semibold text-white flex items-center gap-2">
                      {binResult.emoji && <span className="text-xl">{binResult.emoji}</span>}
                      {binResult.country || "Unknown"} {binResult.countryCode && `(${binResult.countryCode})`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </main>
    </div>
  );
}