import logoAsset from "@/assets/step-logo.png.asset.json";

export function BrandLogo({ className = "h-8 w-auto", alt = "STEP Integrated Solutions" }: { className?: string; alt?: string }) {
  return <img src={logoAsset.url} alt={alt} className={className} loading="eager" />;
}
