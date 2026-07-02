import logoUrl from "@/assets/Logo - STEP.png";

export function BrandLogo({ className = "h-8 w-auto", alt = "STEP Integrated Solutions" }: { className?: string; alt?: string }) {
  return <img src={logoUrl} alt={alt} className={className} loading="eager" />;
}
