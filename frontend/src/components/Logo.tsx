export function Logo({ className = "h-7 w-7", alt = "" }: { className?: string; alt?: string }) {
  return (
    <img
      src="/logo.svg"
      alt={alt}
      draggable={false}
      className={`shrink-0 select-none object-contain ${className}`}
    />
  );
}
