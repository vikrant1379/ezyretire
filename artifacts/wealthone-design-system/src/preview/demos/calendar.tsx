import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '../../components/ui/calendar';

export function CalendarDemo() {
  const [selected, setSelected] = useState<Date | undefined>(
    new Date(2026, 6, 20),
  );
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(2026, 6, 8),
    to: new Date(2026, 6, 14),
  });
  const [boundedDate, setBoundedDate] = useState<Date | undefined>(
    new Date(2026, 6, 22),
  );

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <section className="rounded-xl border bg-card p-3">
        <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Single date
        </p>
        <Calendar
          mode="single"
          defaultMonth={new Date(2026, 6, 1)}
          selected={selected}
          onSelect={setSelected}
        />
      </section>

      <section className="rounded-xl border bg-card p-3">
        <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Date range
        </p>
        <Calendar
          mode="range"
          defaultMonth={new Date(2026, 6, 1)}
          selected={range}
          onSelect={setRange}
        />
      </section>

      <section className="rounded-xl border bg-card p-3">
        <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Bounded dropdown
        </p>
        <Calendar
          mode="single"
          defaultMonth={new Date(2026, 6, 1)}
          selected={boundedDate}
          onSelect={setBoundedDate}
          captionLayout="dropdown"
          startMonth={new Date(2025, 0, 1)}
          endMonth={new Date(2027, 11, 31)}
          disabled={[
            { before: new Date(2026, 6, 5) },
            { after: new Date(2026, 6, 27) },
          ]}
        />
      </section>
    </div>
  );
}
