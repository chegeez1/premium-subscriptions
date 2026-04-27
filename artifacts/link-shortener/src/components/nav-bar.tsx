import { Link, useLocation } from "wouter";
import { LayoutDashboard } from "lucide-react";

export function NavBar() {
  const [location] = useLocation();

  return (
    <header className="w-full max-w-7xl px-6 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
        <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center text-primary-foreground font-bold">
          C
        </div>
        <span className="font-bold text-xl tracking-tight text-white">ChegeLink</span>
      </Link>
      
      <nav className="flex items-center gap-6 text-sm font-medium">
        <Link 
          href="/" 
          className={`transition-colors ${location === "/" ? "text-primary" : "text-muted-foreground hover:text-white"}`}
        >
          Link Shortener
        </Link>
        <Link 
          href="/bin" 
          className={`transition-colors ${location === "/bin" ? "text-primary" : "text-muted-foreground hover:text-white"}`}
        >
          BIN Checker
        </Link>
        <Link 
          href="/cc" 
          className={`transition-colors ${location === "/cc" ? "text-primary" : "text-muted-foreground hover:text-white"}`}
        >
          CC Tools
        </Link>
        <Link 
          href="/admin" 
          className={`flex items-center gap-1.5 transition-colors ${location === "/admin" ? "text-primary" : "text-muted-foreground hover:text-white"}`}
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          Dashboard
        </Link>
      </nav>
    </header>
  );
}