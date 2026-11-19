async function snapshotPriceOptions(priceOptions) {
  const options = await priceOptions.evaluateAll(elements => elements.map(element => {
    const card = element.closest('[data-testid^="coc-"]');
    const label = element.closest('label[for]');
    if (!card && !label) {
      throw new Error('Price option has no stable commitment ID or label association');
    }

    return {
      selector: card
        ? `[data-testid=${JSON.stringify(card.getAttribute('data-testid'))}]`
        : `label[for=${JSON.stringify(label.getAttribute('for'))}]`,
      price: element.textContent,
    };
  }));

  if (options.length === 0 || new Set(options.map(option => option.selector)).size !== options.length) {
    throw new Error('Expected non-empty price options with unique stable identities');
  }
  return options;
}

function locatePriceOption(modal, option) {
  return modal.locator(option.selector)
    .locator('.subscription-panel-offer-price, [data-testid="main-price"]')
    .filter({ visible: true });
}

module.exports = { snapshotPriceOptions, locatePriceOption };
