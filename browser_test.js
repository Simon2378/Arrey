const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    await runTest(browser);
  } finally {
    await browser.close();
  }
})();

async function runTest(browser) {
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:8787" });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  function assert(cond, msg) {
    console.log((cond ? "PASS: " : "FAIL: ") + msg);
    if (!cond) process.exitCode = 1;
  }

  // --- go to a real product page and add to cart ---
  await page.goto("http://localhost:8787/packwraps-x-twisted-hemp-designer-hemp-wraps-2-pack/index.html", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });

  const qtyValueOnLoad = await page.locator('input[name="qty[]"]').first().inputValue();
  assert(qtyValueOnLoad === "34", "qty field pre-filled to 34 for a $2.99 item, got: " + qtyValueOnLoad);

  const firstRadioId = await page.locator('input[name="attribute[175]"]').first().getAttribute("id");
  await page.locator('label[for="' + firstRadioId + '"]').click();
  await page.locator("#form-action-addToCart").click();
  await page.waitForTimeout(300);

  const badgeText = await page.locator(".cart-quantity").first().textContent();
  assert(badgeText.trim() === "34", "cart badge shows 34 after add-to-cart, got: " + JSON.stringify(badgeText));
  assert(page.url().includes("packwraps"), "adding to cart does not navigate away from the product page");

  const toastVisible = await page.locator(".txcc-toast--visible").isVisible().catch(() => false);
  assert(toastVisible, "a visible toast confirms the add-to-cart");

  // --- click the cart icon: should be a REAL navigation to /cart/, not a dropdown ---
  await page.locator(".navUser-action--cart").first().click();
  await page.waitForLoadState("domcontentloaded");
  assert(page.url() === "http://localhost:8787/cart/", "clicking the cart icon navigates to /cart/, got: " + page.url());

  // #cart-preview-dropdown is still present (harmless, empty, hidden by the
  // theme's own default CSS) since the cart page is cloned from a template
  // that has it in its header -- nothing renders into it anymore.

  const cartPageBadge = await page.locator(".cart-quantity").first().textContent();
  assert(cartPageBadge.trim() === "34", "badge persists correctly on the cart page itself, got: " + cartPageBadge);

  const heading = await page.locator("h1.page-heading").textContent().catch(() => "");
  assert(heading.trim() === "Your Cart", "cart page shows a 'Your Cart' heading, got: " + JSON.stringify(heading));

  const rowCount = await page.locator(".txcc-cart-row").count();
  assert(rowCount === 1, "cart page shows the 1 line item added, got: " + rowCount);
  const total = await page.locator(".txcc-cart-total").textContent();
  assert(total.includes("$101.66"), "cart page total is correct (34 x $2.99), got: " + total);

  // --- select Bitcoin, copy the address ---
  await page.locator(".txcc-payment-btn--bitcoin").click();
  await page.waitForTimeout(150);
  const btcDetail = await page.locator(".txcc-payment-detail").textContent();
  assert(btcDetail.includes("bc1q0fd8xuhdcwtzpe2n69y8qwhrg63v7mp68xcvgc"), "Bitcoin address shows, got: " + btcDetail);

  const copyBtn = page.locator("[data-copy-address]").first();
  await copyBtn.click();
  await page.waitForTimeout(100);
  assert((await copyBtn.textContent()).trim() === "Copied!", "copy button shows 'Copied!' feedback");
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => "ERROR: " + e.message);
  assert(clipboardText === "bc1q0fd8xuhdcwtzpe2n69y8qwhrg63v7mp68xcvgc", "clipboard actually contains the address, got: " + clipboardText);

  const alertVisible = await page.locator("#alert-modal").isVisible().catch(() => false);
  assert(!alertVisible, "no theme error-alert modal appears when selecting a payment method");

  // --- remove the item, verify empty state ---
  await page.locator(".txcc-remove-btn").click();
  await page.waitForTimeout(150);
  const emptyText = await page.locator("#cart-page-content").textContent();
  assert(emptyText.includes("Your cart is empty"), "empty state shows after removing the only item, got: " + emptyText);
  const badgeAfterEmpty = await page.locator(".cart-quantity").first().textContent();
  assert(badgeAfterEmpty.trim() === "", "badge clears once cart is empty");

  console.log("\n--- console errors during full flow ---");
  consoleErrors.forEach((e) => console.log(" ", e));

  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
}
