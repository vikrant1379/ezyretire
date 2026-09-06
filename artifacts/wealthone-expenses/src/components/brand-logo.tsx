import { cn } from "@workspace/wealthone-design-system/lib/utils";

export function BrandMark({
  className,
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}app-mark.svg`}
      className={cn("h-8 w-8 shrink-0", className)}
      alt={decorative ? "" : "ezyRetire"}
    />
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

export function BrandLogo({ className, iconOnly = false, showText = true }: { className?: string, iconOnly?: boolean, showText?: boolean }) {
  if (!iconOnly && showText) {
    return (
      <img
        src={`${import.meta.env.BASE_URL}brand-logo.png`}
        className={cn("h-10 w-auto shrink-0 object-contain", className)}
        alt="ezyRetire"
      />
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <BrandMark className="h-7 w-7" decorative={false} />
    </div>
  );
}
