import { useState } from "react"

import { DatePickerInput } from "../../components/ui/date-picker-input"
import { Stack } from "../parts"

export function DatePickerInputDemo() {
  const [requiredDate, setRequiredDate] = useState<Date | undefined>(new Date(2026, 6, 20))
  const [optionalDate, setOptionalDate] = useState<Date | undefined>(new Date(2026, 6, 24))

  return (
    <div className="max-w-md space-y-8 rounded-xl border bg-card p-6">
      <Stack label="Date selection">
        <DatePickerInput
          id="appointment-date"
          value={requiredDate}
          onChange={setRequiredDate}
          minDate={new Date(2026, 6, 1)}
          maxDate={new Date(2026, 7, 31)}
        />
        <p className="text-sm text-muted-foreground">
          {requiredDate ? `Selected: ${requiredDate.toLocaleDateString("en-GB")}` : "Enter or select a date."}
        </p>
      </Stack>
      <Stack label="Optional date">
        <DatePickerInput
          id="optional-date"
          value={optionalDate}
          onChange={setOptionalDate}
          optional
          showTodayShortcut={false}
          placeholder="Optional follow-up date"
        />
        <p className="text-sm text-muted-foreground">
          {optionalDate ? "Use the clear action to remove this date." : "No follow-up date selected."}
        </p>
      </Stack>
    </div>
  )
}