import { expect, test, type Locator, type Page } from '@playwright/test';

const boundedValue = (page: Page) => page.getByTestId('bounded-value');
const optionalValue = (page: Page) => page.getByTestId('optional-value');
const mobileDatePickerViewports = [
  { width: 320, height: 800 },
  { width: 375, height: 800 },
  { width: 390, height: 800 },
  { width: 320, height: 480 },
  { width: 375, height: 480 },
  { width: 390, height: 480 },
] as const;

async function openCalendar(input: Locator) {
  await input.locator('xpath=..').getByRole('button', { name: 'Open calendar' }).click();
}

async function openCalendarWithKeyboard(input: Locator) {
  const trigger = input.locator('xpath=..').getByRole('button', { name: 'Open calendar' });
  await trigger.focus();
  await trigger.press('Enter');
  return trigger;
}

async function swipeUp(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Year chooser is not visible');

  const client = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const startY = box.y + box.height * 0.78;
  const endY = box.y + box.height * 0.22;

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: startY }],
  });
  for (let step = 1; step <= 8; step += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: startY + ((endY - startY) * step) / 8 }],
    });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

async function reloadHarnessAt(
  page: Page,
  viewport: (typeof mobileDatePickerViewports)[number],
  theme: 'light' | 'dark',
) {
  await page.setViewportSize(viewport);
  await page.evaluate((nextTheme) => {
    localStorage.setItem('ezyretire-theme', JSON.stringify(nextTheme));
  }, theme);
  await page.reload();
  await expect(page.getByLabel('Optional date')).toBeVisible();
  if (theme === 'dark') {
    await expect(page.locator('html')).toHaveClass(/dark/);
  } else {
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  }
}

function calendarPopover(page: Page) {
  return page.locator('[role="dialog"]').filter({
    has: page.locator('[data-slot="calendar"]'),
  }).last();
}

async function expectInputControlsToFit(input: Locator) {
  const field = input.locator('xpath=..');
  const trigger = field.getByRole('button', { name: 'Open calendar' });
  const clear = field.getByRole('button', { name: 'Clear date' });
  const [fieldBox, inputBox, triggerBox, clearBox] = await Promise.all([
    field.boundingBox(),
    input.boundingBox(),
    trigger.boundingBox(),
    clear.boundingBox(),
  ]);

  expect(fieldBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();
  expect(clearBox).not.toBeNull();
  expect(inputBox!.x).toBeGreaterThanOrEqual(fieldBox!.x - 1);
  expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(fieldBox!.x + fieldBox!.width + 1);
  expect(triggerBox!.x).toBeGreaterThanOrEqual(fieldBox!.x - 1);
  expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(fieldBox!.x + fieldBox!.width + 1);
  expect(clearBox!.x).toBeGreaterThanOrEqual(fieldBox!.x - 1);
  expect(clearBox!.x + clearBox!.width).toBeLessThanOrEqual(fieldBox!.x + fieldBox!.width + 1);
  expect(clearBox!.x + clearBox!.width).toBeLessThanOrEqual(triggerBox!.x + 1);
  expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(clearBox!.x + 1);
  const textFits = await input.evaluate((element: HTMLInputElement) => {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = style.font;
    const available = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return context.measureText(element.value || element.placeholder).width <= available;
  });
  expect(textFits, 'the complete date text must fit without scrolling or icon overlap').toBe(true);
}

async function expectCalendarGeometry(page: Page, viewport: (typeof mobileDatePickerViewports)[number]) {
  const popover = calendarPopover(page);
  await expect(popover).toBeVisible();
  const geometry = await popover.evaluate((element) => {
    const popoverRect = element.getBoundingClientRect();
    const calendar = element.querySelector<HTMLElement>('[data-slot="calendar"]');
    const calendarRect = calendar?.getBoundingClientRect();
    const dayHeights = Array.from(
      element.querySelectorAll<HTMLElement>('[data-day]'),
    ).filter((day) => day.getClientRects().length > 0).map((day) => day.getBoundingClientRect().height);
    const style = getComputedStyle(element);
    return {
      x: popoverRect.x,
      right: popoverRect.right,
      top: popoverRect.top,
      bottom: popoverRect.bottom,
      width: popoverRect.width,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowY: style.overflowY,
      calendarX: calendarRect?.x ?? null,
      calendarRight: calendarRect?.right ?? null,
      dayHeights,
    };
  });

  expect(geometry.x).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.top).toBeGreaterThanOrEqual(-1);
  expect(geometry.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(geometry.width).toBeLessThanOrEqual(Math.min(352, viewport.width - 16) + 1);
  expect(geometry.calendarX).not.toBeNull();
  expect(geometry.calendarRight).not.toBeNull();
  expect(geometry.calendarX!).toBeGreaterThanOrEqual(geometry.x - 1);
  expect(geometry.calendarRight!).toBeLessThanOrEqual(geometry.right + 1);
  expect(geometry.dayHeights.length).toBeGreaterThan(0);
  expect(Math.min(...geometry.dayHeights)).toBeGreaterThanOrEqual(40);
  expect(geometry.overflowY).toMatch(/auto|scroll/);
  if (viewport.height <= 480) {
    expect(geometry.scrollHeight).toBeGreaterThanOrEqual(geometry.clientHeight);
  }
}

test.describe('shared date picker input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/__date-picker-test');
  });

  test('announces grouped month and year choices, selection, and disabled boundaries', async ({ page }) => {
    const input = page.getByLabel('Bounded date');
    await openCalendar(input);

    await page.getByRole('button', { name: 'Choose year' }).click();
    await page.getByRole('radio', { name: '2020', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose year' })).toHaveText(/2020/);

    await page.getByRole('button', { name: 'Choose month' }).click();
    await expect(page.getByRole('radio', { name: 'Jan', exact: true })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Feb', exact: true })).toBeDisabled();
    await page.getByRole('radio', { name: 'Mar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose month' })).toHaveText(/March/);

    await expect(page.getByRole('button', { name: /March 9th, 2020/ })).toBeDisabled();
    await page.getByRole('button', { name: /March 10th, 2020/ }).click();
    await expect(input).toHaveValue('10/03/2020');
    await expect(boundedValue(page)).toHaveText('2020-03-10');
  });

  test('supports keyboard-only view selection, restores focus, and cancels with Escape', async ({ page }) => {
    const input = page.getByLabel('Bounded date');
    const trigger = await openCalendarWithKeyboard(input);

    const yearChooser = page.getByRole('button', { name: 'Choose year' });
    await yearChooser.focus();
    await yearChooser.press('Enter');

    const year2021 = page.getByRole('radio', { name: '2021', exact: true });
    await expect(year2021).toBeFocused();
    await year2021.press('ArrowLeft');
    const year2020 = page.getByRole('radio', { name: '2020', exact: true });
    await expect(year2020).toBeFocused();
    await year2020.press('Enter');
    await expect(yearChooser).toBeFocused();

    const monthChooser = page.getByRole('button', { name: 'Choose month' });
    await monthChooser.press('Enter');
    const june = page.getByRole('radio', { name: 'Jun', exact: true });
    await expect(june).toBeFocused();
    await page.keyboard.press('ArrowUp');
    const march = page.getByRole('radio', { name: 'Mar', exact: true });
    await expect(march).toBeFocused();
    await march.press('Enter');
    await expect(monthChooser).toBeFocused();

    const march10 = page.getByRole('button', { name: /March 10th, 2020/ });
    await march10.focus();
    await march10.press('Enter');
    await expect(input).toHaveValue('10/03/2020');
    await expect(trigger).toBeFocused();

    await trigger.press('Enter');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(input).toHaveValue('10/03/2020');
  });

  test('keeps a multi-millennium year range responsive and keyboard navigable', async ({ page }) => {
    const input = page.getByLabel('Wide range date');
    await openCalendar(input);
    await page.getByRole('button', { name: 'Choose year' }).click();

    const yearGroup = page.getByRole('radiogroup', { name: 'Choose year' });
    const renderedYears = yearGroup.getByRole('radio');

    expect(await renderedYears.count()).toBeLessThanOrEqual(52);
    await expect(page.getByRole('radio', { name: '2000', exact: true })).toBeFocused();

    await page.keyboard.press('PageDown');
    await expect(page.getByRole('radio', { name: '2010', exact: true })).toBeFocused();
    await page.keyboard.press('PageUp');
    await expect(page.getByRole('radio', { name: '2000', exact: true })).toBeFocused();

    await page.keyboard.press('Control+Home');
    await expect(page.getByRole('radio', { name: '1000', exact: true })).toBeFocused();
    expect(await renderedYears.count()).toBeLessThanOrEqual(52);

    await page.keyboard.press('Control+End');
    await expect(page.getByRole('radio', { name: '5000', exact: true })).toBeFocused();
    expect(await renderedYears.count()).toBeLessThanOrEqual(52);
  });

  test('scrolls continuously through a wide year range and selects a visible year', async ({ page }) => {
    const input = page.getByLabel('Wide range date');
    await openCalendar(input);
    await page.getByRole('button', { name: 'Choose year' }).click();

    const yearGroup = page.getByRole('radiogroup', { name: 'Choose year' });
    const yearScroller = yearGroup.locator('.overflow-y-auto');
    const renderedYears = yearGroup.getByRole('radio');

    let previousFirstYear = Number((await renderedYears.allTextContents())[0]);

    await yearScroller.hover();
    for (let step = 0; step < 6; step += 1) {
      await page.mouse.wheel(0, 176);
      await expect.poll(async () => {
        const years = (await renderedYears.allTextContents()).map(Number);
        return years.length > 0
          && years[0] > previousFirstYear
          && years.every((year, index) => index === 0 || year === years[index - 1] + 1);
      }).toBe(true);

      const visibleYears = (await renderedYears.allTextContents()).map(Number);
      previousFirstYear = visibleYears[0];
    }

    const finalVisibleYears = (await renderedYears.allTextContents()).map(Number);
    const targetYear = finalVisibleYears[Math.floor(finalVisibleYears.length / 2)];
    await page.getByRole('radio', { name: String(targetYear), exact: true }).click();

    await expect(page.getByRole('button', { name: 'Choose year' })).toHaveText(String(targetYear));
    await expect(page.getByRole('button', { name: 'Back to calendar' })).toHaveCount(0);
    await page.getByRole('button', { name: new RegExp(`January 1st, ${targetYear}`) }).click();
    await expect(input).toHaveValue(`01/01/${targetYear}`);
  });

  test('swipes continuously through a wide year range and selects a visible year @touch', async ({ page }) => {
    const input = page.getByLabel('Wide range date');
    await openCalendar(input);
    await page.getByRole('button', { name: 'Choose year' }).click();

    const yearGroup = page.getByRole('radiogroup', { name: 'Choose year' });
    const yearScroller = yearGroup.locator('.overflow-y-auto');
    const renderedYears = yearGroup.getByRole('radio');
    let previousFirstYear = Number((await renderedYears.allTextContents())[0]);

    for (let step = 0; step < 6; step += 1) {
      await swipeUp(page, yearScroller);
      await expect.poll(async () => {
        const years = (await renderedYears.allTextContents()).map(Number);
        return years.length > 0
          && years[0] > previousFirstYear
          && years.every((year, index) => index === 0 || year === years[index - 1] + 1);
      }).toBe(true);

      const visibleYears = (await renderedYears.allTextContents()).map(Number);
      previousFirstYear = visibleYears[0];
    }

    const finalVisibleYears = (await renderedYears.allTextContents()).map(Number);
    const targetYear = finalVisibleYears[Math.floor(finalVisibleYears.length / 2)];
    await page.getByRole('radio', { name: String(targetYear), exact: true }).tap();

    await expect(page.getByRole('button', { name: 'Choose year' })).toHaveText(String(targetYear));
    await expect(page.getByRole('button', { name: 'Back to calendar' })).toHaveCount(0);
    await page.getByRole('button', { name: new RegExp(`January 1st, ${targetYear}`) }).tap();
    await expect(input).toHaveValue(`01/01/${targetYear}`);
  });

  test('virtualizes and navigates JavaScript’s full supported year range', async ({ page }) => {
    const input = page.getByLabel('Full JavaScript date range');
    await openCalendar(input);
    await page.getByRole('button', { name: 'Choose year' }).click();

    const yearGroup = page.getByRole('radiogroup', { name: 'Choose year' });
    const renderedYears = yearGroup.getByRole('radio');

    expect(await renderedYears.count()).toBeLessThanOrEqual(52);
    await page.keyboard.press('Control+Home');
    await expect(page.getByRole('radio', { name: '-271821', exact: true })).toBeFocused();
    expect(await renderedYears.count()).toBeLessThanOrEqual(52);

    await page.keyboard.press('Control+End');
    await expect(page.getByRole('radio', { name: '275760', exact: true })).toBeFocused();
    expect(await renderedYears.count()).toBeLessThanOrEqual(52);
  });

  test('clears an optional date and restores today from the calendar shortcut', async ({ page }) => {
    const input = page.getByLabel('Optional date');
    await input.locator('xpath=..').getByRole('button', { name: 'Clear date' }).click();
    await expect(input).toHaveValue('');
    await expect(optionalValue(page)).toHaveText('empty');

    await openCalendar(input);
    await page.getByRole('button', { name: 'Today', exact: true }).click();

    const today = await page.evaluate(() => {
      const date = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      return {
        input: `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`,
        saved: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      };
    });
    await expect(input).toHaveValue(today.input);
    await expect(optionalValue(page)).toHaveText(today.saved);
  });

  test('keeps complete date text and calendar controls inside mobile viewports in light and dark themes', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      for (const viewport of mobileDatePickerViewports) {
        await reloadHarnessAt(page, viewport, theme);
        const input = page.getByLabel('Optional date');
        await expect(input).toHaveValue('02/01/2020');
        await expectInputControlsToFit(input);

        await openCalendar(input);
        await expectCalendarGeometry(page, viewport);

        if (viewport.height <= 480) {
          const today = calendarPopover(page).getByRole('button', { name: 'Today', exact: true });
          await today.scrollIntoViewIfNeeded();
          await expect(today).toBeInViewport();
        }

        await page.keyboard.press('Escape');
        await expect(calendarPopover(page)).toHaveCount(0);
      }
    }
  });

  test('accepts direct text entry while retaining bounded date constraints', async ({ page }) => {
    const input = page.getByLabel('Bounded date');

    await input.fill('09/03/2020');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toContainText('on or after 10/03/2020');
    await expect(boundedValue(page)).toHaveText('2021-06-15');

    await input.fill('10/03/2020');
    await expect(input).toHaveValue('10/03/2020');
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await expect(boundedValue(page)).toHaveText('2020-03-10');
  });

  test('returns focus from month and year choices on a narrow short screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    const input = page.getByLabel('Optional date');
    const trigger = await openCalendarWithKeyboard(input);

    const yearChooser = page.getByRole('button', { name: 'Choose year' });
    await yearChooser.press('Enter');
    const year2020 = page.getByRole('radio', { name: '2020', exact: true });
    await expect(year2020).toBeFocused();
    await year2020.press('Enter');
    await expect(yearChooser).toBeFocused();

    const monthChooser = page.getByRole('button', { name: 'Choose month' });
    await monthChooser.press('Enter');
    const january = page.getByRole('radio', { name: 'Jan', exact: true });
    await expect(january).toBeFocused();
    await january.press('Enter');
    await expect(monthChooser).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
});
