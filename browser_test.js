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

  // --- empty cart state on homepage ---
  await page.goto("http://localhost:8787/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.locator(".navUser-action--cart").first().click();
  await page.waitForTimeout(300);
  const emptyPanelHTML = await page.locator("#cart-preview-dropdown").innerHTML();
  assert(emptyPanelHTML.includes("Your cart is empty"), "empty cart shows 'Your cart is empty', got: " + emptyPanelHTML.trim());
  assert(page.url() === "http://localhost:8787/", "clicking cart icon does not navigate away");

  // --- go to a real ($2.99) product page: quantity should be pre-filled to the
  // minimum needed to reach the $100 order minimum on its own (ceil(100/2.99) = 34) ---
  await page.goto("http://localhost:8787/packwraps-x-twisted-hemp-designer-hemp-wraps-2-pack/index.html", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });

  const qtyValueOnLoad = await page.locator('input[name="qty[]"]').first().inputValue();
  assert(qtyValueOnLoad === "34", "qty field pre-filled to 34 for a $2.99 item (ceil(100/2.99)), got: " + qtyValueOnLoad);

  // pick a required variant option by clicking the visible swatch label -- the native
  // radio input itself is visually hidden, same as a real user would interact with it
  const firstRadioId = await page.locator('input[name="attribute[175]"]').first().getAttribute("id");
  await page.locator('label[for="' + firstRadioId + '"]').click();
  await page.locator("#form-action-addToCart").click();
  await page.waitForTimeout(300);

  const badgeText = await page.locator(".cart-quantity").first().textContent();
  assert(badgeText.trim() === "34", "cart badge shows 34 after add-to-cart (minimum-qty enforced), got: " + JSON.stringify(badgeText));
  assert(page.url().includes("packwraps"), "adding to cart does not navigate away from the product page, url: " + page.url());

  const panelAfterAdd = await page.locator("#cart-preview-dropdown").innerHTML();
  assert(panelAfterAdd.includes("Packwraps"), "cart panel shows the added product name");
  assert(panelAfterAdd.includes("$101.66"), "cart total reflects 34 x $2.99 = $101.66, got panel: " + panelAfterAdd.replace(/\s+/g, " ").slice(0, 400));
  assert(panelAfterAdd.includes("txcc-payment-btn"), "payment method buttons show immediately since total already exceeds $100");
  assert(!panelAfterAdd.includes("txcc-min-order-notice"), "no minimum-order notice once total exceeds $100");

  // --- click Bitcoin, verify real address + copy button ---
  await page.locator(".txcc-payment-btn--bitcoin").click();
  await page.waitForTimeout(200);
  const btcDetail = await page.locator(".txcc-payment-detail").textContent();
  assert(btcDetail.includes("bc1q0fd8xuhdcwtzpe2n69y8qwhrg63v7mp68xcvgc"), "Bitcoin address shows in panel, got: " + btcDetail);

  const copyBtn = page.locator("[data-copy-address]").first();
  assert((await copyBtn.count()) === 1, "copy-to-clipboard button is present next to the address");
  await copyBtn.click();
  await page.waitForTimeout(100);
  const copyBtnText = await copyBtn.textContent();
  assert(copyBtnText.trim() === "Copied!", "copy button shows 'Copied!' after click, got: " + copyBtnText);
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => "ERROR: " + e.message);
  assert(clipboardText === "bc1q0fd8xuhdcwtzpe2n69y8qwhrg63v7mp68xcvgc", "clipboard actually contains the BTC address, got: " + clipboardText);

  // --- try to decrement quantity below the enforced minimum (34) via the "-" button ---
  for (let i = 0; i < 3; i++) {
    await page.locator('.txcc-qty-btn[data-action="dec"]').first().click();
    await page.waitForTimeout(80);
  }
  const qtyAfterDecrements = await page.locator(".txcc-qty-value").first().textContent();
  assert(qtyAfterDecrements.trim() === "34", "decrement button refuses to go below the per-item minimum (34), got: " + qtyAfterDecrements);

  console.log("\n--- console errors during full flow ---");
  consoleErrors.forEach((e) => console.log(" ", e));

  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
}
