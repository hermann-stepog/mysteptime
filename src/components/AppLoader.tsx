import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

// Splash exibido enquanto o app resolve a sessão/dados iniciais (ver useAuth's `loading`).
// A logo entra com fade-in suave (keyframe "fade-in" definido em src/styles.css) e o
// spinner fica pequeno/apagado de propósito, pra não competir visualmente com a logo.
export function AppLoader() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background">
      <div className="animate-fade-in flex flex-col items-center gap-5">
        <BrandLogo className="h-12 w-auto" />
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
      </div>
    </div>
  );
}
