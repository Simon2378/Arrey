const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SITE = "C:/Users/ESEMBE SIMON/Desktop/Arrey/public-site";
const productPage = path.join(SITE, "packwraps-x-twisted-hemp-designer-hemp-wraps-2-pack", "index.html");
const html = fs.readFileSync(productPage, "utf-8");

// No runScripts/resources here -- we don't want jsdom fetching every live
// external script (fonts, recaptcha, analytics...) off the real internet.
// We load only our own two files directly into the window's context below.
const dom = new JSDOM(html, {
  url: "http://localhost:8787/packwraps-x-twisted-hemp-designer-hemp-wraps-2-pack/index.html",
  runScripts: "outside-only", // lets our own eval() run in the window's context, without jsdom auto-executing the page's <script> tags (which would try to fetch live external CDN scripts)
});
const { window } = dom;

// minimal localStorage polyfill (jsdom without runScripts doesn't wire one up)
let cartStore = {};
window.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(cartStore, k) ? cartStore[k] : null),
  setItem: (k, v) => { cartStore[k] = String(v); },
  removeItem: (k) => { delete cartStore[k]; },
  clear: () => { cartStore = {}; },
};

// minimal clipboard mock -- resolves synchronously (a "thenable") so the test
// doesn't need to juggle a real microtask tick to observe the result
let copiedText = null;
window.navigator.clipboard = {
  writeText: function (text) {
    copiedText = text;
    return { then: function (onFulfilled) { onFulfilled(); return this; } };
  },
};

const paymentConfigSrc = fs.readFileSync(path.join(SITE, "payment-config.js"), "utf-8");
const cartJsSrc = fs.readFileSync(path.join(SITE, "cart.js"), "utf-8");

window.eval(paymentConfigSrc);
window.eval(cartJsSrc);

let failed = false;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed = true;
  } else {
    console.log("PASS:", msg);
  }
}

const doc = window.document;

function fireDOMContentLoaded() {
  doc.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));
}

fireDOMContentLoaded();

const pillBefore = doc.querySelector(".cart-quantity");
assert(!!pillBefore, "cart-quantity pill element exists in header");
assert(pillBefore.textContent.trim() === "", "badge starts empty before any add");

// This product is $2.99 -> minimum qty to reach the $100 order minimum on its
// own is ceil(100/2.99) = 34. applyMinQtyToProductPages() should have already
// pre-filled the quantity field to 34 on page load.
const qtyInput = doc.querySelector('input[name="qty[]"]');
assert(qtyInput.value === "34", "qty field pre-filled to 34 for a $2.99 item on page load, got: " + qtyInput.value);
assert(qtyInput.min === "34", "qty field min attribute set to 34, got: " + qtyInput.min);

const firstRadio = doc.querySelector('input[name="attribute[175]"]');
assert(!!firstRadio, "found a variant radio input");
firstRadio.checked = true;

const form = doc.querySelector("form[data-cart-item-add]");
assert(!!form, "found add-to-cart form");

// jsdom's HTMLFormElement.checkValidity/reportValidity aren't implemented ->
// stub them so our submit handler's validity gate doesn't throw.
form.checkValidity = () => true;
form.reportValidity = () => true;

// First add (qty already 34 from the pre-fill) -> badge shows 34, total $101.66, already above $100
form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

const pillAfter1 = doc.querySelector(".cart-quantity");
assert(pillAfter1.textContent.trim() === "34", "badge shows 34 after first add-to-cart, got: " + JSON.stringify(pillAfter1.textContent));
assert(pillAfter1.classList.contains("countPill--positive"), "badge has countPill--positive class after first add");

let panel = doc.getElementById("cart-preview-dropdown");
assert(panel.querySelectorAll(".txcc-cart-row").length === 1, "panel shows exactly 1 row after first add");
assert(panel.textContent.includes("Packwraps"), "panel shows the product name");
assert(panel.textContent.includes("$101.66"), "line total is 34 x $2.99 = $101.66, got: " + panel.textContent.replace(/\s+/g, " "));
assert(panel.querySelectorAll(".txcc-payment-btn").length > 0, "payment buttons show immediately since a single item already exceeds $100");
assert(!panel.querySelector(".txcc-min-order-notice"), "no minimum-order notice once total exceeds $100");

// Try to decrement below the enforced per-item minimum (34) via the "-" button
for (let i = 0; i < 3; i++) {
  const decBtn = panel.querySelector('.txcc-qty-btn[data-action="dec"]');
  decBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
}
panel = doc.getElementById("cart-preview-dropdown");
const qtyValueAfterDec = panel.querySelector(".txcc-qty-value");
assert(qtyValueAfterDec.textContent.trim() === "34", "decrement button refuses to go below the per-item minimum (34), got: " + qtyValueAfterDec.textContent);

// Second add, different variant -> distinct row, badge total qty = 68
const radios = doc.querySelectorAll('input[name="attribute[175]"]');
radios[0].checked = false;
radios[1].checked = true;
qtyInput.value = "34"; // applyMinQtyToProductPages only runs on page load, not per-submit; keep it at the minimum
form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

const pillAfter2 = doc.querySelector(".cart-quantity");
assert(pillAfter2.textContent.trim() === "68", "badge shows 68 after second add-to-cart (different variant, 34 each), got: " + JSON.stringify(pillAfter2.textContent));

panel = doc.getElementById("cart-preview-dropdown");
assert(panel.querySelectorAll(".txcc-cart-row").length === 2, "panel shows 2 distinct rows for 2 different variants");

const methodBtns = panel.querySelectorAll(".txcc-payment-btn");
assert(methodBtns.length === 4, "4 payment method buttons rendered, got " + methodBtns.length);
const labels = Array.from(methodBtns).map((b) => b.textContent.trim()).join(",");
assert(labels === "Bitcoin,Cash App,Chime,USDT (ERC20)", "payment method labels correct, got: " + labels);

const usdtBtn = Array.from(methodBtns).find((b) => b.textContent.trim() === "USDT (ERC20)");
usdtBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
let activeMethodBtn = panel.querySelector(".txcc-payment-btn--active");
assert(activeMethodBtn && activeMethodBtn.textContent.trim() === "USDT (ERC20)", "clicking USDT makes it the active payment method");
let usdtDetail = panel.querySelector(".txcc-payment-detail");
assert(usdtDetail.textContent.includes("0xf28d892f4c955bb26622486afb61660dda242ca0"), "USDT address is shown, got: " + usdtDetail.textContent);
assert(usdtDetail.textContent.includes("ERC20"), "USDT network warning is shown");

// copy-to-clipboard button next to the address
const copyBtn = panel.querySelector("[data-copy-address]");
assert(!!copyBtn, "copy-to-clipboard button rendered next to the address");
assert(copyBtn.getAttribute("data-copy-address") === "0xf28d892f4c955bb26622486afb61660dda242ca0", "copy button carries the correct address");
copyBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
assert(copiedText === "0xf28d892f4c955bb26622486afb61660dda242ca0", "clicking copy actually calls clipboard.writeText with the address, got: " + copiedText);
assert(copyBtn.textContent.trim() === "Copied!", "copy button shows 'Copied!' feedback after click, got: " + copyBtn.textContent);

// re-query fresh: the USDT click above triggered a re-render, replacing panel's children
const cashBtn = Array.from(panel.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Cash App");
cashBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
activeMethodBtn = panel.querySelector(".txcc-payment-btn--active");
assert(activeMethodBtn && activeMethodBtn.textContent.trim() === "Cash App", "clicking Cash App makes it the active payment method");

// Cash App / Chime: contactEmail placeholder state (no email set yet)
const detailNoEmail = panel.querySelector(".txcc-payment-detail");
assert(detailNoEmail.textContent.includes("coming soon"), "Cash App shows 'coming soon' placeholder when no email is set yet, got: " + detailNoEmail.textContent);
assert(!panel.querySelector(".txcc-payment-email-link"), "no mailto link rendered while contactEmail is still empty");

// simulate the email being provided, then re-click Cash App the way a real user
// would (the click handler always re-renders, even for an already-active method)
const cashMethod = window.PAYMENT_METHODS.find((m) => m.id === "cashapp");
cashMethod.contactEmail = "orders@example.com";
const cashBtnAgain = Array.from(panel.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Cash App");
cashBtnAgain.dispatchEvent(new window.Event("click", { bubbles: true }));
const emailLink = panel.querySelector(".txcc-payment-email-link");
assert(!!emailLink, "mailto link renders once contactEmail is set");
assert(emailLink.getAttribute("href").startsWith("mailto:orders@example.com"), "mailto link points at the configured email, got: " + (emailLink && emailLink.getAttribute("href")));
assert(emailLink.textContent.includes("Cash App"), "mailto link text mentions Cash App, got: " + (emailLink && emailLink.textContent));

const removeBtn = panel.querySelector(".txcc-remove-btn");
removeBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
const pillAfter3 = doc.querySelector(".cart-quantity");
assert(pillAfter3.textContent.trim() === "34", "badge shows 34 after removing one line item, got: " + JSON.stringify(pillAfter3.textContent));

// clicking the cart icon toggles the panel open/closed. It's already open at
// this point (opened by the first addToCart(), and correctly never closed by
// any of the in-panel interactions above -- that's the composedPath fix
// doing its job, since those clicks all bubble through document too).
const cartLink = doc.querySelector(".navUser-action--cart");
assert(!!cartLink, "found cart icon link");
assert(panel.classList.contains("open"), "panel is still open after all the in-panel interactions above (payment select, remove, etc.) -- confirms clicks inside the panel no longer close it");
cartLink.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
assert(!panel.classList.contains("open"), "clicking cart icon closes the (already open) panel");
cartLink.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
assert(panel.classList.contains("open"), "clicking cart icon again reopens the panel");

// --- minimum-order gate: inject a below-threshold cart state directly (simulates
// a page reload with a cart that somehow ended up under $100 -- e.g. an older
// cart saved before this feature existed) and confirm the render logic itself
// hides payment methods and shows the correct "add $X more" notice.
window.localStorage.setItem("txcc_cart_v1", JSON.stringify([
  { id: "999", variant: "", name: "Cheap Test Item", price: 2, image: "", qty: 1, minQty: 1 },
]));
fireDOMContentLoaded();
panel = doc.getElementById("cart-preview-dropdown");
const notice = panel.querySelector(".txcc-min-order-notice");
assert(!!notice, "minimum-order notice renders when cart total is below $100");
assert(notice.textContent.includes("$98.00"), "notice states the correct remaining amount ($100 - $2 = $98.00), got: " + notice.textContent);
assert(panel.querySelectorAll(".txcc-payment-btn").length === 0, "payment method buttons are hidden while below the minimum");

// bump it back over $100 and confirm payment methods reappear
window.localStorage.setItem("txcc_cart_v1", JSON.stringify([
  { id: "999", variant: "", name: "Cheap Test Item", price: 2, image: "", qty: 60, minQty: 1 },
]));
fireDOMContentLoaded();
panel = doc.getElementById("cart-preview-dropdown");
assert(!panel.querySelector(".txcc-min-order-notice"), "notice disappears once total is back over $100");
assert(panel.querySelectorAll(".txcc-payment-btn").length === 4, "payment buttons reappear once total is back over $100");

console.log(failed ? "\nSOME TESTS FAILED" : "\nALL TESTS PASSED");
process.exit(failed ? 1 : 0);
