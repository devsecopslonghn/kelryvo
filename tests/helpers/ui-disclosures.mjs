/** Follow the visible disclosure controls used by the compatibility workflows. */
export async function openCompatibilityPlanning(page, { legacy = false } = {}) {
  const compatibility = page.locator('.legacy-planning');
  await compatibility.waitFor({ state: 'attached' });
  if (!await compatibility.evaluate(node => node.open)) await compatibility.locator(':scope > summary').click();
  if (legacy) {
    const unbound = compatibility.locator('details').filter({ has: page.getByText('Legacy unbound planning', { exact: true }) });
    if (!await unbound.evaluate(node => node.open)) await unbound.locator(':scope > summary').click();
  }
}

/** Token recovery remains available behind its explicit HTTPS sign-in disclosure. */
export async function openTokenRecovery(page) {
  const recovery = page.locator('details.login-recovery');
  await recovery.waitFor({ state: 'attached' });
  if (!await recovery.evaluate(node => node.open)) await recovery.locator(':scope > summary').click();
}
