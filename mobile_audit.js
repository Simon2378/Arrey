const { chromium, devices } = require("playwright");

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const iphone = devices["iPhone 12"];
    const context = await browser.newContext({ ...iphone });
    const page = await context.newPage();

    const shots = [
      { url: "http://localhost:8787/", name: "01-home-top", fullPage: false },
      { url: "http://localhost:8787/", name: "02-home-full", fullPage: true },
      { url: "http://localhost:8787/concentrates/", name: "03-category", fullPage: true },
      { url: "http://localhost:8787/packwraps-x-twisted-hemp-designer-hemp-wraps-2-pack/", name: "04-product", fullPage: true },
    ];

    for (const shot of shots) {
      await page.goto(shot.url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `C:/Users/ESEMBE SIMON/Desktop/Arrey/mobile_${shot.name}.png`, fullPage: shot.fullPage });
      console.log("captured", shot.name);
    }

    // header nav opened (hamburger menu, if any)
    await page.goto("http://localhost:8787/", { waitUntil: "domcontentloaded", timeout: 20000 });
    const navToggle = page.locator('[data-nav-toggle], .navUser-item--menu, .headerActionSwitch');
    console.log("nav toggle candidates:", await navToggle.count());

    // add to cart on mobile, then view cart page
    const firstRadioId = await page.locator('input[name="attribute[175]"]').first().getAttribute("id");
    await page.goto("http://localhost:8787/packwraps-x-twisted-hemp-designer-hemp-wraps-2-pack/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.locator('label[for="' + firstRadioId + '"]').click();
    await page.locator("#form-action-addToCart").click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "C:/Users/ESEMBE SIMON/Desktop/Arrey/mobile_05-after-add-toast.png", fullPage: false });

    await page.locator(".navUser-action--cart").first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(300);
    await page.screenshot({ path: "C:/Users/ESEMBE SIMON/Desktop/Arrey/mobile_06-cart-page.png", fullPage: true });

    await page.locator(".txcc-payment-btn--bitcoin").click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: "C:/Users/ESEMBE SIMON/Desktop/Arrey/mobile_07-cart-payment-selected.png", fullPage: true });

    console.log("done");
  } finally {
    await browser.close();
  }
})();
