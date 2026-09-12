import * as React from 'react';
import { cn } from '../../lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />,
);
Card.displayName = 'Card';
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('relative flex flex-col gap-1.5 p-4 lg:p-5', className)} {...props} />,
);
CardHeader.displayName = 'CardHeader';
const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('text-lg font-semibold leading-[1.45] tracking-[-0.2px] lg:text-xl lg:leading-7', className)} {...props} />,
);
CardTitle.displayName = 'CardTitle';
const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('text-muted-foreground text-sm', className)} {...props} />,
);
CardDescription.displayName = 'CardDescription';
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('lg:p-5 lg:pt-0 space-y-3 p-4 md:p-5 md:pt-5 pt-[3px]', className)} {...props} />,
);
CardContent.displayName = 'CardContent';
const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('flex items-center p-4 pt-0 lg:p-5 lg:pt-0', className)} {...props} />,
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
