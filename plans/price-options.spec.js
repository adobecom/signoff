const { test, expect } = require('@playwright/test');
const { snapshotPriceOptions, locatePriceOption } = require('./price-options');

const plans = [
  { id: 'MONTH-MONTHLY', price: '$20/mo' },
  { id: 'YEAR-MONTHLY', price: '$20/mo' },
  { id: 'YEAR-ANNUAL', price: '$240/yr' },
];

function markup(options, legacy = false) {
  return options.map(option => legacy
    ? `<input id="${option.id}" type="radio" name="plan"><label for="${option.id}"><span class="subscription-panel-offer-price">${option.price}</span></label>`
    : `<div data-testid="coc-${option.id}"><div data-testid="main-price">${option.price}</div></div>`
  ).join('');
}

for (const legacy of [false, true]) {
  test(`matches ${legacy ? 'legacy' : '3-in-1'} options after modal reorder`, async ({ page }) => {
    await page.setContent('<iframe></iframe>');
    const modal = page.frameLocator('iframe');
    const body = modal.locator('body');
    await body.evaluate((element, html) => {
      element.innerHTML = html;
      element.addEventListener('click', event => {
        const option = event.target.closest('[data-testid^="coc-"], label[for]');
        if (option) element.dataset.selected = option.getAttribute('data-testid') || option.getAttribute('for');
      });
    }, markup(plans, legacy));

    const prices = modal.locator('.subscription-panel-offer-price, [data-testid="main-price"]');
    const options = await snapshotPriceOptions(prices);
    const tested = [];

    for (let index = 0; index < options.length; index++) {
      const current = locatePriceOption(modal, options[index]);
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(options[index].price);
      await current.click();
      const expectedId = `${legacy ? '' : 'coc-'}${plans[index].id}`;
      await expect(body).toHaveAttribute('data-selected', expectedId);
      tested.push(expectedId);
      await body.evaluate((element, html) => { element.innerHTML = html; },
        markup([plans[2], plans[0], plans[1]], legacy));
    }

    expect(new Set(tested).size).toBe(3);
  });
}

test('preserves expected prices and reports missing or ambiguous identities', async ({ page }) => {
  await page.setContent(markup(plans));
  const prices = page.locator('[data-testid="main-price"]');
  const options = await snapshotPriceOptions(prices);

  await page.setContent(markup([{ ...plans[1], price: '$25/mo' }, plans[0]]));
  const changed = locatePriceOption(page, options[1]);
  await expect(changed).toHaveText('$25/mo');
  expect(await changed.textContent()).not.toBe(options[1].price);
  await expect(locatePriceOption(page, options[2])).toHaveCount(0);

  await page.setContent(markup([plans[0], plans[0]]));
  await expect(locatePriceOption(page, options[0])).toHaveCount(2);
  await expect(snapshotPriceOptions(prices)).rejects.toThrow('unique stable identities');

  await page.setContent('<div data-testid="main-price">$20/mo</div>');
  await expect(snapshotPriceOptions(prices)).rejects.toThrow('no stable commitment ID');
});
