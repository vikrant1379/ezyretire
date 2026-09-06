import { useState } from 'react';
import { format } from 'date-fns';
import { DatePickerInput } from '@workspace/wealthone-design-system/components/ui/date-picker-input';
import { Label } from '@workspace/wealthone-design-system/components/ui/label';

const MIN_JAVASCRIPT_DATE = new Date(-8_640_000_000_000_000);
const MAX_JAVASCRIPT_DATE = new Date(8_640_000_000_000_000);

export default function DatePickerTestHarness() {
  const [boundedDate, setBoundedDate] = useState<Date | undefined>(
    new Date(2021, 5, 15),
  );
  const [optionalDate, setOptionalDate] = useState<Date | undefined>(
    new Date(2020, 0, 2),
  );
  const [wideDate, setWideDate] = useState<Date | undefined>(
    new Date(2000, 0, 1),
  );
  const [fullRangeDate, setFullRangeDate] = useState<Date | undefined>(
    new Date(2000, 0, 1),
  );

  return (
    <main className="mx-auto grid min-h-screen max-w-md gap-10 bg-background p-8">
      <section className="space-y-2">
        <Label htmlFor="bounded-date">Bounded date</Label>
        <DatePickerInput
          id="bounded-date"
          value={boundedDate}
          onChange={setBoundedDate}
          minDate={new Date(2020, 2, 10)}
          maxDate={new Date(2022, 8, 20)}
          showTodayShortcut={false}
        />
        <output data-testid="bounded-value">
          {boundedDate ? format(boundedDate, 'yyyy-MM-dd') : 'empty'}
        </output>
      </section>

      <section className="space-y-2">
        <Label htmlFor="wide-date">Wide range date</Label>
        <DatePickerInput
          id="wide-date"
          value={wideDate}
          onChange={setWideDate}
          minDate={new Date(1000, 0, 1)}
          maxDate={new Date(5000, 11, 31)}
          showTodayShortcut={false}
        />
      </section>

      <section className="space-y-2">
        <Label htmlFor="full-range-date">Full JavaScript date range</Label>
        <DatePickerInput
          id="full-range-date"
          value={fullRangeDate}
          onChange={setFullRangeDate}
          minDate={MIN_JAVASCRIPT_DATE}
          maxDate={MAX_JAVASCRIPT_DATE}
          showTodayShortcut={false}
        />
      </section>

      <section className="space-y-2">
        <Label htmlFor="optional-date">Optional date</Label>
        <DatePickerInput
          id="optional-date"
          value={optionalDate}
          onChange={setOptionalDate}
          optional
        />
        <output data-testid="optional-value">
          {optionalDate ? format(optionalDate, 'yyyy-MM-dd') : 'empty'}
        </output>
      </section>
    </main>
  );
}