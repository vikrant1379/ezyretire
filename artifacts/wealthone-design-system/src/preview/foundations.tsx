import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

const CORE_SWATCHES = [
  { name: 'Deep Indigo', role: 'Primary', className: 'bg-primary text-primary-foreground' },
  { name: 'Saffron', role: 'Secondary', className: 'bg-secondary text-secondary-foreground' },
  { name: 'Warm Neutral', role: 'Accent', className: 'bg-accent text-accent-foreground' },
] as const;

function Swatch({ name, role, className }: { name: string; role: string; className: string }) {
  return <div className={`flex h-28 flex-col justify-end rounded-xl border p-4 shadow-sm ${className}`}><strong>{name}</strong><span className="text-xs opacity-75">{role}</span></div>;
}

export function OverviewPage() {
  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Complete source system</p>
        <h2 className="mt-2 font-serif text-3xl">Clarity for every money decision.</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Extracted directly from ezyRetire. Light and dark themes use the product’s warm-neutral, indigo, and saffron visual language.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">{CORE_SWATCHES.map((swatch) => <Swatch key={swatch.role} {...swatch} />)}</div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Monthly investment plan</CardDescription>
            <CardTitle className="font-serif text-2xl">Build your retirement corpus</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input aria-label="Monthly contribution" value={25000} formatWithCommas readOnly />
            <Select defaultValue="balanced">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="conservative">Conservative</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="growth">Growth</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
          <CardFooter className="gap-2">
            <Button>Save plan</Button>
            <Button variant="outline">Review later</Button>
          </CardFooter>
        </Card>

        <section className="rounded-xl border bg-card p-6">
          <h3 className="font-serif text-xl">Core components</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm">Primary</Button>
            <Button size="sm" variant="secondary">Secondary</Button>
            <Button size="sm" variant="outline">Outline</Button>
          </div>
          <Dialog>
            <DialogTrigger asChild><Button className="mt-5" variant="ghost">Open example dialog</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-serif">Confirm your plan</DialogTitle><DialogDescription>Your monthly investment will be saved to this device.</DialogDescription></DialogHeader>
              <DialogFooter><Button>Confirm</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      </div>
    </div>
  );
}

export function ColorsPage() {
  return <div className="space-y-6 rounded-xl border bg-card p-6"><div><h2 className="font-serif text-2xl">Core palette</h2><p className="text-sm text-muted-foreground">Indigo establishes trust, saffron adds optimism, and warm neutrals keep dense financial information calm.</p></div><div className="grid gap-4 sm:grid-cols-3">{CORE_SWATCHES.map((swatch) => <Swatch key={swatch.role} {...swatch} />)}</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{['bg-background','bg-card','bg-muted','bg-destructive','bg-border'].map((value) => <div key={value} className={`h-20 rounded-lg border ${value}`} />)}</div></div>;
}

export function FontsPage() {
  return <div className="space-y-7 rounded-xl border bg-card p-6"><section><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fraunces · headings</p><p className="mt-3 font-serif text-4xl">A confident financial future.</p></section><section className="border-t pt-6"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plus Jakarta Sans · interface</p><p className="mt-3 max-w-2xl text-base">Designed for readable labels, forms, explanations, tables, and financial decisions across screen sizes.</p></section></div>;
}

export function LayoutPage() {
  return <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-xl border bg-card p-6"><h2 className="font-serif text-xl">Spacing</h2><p className="mt-1 text-sm text-muted-foreground">A 4px base rhythm supports compact controls and generous card layouts.</p><div className="mt-6 space-y-4">{[4,8,16,24,32].map((size) => <div key={size} className="flex items-center gap-4"><span className="w-8 text-xs text-muted-foreground">{size}</span><div className="h-3 rounded-full bg-primary" style={{ width: size * 3 }} /></div>)}</div></section><section className="rounded-xl border bg-card p-6"><h2 className="font-serif text-xl">Radius</h2><p className="mt-1 text-sm text-muted-foreground">Soft 12px base corners make analytical surfaces approachable.</p><div className="mt-6 h-32 rounded-xl border bg-muted" /></section></div>;
}