import { expect, test, type Locator, type Page } from '@playwright/test';

const boundedValue = (page: Page) => page.getByTestId('bounded-value');
const optionalValue = (page: Page) => page.getByTestId('optional-value');

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

test.describe('shared date picker input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/__date-picker-test');
  });

  test('announces grouped month and year choices, selection, and disabled boundaries', async ({ page }) => {
    const input = page.getByLabel('Optional date');
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
    const input = page.getByLabel('Optional date');
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
    const input = page.getByLabel('Optional date');
    await openCalendar(input);
    await page.getByRole('button', { name: 'Choose year' }).click();

    const renderedYears = yearGroup.getByRole('radio');

    const firstYear = page.getByRole('radio', { name: '-271821', exact: true });
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
    const input = page.getByLabel('Optional date');
    await openCalendar(input);
    await page.getByRole('button', { name: 'Choose year' }).click();

    const yearGroup = page.getByRole('radiogroup', { name: 'Choose year' });
    const yearScroller = yearGroup.locator('.overflow-y-auto');
    const renderedYears = yearGroup.getByRole('radio');

    const firstYear = page.getByRole('radio', { name: '-271821', exact: true });
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
    const input = page.getByLabel('Optional date');
    await openCalendar(input);
    await page.getByRole('button', { name: 'Choose year' }).click();

    const yearGroup = page.getByRole('radiogroup', { name: 'Choose year' });
    const yearScroller = yearGroup.locator('.overflow-y-auto');
    const renderedYears = yearGroup.getByRole('radio');

    const firstYear = page.getByRole('radio', { name: '-271821', exact: true });
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
});

    const lastYear = page.getByRole('radio', { name: '275760', exact: true });
