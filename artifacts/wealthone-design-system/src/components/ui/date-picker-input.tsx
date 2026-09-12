import * as React from "react"
import { format, isAfter, isBefore, isValid, parse, startOfDay } from "date-fns"
import { ArrowLeft, CalendarIcon, ChevronDown, X } from "lucide-react"

import { cn } from "../../lib/utils"
import { Button } from "./button"
import { Calendar } from "./calendar"
import { Input } from "./input"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

const YEAR_COLUMN_COUNT = 3
const YEAR_ROW_HEIGHT = 48
const YEAR_VIEWPORT_HEIGHT = 280
const YEAR_OVERSCAN_ROWS = 3

interface DatePickerInputProps {
  value?: Date
  onChange: (date?: Date) => void
  minDate?: Date
  maxDate?: Date
  optional?: boolean
  className?: string
  placeholder?: string
  id?: string
  showTodayShortcut?: boolean
  calendarOnly?: boolean
}

export function DatePickerInput({
  value,
  onChange,
  minDate,
  maxDate,
  optional = false,
  className,
  placeholder = "DD/MM/YYYY",
  id,
  showTodayShortcut = true,
  calendarOnly = false,
}: DatePickerInputProps) {
  const generatedId = React.useId()
  const inputId = id ?? `date-picker-${generatedId}`
  const errorId = `${inputId}-error`
  const monthChoicesLabelId = `${inputId}-month-choices-label`
  const yearChoicesLabelId = `${inputId}-year-choices-label`
  const yearKeyboardHelpId = `${inputId}-year-keyboard-help`
  const [isOpen, setIsOpen] = React.useState(false)
  const [isEditing, setIsEditing] = React.useState(false)
  const [textValue, setTextValue] = React.useState(value ? format(value, "dd/MM/yyyy") : "")
  const [error, setError] = React.useState("")
  const [calendarMonth, setCalendarMonth] = React.useState(value || new Date())
  const [calendarView, setCalendarView] = React.useState<"days" | "months" | "years">("days")
  const lastSyncedValue = React.useRef(value?.getTime())
  const calendarTriggerRef = React.useRef<HTMLButtonElement>(null)
  const monthTriggerRef = React.useRef<HTMLButtonElement>(null)
  const yearTriggerRef = React.useRef<HTMLButtonElement>(null)
  const selectedMonthRef = React.useRef<HTMLButtonElement>(null)
  const monthButtonRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const yearButtonRefs = React.useRef(new Map<number, HTMLButtonElement>())
  const yearScrollRef = React.useRef<HTMLDivElement>(null)
  const [focusedYearIndex, setFocusedYearIndex] = React.useState(0)
  const [yearScrollTop, setYearScrollTop] = React.useState(0)
  const returnFocusTo = React.useRef<"month" | "year" | null>(null)
  const startMonth = minDate || new Date(1900, 0)
  const endMonth = maxDate || new Date(2100, 11)
  const startYear = startMonth.getFullYear()
  const endYear = endMonth.getFullYear()
  const selectableYearCount = endYear - startYear + 1
  const monthNames = React.useMemo(
    () => Array.from({ length: 12 }, (_, month) =>
      new Date(2000, month, 1).toLocaleString("default", { month: "short" })
    ),
    []
  )
  const selectedYearIndex = Math.max(
    0,
    Math.min(calendarMonth.getFullYear() - startYear, selectableYearCount - 1)
  )
  const totalYearRows = Math.ceil(selectableYearCount / YEAR_COLUMN_COUNT)
  const visibleYearRowCount = Math.ceil(YEAR_VIEWPORT_HEIGHT / YEAR_ROW_HEIGHT) + YEAR_OVERSCAN_ROWS * 2
  const firstVisibleYearRow = Math.max(
    0,
    Math.min(
      Math.floor(yearScrollTop / YEAR_ROW_HEIGHT) - YEAR_OVERSCAN_ROWS,
      Math.max(0, totalYearRows - visibleYearRowCount)
    )
  )
  const yearWindowStart = firstVisibleYearRow * YEAR_COLUMN_COUNT
  const visibleYearCount = Math.min(
    selectableYearCount - yearWindowStart,
    visibleYearRowCount * YEAR_COLUMN_COUNT
  )
  const visibleYears = Array.from(
    { length: visibleYearCount },
    (_, visibleIndex) => startYear + yearWindowStart + visibleIndex
  )

  React.useEffect(() => {
    if (isEditing) return
    if (isOpen) return

    const nextValue = value?.getTime()
    if (nextValue === lastSyncedValue.current) return
    lastSyncedValue.current = nextValue
    setTextValue(value ? format(value, "dd/MM/yyyy") : "")
    setError("")
  }, [value, isOpen, isEditing])

  React.useEffect(() => {
    if (calendarView === "months") {
      const frame = requestAnimationFrame(() => selectedMonthRef.current?.focus())
      return () => cancelAnimationFrame(frame)
    }
    if (calendarView === "years") {
      return
    }
    const focusTarget = returnFocusTo.current
    returnFocusTo.current = null
    const frame = requestAnimationFrame(() => {
      if (focusTarget === "month") {
        monthTriggerRef.current?.focus()
      } else if (focusTarget === "year") {
        yearTriggerRef.current?.focus()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [calendarView, selectedYearIndex])

  React.useEffect(() => {
    if (calendarView !== "years") return
    if (yearScrollRef.current && yearScrollRef.current.scrollTop !== yearScrollTop) {
      yearScrollRef.current.scrollTop = yearScrollTop
    }
    const frame = requestAnimationFrame(() => yearButtonRefs.current.get(focusedYearIndex)?.focus())
    return () => cancelAnimationFrame(frame)
  }, [calendarView, focusedYearIndex])

  const focusYear = (yearIndex: number) => {
    const boundedIndex = Math.max(0, Math.min(yearIndex, selectableYearCount - 1))
    setFocusedYearIndex(boundedIndex)
    setYearScrollTop(Math.max(
      0,
      Math.floor(boundedIndex / YEAR_COLUMN_COUNT) * YEAR_ROW_HEIGHT -
        YEAR_VIEWPORT_HEIGHT / 2 +
        YEAR_ROW_HEIGHT / 2
    ))
  }

  const handleYearKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    let nextIndex: number
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = currentIndex - 1
        break
      case "ArrowRight":
        nextIndex = currentIndex + 1
        break
      case "ArrowUp":
        nextIndex = currentIndex - YEAR_COLUMN_COUNT
        break
      case "ArrowDown":
        nextIndex = currentIndex + YEAR_COLUMN_COUNT
        break
      case "Home":
        nextIndex = event.ctrlKey ? 0 : currentIndex - (currentIndex % YEAR_COLUMN_COUNT)
        break
      case "End":
        nextIndex = event.ctrlKey
          ? selectableYearCount - 1
          : Math.min(
              currentIndex - (currentIndex % YEAR_COLUMN_COUNT) + YEAR_COLUMN_COUNT - 1,
              selectableYearCount - 1
            )
        break
      case "PageUp":
        nextIndex = currentIndex - 10
        break
      case "PageDown":
        nextIndex = currentIndex + 10
        break
      default:
        return
    }
    event.preventDefault()
    focusYear(nextIndex)
  }

  const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    setTextValue(nextValue)
    if (!nextValue) {
      if (optional) {
        setError("")
        onChange(undefined)
      } else {
        setError("Date is required")
      }
      return
    }

    const parsed = parseDateString(nextValue)
    if (!parsed || !isValid(parsed)) {
      setError("Invalid date format")
      return
    }
    if (minDate && isBefore(startOfDay(parsed), startOfDay(minDate))) {
      setError(`Date must be on or after ${format(minDate, "dd/MM/yyyy")}`)
      return
    }
    if (maxDate && isAfter(startOfDay(parsed), startOfDay(maxDate))) {
      setError(`Date must be on or before ${format(maxDate, "dd/MM/yyyy")}`)
      return
    }

    setError("")
    onChange(parsed)
  }

  const handleBlur = () => {
    setIsEditing(false)
    if (!error) return

    if (value) {
      setTextValue(format(value, "dd/MM/yyyy"))
      setError("")
    }
  }

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      if (minDate && isBefore(startOfDay(localDate), startOfDay(minDate))) {
        setError(`Date must be on or after ${format(minDate, "dd/MM/yyyy")}`)
        return
      }
      if (maxDate && isAfter(startOfDay(localDate), startOfDay(maxDate))) {
        setError(`Date must be on or before ${format(maxDate, "dd/MM/yyyy")}`)
        return
      }
      setTextValue(format(localDate, "dd/MM/yyyy"))
      setError("")
      onChange(localDate)
      setIsEditing(false)
      setIsOpen(false)
    } else if (optional) {
      setTextValue("")
      setError("")
      onChange(undefined)
      setIsEditing(false)
      setIsOpen(false)
    }
  }

  const handleGridKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
    columnCount: number,
    buttonRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>,
    pageStep?: number
  ) => {
    let nextIndex: number | undefined
    let step = 0

    switch (event.key) {
      case "ArrowLeft":
        nextIndex = currentIndex - 1
        step = -1
        break
      case "ArrowRight":
        nextIndex = currentIndex + 1
        step = 1
        break
      case "ArrowUp":
        nextIndex = currentIndex - columnCount
        step = -columnCount
        break
      case "ArrowDown":
        nextIndex = currentIndex + columnCount
        step = columnCount
        break
      case "Home":
        nextIndex = event.ctrlKey && pageStep
          ? 0
          : currentIndex - (currentIndex % columnCount)
        step = 1
        break
      case "End":
        nextIndex = event.ctrlKey && pageStep
          ? buttonRefs.current.length - 1
          : Math.min(
              currentIndex - (currentIndex % columnCount) + columnCount - 1,
              buttonRefs.current.length - 1
            )
        step = -1
        break
      case "PageUp":
        if (!pageStep) return
        nextIndex = Math.max(currentIndex - pageStep, 0)
        step = -1
        break
      case "PageDown":
        if (!pageStep) return
        nextIndex = Math.min(currentIndex + pageStep, buttonRefs.current.length - 1)
        step = 1
        break
      default:
        return
    }

    event.preventDefault()
    while (nextIndex >= 0 && nextIndex < buttonRefs.current.length) {
      const nextButton = buttonRefs.current[nextIndex]
      if (nextButton && !nextButton.disabled) {
        nextButton.focus()
        return
      }
      nextIndex += step
    }
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      <div className={cn("relative flex min-w-0 items-center rounded-md border border-input bg-card shadow-sm", error && "border-warning")}>
        <Input
          id={inputId}
          type="text"
          value={textValue}
          onChange={handleTextChange}
          onFocus={() => {
            if (calendarOnly) {
              setIsOpen(true)
            } else {
              setIsEditing(true)
            }
          }}
          onClick={() => {
            if (calendarOnly) setIsOpen(true)
          }}
          onBlur={handleBlur}
          readOnly={calendarOnly}
          placeholder={placeholder}
          aria-haspopup={calendarOnly ? "dialog" : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none font-medium text-primary",
            calendarOnly && "cursor-pointer",
            error ? "border-warning focus-visible:ring-warning" : "",
            className
          )}
        />
        {optional && textValue && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-11 w-11 shrink-0"
            onClick={() => {
              setTextValue("")
              setError("")
              onChange(undefined)
            }}
            aria-label="Clear date"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        <Popover
          open={isOpen}
          onOpenChange={(nextOpen) => {
            setIsOpen(nextOpen)
            if (nextOpen) {
              setCalendarMonth(value || new Date())
              setCalendarView("days")
            } else {
              requestAnimationFrame(() => calendarTriggerRef.current?.focus())
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button ref={calendarTriggerRef} type="button" variant="ghost" size="icon" className="text-muted-foreground h-11 w-11 shrink-0" aria-label="Open calendar">
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="bg-background !max-h-[min(var(--radix-popover-content-available-height),calc(var(--app-visual-height,100dvh)-var(--app-safe-top,0px)-var(--app-safe-bottom,0px)-1rem))] w-[min(352px,calc(100vw-1rem))] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border p-0 shadow-lg"
            align="end"
            collisionPadding={8}
            sticky="always"
          >
            {calendarView === "days" ? (
              <Calendar
                mode="single"
                selected={value}
                onSelect={handleSelect}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                captionLayout="dropdown"
                startMonth={startMonth}
                endMonth={endMonth}
                disabled={[
                  ...(minDate ? [{ before: startOfDay(minDate) }] : []),
                  ...(maxDate ? [{ after: startOfDay(maxDate) }] : []),
                ]}
                initialFocus
                className="border-none pb-2 shadow-none"
                components={{
                  Dropdown: ({ value: dropdownValue, options, "aria-label": ariaLabel }: any) => {
                    const selectedOption = options?.find(
                      (option: { value: string | number }) => String(option.value) === String(dropdownValue)
                    )
                    const isMonthDropdown = String(ariaLabel).toLowerCase().includes("month")

                    return (
                      <button
                        ref={isMonthDropdown ? monthTriggerRef : yearTriggerRef}
                        type="button"
                        onClick={() => {
                          returnFocusTo.current = null
                           if (!isMonthDropdown) {
                             setFocusedYearIndex(selectedYearIndex)
                             setYearScrollTop(Math.max(
                               0,
                               Math.floor(selectedYearIndex / YEAR_COLUMN_COUNT) * YEAR_ROW_HEIGHT -
                                 YEAR_VIEWPORT_HEIGHT / 2 +
                                 YEAR_ROW_HEIGHT / 2
                             ))
                           }
                          setCalendarView(isMonthDropdown ? "months" : "years")
                        }}
                        className="border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex h-11 min-w-0 flex-1 items-center justify-between gap-1 rounded-md border px-2 text-sm font-medium shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1"
                        aria-label={isMonthDropdown ? "Choose month" : "Choose year"}
                      >
                        <span className="truncate">{selectedOption?.label ?? dropdownValue}</span>
                        <ChevronDown className="size-4 shrink-0 opacity-50" />
                      </button>
                    )
                  },
                }}
              />
            ) : (
              <div className="p-3">
                <div className="mb-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={() => setCalendarView("days")}
                    aria-label="Back to calendar"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <p
                    id={calendarView === "months" ? monthChoicesLabelId : yearChoicesLabelId}
                    className="text-sm font-semibold"
                  >
                    {calendarView === "months" ? "Choose month" : "Choose year"}
                  </p>
                </div>
                {calendarView === "months" ? (
                  <div
                    role="radiogroup"
                    aria-labelledby={monthChoicesLabelId}
                    className="grid grid-cols-3 gap-2"
                  >
                    {monthNames.map((monthName, monthIndex) => {
                      const isOutsideRange =
                        (calendarMonth.getFullYear() === startMonth.getFullYear() && monthIndex < startMonth.getMonth()) ||
                        (calendarMonth.getFullYear() === endMonth.getFullYear() && monthIndex > endMonth.getMonth())
                      const isSelected = calendarMonth.getMonth() === monthIndex

                      return (
                        <Button
                          key={monthName}
                          ref={(node) => {
                            monthButtonRefs.current[monthIndex] = node
                            if (calendarMonth.getMonth() === monthIndex) {
                              selectedMonthRef.current = node
                            }
                          }}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          variant={isSelected ? "default" : "outline"}
                          size="sm"
                          className="h-11"
                          disabled={isOutsideRange}
                          onKeyDown={(event) => handleGridKeyDown(event, monthIndex, 3, monthButtonRefs)}
                          onClick={() => {
                            setCalendarMonth(new Date(calendarMonth.getFullYear(), monthIndex, 1))
                            returnFocusTo.current = "month"
                            setCalendarView("days")
                          }}
                        >
                          {monthName}
                        </Button>
                      )
                    })}
                  </div>
                ) : (
                  <div
                    role="radiogroup"
                    aria-labelledby={yearChoicesLabelId}
                  >
                    <p
                      id={yearKeyboardHelpId}
                      className="hidden md:mb-3 md:block md:text-xs md:text-muted-foreground"
                    >
                      Use Page Up or Page Down to jump 10 years. Use Control plus Home or End to jump to the first or last year.
                    </p>
                    <div
                      ref={yearScrollRef}
                      className="max-h-[min(280px,calc(var(--app-visual-height,100dvh)-9rem))] touch-pan-y overscroll-contain overflow-y-auto [-webkit-overflow-scrolling:touch]"
                      onScroll={(event) => setYearScrollTop(event.currentTarget.scrollTop)}
                    >
                      <div
                        className="relative"
                        style={{ height: totalYearRows * YEAR_ROW_HEIGHT }}
                      >
                        <div
                          className="absolute right-0 left-0 grid grid-cols-3 gap-x-2 gap-y-1"
                          style={{ top: firstVisibleYearRow * YEAR_ROW_HEIGHT }}
                        >
                          {visibleYears.map((year, visibleIndex) => {
                            const yearIndex = yearWindowStart + visibleIndex
                            const isSelected = calendarMonth.getFullYear() === year

                            return (
                              <Button
                                key={year}
                                ref={(node) => {
                                  if (node) {
                                    yearButtonRefs.current.set(yearIndex, node)
                                  } else {
                                    yearButtonRefs.current.delete(yearIndex)
                                  }
                                }}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                variant={isSelected ? "default" : "ghost"}
                                size="sm"
                                className={cn(
                                  "h-11 rounded-lg border-0 px-1 text-sm font-medium shadow-none",
                                  !isSelected && "text-foreground hover:bg-accent"
                                )}
                                aria-describedby={yearKeyboardHelpId}
                                aria-posinset={yearIndex + 1}
                                aria-setsize={selectableYearCount}
                                onFocus={() => setFocusedYearIndex(yearIndex)}
                                onKeyDown={(event) => handleYearKeyDown(event, yearIndex)}
                                onClick={() => {
                                  const firstAllowedMonth = year === startMonth.getFullYear() ? startMonth.getMonth() : 0
                                  const lastAllowedMonth = year === endMonth.getFullYear() ? endMonth.getMonth() : 11
                                  const nextMonth = Math.min(Math.max(calendarMonth.getMonth(), firstAllowedMonth), lastAllowedMonth)
                                  setCalendarMonth(new Date(year, nextMonth, 1))
                                  returnFocusTo.current = "year"
                                  setCalendarView("days")
                                }}
                              >
                                {year}
                              </Button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {showTodayShortcut && calendarView === "days" && (
              <div className="bg-background w-full px-3 pt-0 pb-3">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="shadow-xs h-11 w-full font-semibold"
                  onClick={() => handleSelect(new Date())}
                  disabled={
                    (minDate && isBefore(startOfDay(new Date()), startOfDay(minDate))) ||
                    (maxDate && isAfter(startOfDay(new Date()), startOfDay(maxDate)))
                  }
                >
                  Today
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {error && (
        <span
          id={errorId}
          role="alert"
          className="text-warning absolute -bottom-5 left-0 text-xs"
        >
          {error}
        </span>
      )}
    </div>
  )
}

function parseDateString(value: string): Date | null {
  let date = parse(value, "dd/MM/yyyy", new Date())
  if (isValid(date)) return date

  date = parse(value, "d/M/yyyy", new Date())
  if (isValid(date)) return date

  date = parse(value, "yyyy-MM-dd", new Date())
  if (isValid(date)) return date

  return null
}
