import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

const CORE_SWATCHES = [
  { name: 'Deep Blue', role: 'Primary Action', className: 'bg-primary text-primary-foreground' },
  { name: 'Subtle Slate', role: 'Secondary Surface', className: 'bg-secondary text-secondary-foreground' },
  { name: 'Cool Neutral', role: 'Hover / secondary', className: 'bg-accent text-accent-foreground' },
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
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Extracted directly from ezyRetire. Light and dark themes use the product’s deep blue and neutral visual language.</p>
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
  return <div className="space-y-6 rounded-xl border bg-card p-6">
    <div><h2 className="text-h2 font-semibold">Color roles, not decoration</h2><p className="text-body text-muted-foreground">Keep surfaces neutral. Use blue for a primary action, links, focus, or a selected navigation marker—not balances, card decoration, or success.</p></div>
    <div className="grid gap-4 sm:grid-cols-3">{CORE_SWATCHES.map((swatch) => <Swatch key={swatch.role} {...swatch} />)}</div>
    <section className="space-y-2">
      <h3 className="text-h3 font-semibold">Reference comparison</h3>
      <p className="text-sm text-muted-foreground">The supplied dark Republish dialog uses a deep blue button and a brighter link. We retain its narrow action hierarchy, not its literal blue: the subdued publishing state is not a suitable text or focus color on charcoal. Our existing blue family avoids adding another competing accent.</p>
      <p className="text-sm">Chosen action blue: light <strong>#0B6F93</strong> with white text; dark <strong>#55B6D3</strong> with charcoal text. Links and focus use the same theme-aware blue. Do not copy the reference layout or branding.</p>
    </section>
    <div className="grid gap-3 sm:grid-cols-3">
      <Swatch name="Positive" role="Incoming, assets and gains" className="bg-positive-background text-positive" />
      <Swatch name="Negative" role="Outgoing, debt and losses" className="bg-negative-background text-negative" />
      <Swatch name="Warning" role="Caution or attention needed" className="bg-warning-background text-warning" />
    </div>
    <p className="text-sm text-muted-foreground">Always pair financial color with labels, signs, or icons. Errors and destructive confirmations remain neutral with explicit wording; red is reserved for financial outflow. Cards and secondary controls use neutral surfaces. Disabled controls retain their label at reduced opacity, block interaction, and never look selected.</p>
    <div className="flex flex-wrap items-center gap-3"><Button>Save plan</Button><Button variant="secondary">Cancel</Button><Button variant="link">Learn more</Button><Button disabled>Unavailable</Button></div>
    <Input aria-label="Example control boundary and focus" placeholder="Tab here to inspect focus" />
  </div>;
}

export function FontsPage() {
  return <div className="space-y-6 rounded-xl border bg-card p-6">
    <h2 className="text-h2 font-semibold">Inter throughout</h2>
    <p className="text-body text-muted-foreground">Use size and weight—not another font, italics, or color—to establish hierarchy. Heading weights are 600, body 400, and labels 500. Reserve 700 for occasional emphasis.</p>
    <section className="space-y-3">
      <p className="text-h1 font-semibold">Page heading · 28 / 36</p>
      <p className="text-h2 font-semibold">Section heading · 22 / 30</p>
      <p className="text-h3 font-semibold">Card heading · 18 / 26</p>
      <p className="text-body">Body explanation · 15 / 24</p>
      <p className="text-label font-medium text-muted-foreground">Field label · 12 / 16</p>
      <p className="financial-number text-amount-lg font-semibold">₹1,25,000.00</p>
    </section>
    <p className="text-sm text-muted-foreground">Financial figures use Inter with tabular numerals: 24px for summaries, 18px for secondary totals, and 14px in compact rows. Preserve readable wrapping around figures; use the existing responsive heading scale and never shrink essential text below 11px.</p>
  </div>;
}

export function LayoutPage() {
  return <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-xl border bg-card p-6"><h2 className="font-serif text-xl">Spacing</h2><p className="mt-1 text-sm text-muted-foreground">A 4px base rhythm supports compact controls and generous card layouts.</p><div className="mt-6 space-y-4">{[4,8,16,24,32].map((size) => <div key={size} className="flex items-center gap-4"><span className="w-8 text-xs text-muted-foreground">{size}</span><div className="h-3 rounded-full bg-primary" style={{ width: size * 3 }} /></div>)}</div></section><section className="rounded-xl border bg-card p-6"><h2 className="font-serif text-xl">Radius</h2><p className="mt-1 text-sm text-muted-foreground">Soft 12px base corners make analytical surfaces approachable.</p><div className="mt-6 h-32 rounded-xl border bg-muted" /></section></div>;
}