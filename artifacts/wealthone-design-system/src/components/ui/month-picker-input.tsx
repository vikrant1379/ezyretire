import * as React from "react"
import { CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react"

import { cn } from "../../lib/utils"
import { Button } from "./button"
import { Input } from "./input"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

export interface MonthPickerInputProps {
  value?: Date
  onChange: (date?: Date) => void
  minMonth?: Date
  maxMonth?: Date
  optional?: boolean
  className?: string
  placeholder?: string
  id?: string
}

const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth()

export function MonthPickerInput({
  value,
  onChange,
  minMonth = new Date(1900, 0, 1),
  maxMonth = new Date(2100, 11, 1),
  optional = false,
  className,
  placeholder = "Choose month",
  id,
}: MonthPickerInputProps) {
  const generatedId = React.useId()
  const inputId = id ?? `month-picker-${generatedId}`
  const labelId = `${inputId}-calendar-label`
  const keyboardHelpId = `${inputId}-keyboard-help`
  const [open, setOpen] = React.useState(false)
  const [viewYear, setViewYear] = React.useState(
    value?.getFullYear() ?? Math.min(Math.max(new Date().getFullYear(), minMonth.getFullYear()), maxMonth.getFullYear())
  )
  const monthRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const selectedMonth = value ? monthIndex(value) : null
  const minimum = monthIndex(minMonth)
  const maximum = monthIndex(maxMonth)
  const months = React.useMemo(
    () => Array.from({ length: 12 }, (_, index) =>
      new Date(2000, index, 1).toLocaleString("default", { month: "short" })
    ),
    []
  )

  const selectMonth = (month: number) => {
    const selected = new Date(viewYear, month, 1)
    if (monthIndex(selected) < minimum || monthIndex(selected) > maximum) return
    onChange(selected)
    setOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: number) => {
    let next: number | undefined
    if (event.key === "ArrowLeft") next = current - 1
    if (event.key === "ArrowRight") next = current + 1
    if (event.key === "ArrowUp") next = current - 3
    if (event.key === "ArrowDown") next = current + 3
    if (event.key === "Home") next = current - current % 3
    if (event.key === "End") next = Math.min(current - current % 3 + 2, 11)
    if (event.key === "PageUp") {
      event.preventDefault()
      setViewYear((year) => Math.max(minMonth.getFullYear(), year - 1))
      return
    }
    if (event.key === "PageDown") {
      event.preventDefault()
      setViewYear((year) => Math.min(maxMonth.getFullYear(), year + 1))
      return
    }
    if (next === undefined) return
    event.preventDefault()
    while (next >= 0 && next < 12) {
      const button = monthRefs.current[next]
      if (button && !button.disabled) {
        button.focus()
        return
      }
      next += next > current ? 1 : -1
    }
  }

  return (
    <div className={cn("relative", className)}>
      <div className="relative flex items-center">
        <Input
          id={inputId}
          readOnly
          value={value ? value.toLocaleString("default", { month: "long", year: "numeric" }) : ""}
          placeholder={placeholder}
          className="cursor-pointer pr-20 font-medium text-primary"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              setOpen(true)
            }
          }}
        />
        {optional && value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-10 h-7 w-7 text-muted-foreground"
            aria-label="Clear month"
            onClick={() => onChange(undefined)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (next && value) setViewYear(value.getFullYear())
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 h-8 w-8 text-muted-foreground"
              aria-label="Open month calendar"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(320px,calc(100vw-2rem))] rounded-xl p-3"
            align="end"
            aria-label="Choose month and year"
          >
          <div className="mb-3 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Previous year"
              disabled={viewYear <= minMonth.getFullYear()}
              onClick={() => setViewYear((year) => year - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p id={labelId} className="font-semibold" aria-live="polite">{viewYear}</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Next year"
              disabled={viewYear >= maxMonth.getFullYear()}
              onClick={() => setViewYear((year) => year + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div
            role="grid"
            aria-labelledby={labelId}
            aria-describedby={keyboardHelpId}
            className="grid grid-cols-3 gap-2"
          >
            {months.map((name, month) => {
              const candidate = monthIndex(new Date(viewYear, month, 1))
              const disabled = candidate < minimum || candidate > maximum
              const selected = candidate === selectedMonth
              return (
                <Button
                  key={name}
                  ref={(node) => { monthRefs.current[month] = node }}
                  type="button"
                  role="gridcell"
                  variant={selected ? "default" : "outline"}
                  aria-selected={selected}
                  disabled={disabled}
                  onKeyDown={(event) => handleKeyDown(event, month)}
                  onClick={() => selectMonth(month)}
                  className="h-10"
                >
                  {name}
                </Button>
              )
            })}
          </div>
          <p id={keyboardHelpId} className="sr-only">
            Use arrow keys to move by month and Page Up or Page Down to change year.
          </p>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}