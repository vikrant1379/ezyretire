import { cn } from "@workspace/wealthone-design-system/lib/utils";

export function BrandMark({
  className,
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <span
      className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center", className)}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "ezyRetire"}
      aria-hidden={decorative || undefined}
    >
      <img
        src={`${import.meta.env.BASE_URL}loader-icon-lightmode.png`}
        className="h-full w-full object-contain dark:hidden"
        alt=""
      />
      <img
        src={`${import.meta.env.BASE_URL}loader-icon-darkmode.png`}
        className="hidden h-full w-full object-contain dark:block"
        alt=""
      />
    </span>
  );
}

export function BrandLoader({ className }: { className?: string }) {
  return (
    <span className={cn("flex h-20 w-24 items-center justify-center", className)} aria-hidden="true">
      <img
        src={`${import.meta.env.BASE_URL}loader-icon-lightmode.png`}
        className="h-full w-full object-contain dark:hidden"
        alt=""
      />
      <img
        src={`${import.meta.env.BASE_URL}loader-icon-darkmode.png`}
        className="hidden h-full w-full object-contain dark:block"
        alt=""
      />
    </span>
  );
}

export function BrandLogo({
  className,
  compact = false,
  iconOnly = false,
  showText = true,
}: {
  className?: string;
  compact?: boolean;
  iconOnly?: boolean;
  showText?: boolean;
}) {
  if (!iconOnly && showText) {
    return (
      <span className={cn("inline-flex h-10 w-auto shrink-0", className)}>
        <img
          src={`${import.meta.env.BASE_URL}${compact ? "brand-logo-compact.png" : "brand-logo.png"}`}
          className="h-full w-auto max-w-full object-contain dark:hidden"
          alt="ezyRetire"
          decoding="sync"
          fetchPriority="high"
        />
        <img
          src={`${import.meta.env.BASE_URL}${compact ? "brand-logo-compact-dark.png" : "brand-logo-dark.png"}`}
          className="hidden h-full w-auto max-w-full object-contain dark:block"
          alt="ezyRetire"
          decoding="sync"
          fetchPriority="high"
        />
      </span>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <BrandMark className="h-7 w-7" decorative={false} />
    </div>
  );
}
