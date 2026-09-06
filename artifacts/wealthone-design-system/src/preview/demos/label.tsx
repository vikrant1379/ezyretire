import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Stack } from '../parts';

export function LabelDemo() {
  return (
    <div className="max-w-md rounded-xl border bg-card p-6">
      <Stack label="Form label">
        <Label htmlFor="label-demo-name">Account name</Label>
        <Input id="label-demo-name" placeholder="Emergency fund" />
        <Label className="text-muted-foreground" aria-disabled>
          Disabled label
        </Label>
      </Stack>
    </div>
  );
}