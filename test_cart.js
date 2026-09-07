const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SITE = "C:/Users/ESEMBE SIMON/Desktop/Arrey/public-site";
const paymentConfigSrc = fs.readFileSync(path.join(SITE, "payment-config.js"), "utf-8");
const cartJsSrc = fs.readFileSync(path.join(SITE, "cart.js"), "utf-8");

let failed = false;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed = true;
  } else {
    console.log("PASS:", msg);
  }
}

// Shared backing store simulates real localStorage persisting across page
// navigations on the same origin -- each simulated "page load" below gets
// its own JSDOM window (like a real navigation would), but they all read/
// write the same object, exactly like a real browser's localStorage would.
let cartStore = {};
function makeLocalStorage() {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(cartStore, k) ? cartStore[k] : null),
    setItem: (k, v) => { cartStore[k] = String(v); },
    removeItem: (k) => { delete cartStore[k]; },
    clear: () => { cartStore = {}; },
  };
}

function loadPage(relPath, url) {
  const html = fs.readFileSync(path.join(SITE, relPath), "utf-8");
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const { window } = dom;
  // window.localStorage is a getter-only accessor in jsdom (plain assignment
  // silently no-ops, per JS spec for a property with no setter) -- jsdom
  // supplies its own real Storage per JSDOM instance, which is NOT shared
  // across separate instances the way real browser localStorage persists
  // across page navigations. Object.defineProperty overrides the accessor
  // outright so both simulated "pages" here actually share cartStore.
  Object.defineProperty(window, "localStorage", { value: makeLocalStorage(), configurable: true });
  window.eval(paymentConfigSrc);
  window.eval(cartJsSrc);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));
  return window;
}

// ---------- Page 1: a product page ($2.99 item) ----------
let win1 = loadPage(
  "packwraps-x-twisted-hemp-designer-hemp-wraps-2-pack/index.html",
  "http://localhost:8787/packwraps-x-twisted-hemp-designer-hemp-wraps-2-pack/index.html"
);
let doc1 = win1.document;

const pillBefore = doc1.querySelector(".cart-quantity");
assert(!!pillBefore, "cart-quantity pill element exists in header");
assert(pillBefore.textContent.trim() === "", "badge starts empty before any add");

const cartLink = doc1.querySelector(".navUser-action--cart");
assert(!!cartLink, "found cart icon link");
assert(cartLink.getAttribute("href") === "/cart/", "cart icon is a plain link to /cart/, not a dropdown trigger, got: " + cartLink.getAttribute("href"));

// $2.99 item -> minimum qty to reach the $100 order minimum on its own is ceil(100/2.99) = 34
const qtyInput = doc1.querySelector('input[name="qty[]"]');
assert(qtyInput.value === "34", "qty field pre-filled to 34 for a $2.99 item on page load, got: " + qtyInput.value);
assert(qtyInput.min === "34", "qty field min attribute set to 34, got: " + qtyInput.min);

const firstRadio = doc1.querySelector('input[name="attribute[175]"]');
firstRadio.checked = true;

const form = doc1.querySelector("form[data-cart-item-add]");
form.checkValidity = () => true;
form.reportValidity = () => true;
form.dispatchEvent(new win1.Event("submit", { bubbles: true, cancelable: true }));

const pillAfter1 = doc1.querySelector(".cart-quantity");
assert(pillAfter1.textContent.trim() === "34", "badge shows 34 after add-to-cart, got: " + JSON.stringify(pillAfter1.textContent));
assert(pillAfter1.classList.contains("countPill--positive"), "badge has countPill--positive class after add");

const toast = doc1.querySelector(".txcc-toast");
assert(!!toast, "a toast notification appears after add-to-cart (no dropdown to confirm it anymore)");
assert(toast.textContent.includes("Packwraps"), "toast mentions the product name, got: " + (toast && toast.textContent));
assert(toast.classList.contains("txcc-toast--visible"), "toast has the visible class applied");

// second add, different variant
const radios = doc1.querySelectorAll('input[name="attribute[175]"]');
radios[0].checked = false;
radios[1].checked = true;
qtyInput.value = "34";
form.dispatchEvent(new win1.Event("submit", { bubbles: true, cancelable: true }));
const pillAfter2 = doc1.querySelector(".cart-quantity");
assert(pillAfter2.textContent.trim() === "68", "badge shows 68 after second add (different variant, 34 each), got: " + JSON.stringify(pillAfter2.textContent));

// ---------- Page 2: navigate to the cart page (fresh DOM, same shared cartStore) ----------
let win2 = loadPage("cart/index.html", "http://localhost:8787/cart/index.html");
let doc2 = win2.document;

const badgeOnCartPage = doc2.querySelector(".cart-quantity");
assert(badgeOnCartPage.textContent.trim() === "68", "cart page header badge also shows 68 (shared localStorage across the 'navigation'), got: " + badgeOnCartPage.textContent);

let cartContainer = doc2.getElementById("cart-page-content");
assert(!!cartContainer, "found #cart-page-content on the cart page");
assert(cartContainer.querySelectorAll(".txcc-cart-row").length === 2, "cart page shows both line items, got: " + cartContainer.querySelectorAll(".txcc-cart-row").length);
assert(cartContainer.textContent.includes("$203.32"), "cart page total is 68 x $2.99 = $203.32, got: " + cartContainer.textContent.replace(/\s+/g, " ").slice(0, 200));

const methodBtns = cartContainer.querySelectorAll(".txcc-payment-btn");
assert(methodBtns.length === 4, "4 payment method buttons rendered on cart page, got " + methodBtns.length);
const labels = Array.from(methodBtns).map((b) => b.textContent.trim()).join(",");
assert(labels === "Bitcoin,Cash App,Chime,USDT (ERC20)", "payment method labels correct, got: " + labels);

// select USDT, verify address + copy button
const usdtBtn = Array.from(methodBtns).find((b) => b.textContent.trim() === "USDT (ERC20)");
usdtBtn.dispatchEvent(new win2.Event("click", { bubbles: true }));
let activeBtn = cartContainer.querySelector(".txcc-payment-btn--active");
assert(activeBtn && activeBtn.textContent.trim() === "USDT (ERC20)", "clicking USDT makes it active");
let detail = cartContainer.querySelector(".txcc-payment-detail");
assert(detail.textContent.includes("0xf28d892f4c955bb26622486afb61660dda242ca0"), "USDT address shown, got: " + detail.textContent);

// payment-proof note + "i" button: disabled placeholder state (no email set yet)
let infoBtn = cartContainer.querySelector(".txcc-info-btn");
assert(!!infoBtn, "info button renders under the proof note");
assert(infoBtn.tagName === "SPAN" && infoBtn.classList.contains("txcc-info-btn--disabled"), "info button is disabled (a <span>, not a link) when no proof email is set yet");
assert(cartContainer.querySelector(".txcc-proof-note").textContent.includes("screenshot"), "proof note mentions sending a screenshot");

// simulate the real email being set, then re-click USDT (click handler always re-renders)
win2.PAYMENT_PROOF_EMAIL = "orders@example.com";
Array.from(cartContainer.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "USDT (ERC20)").dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");
infoBtn = cartContainer.querySelector(".txcc-info-btn");
assert(infoBtn.tagName === "A", "info button becomes a real link once the proof email is set");
assert(infoBtn.getAttribute("href").startsWith("mailto:orders@example.com"), "info button links to the configured email, got: " + infoBtn.getAttribute("href"));

let copiedText = null;
win2.navigator.clipboard = {
  writeText: function (text) {
    copiedText = text;
    return { then: function (onFulfilled) { onFulfilled(); return this; } };
  },
};
const copyBtn = cartContainer.querySelector("[data-copy-address]");
assert(!!copyBtn, "copy button present next to the address");
copyBtn.dispatchEvent(new win2.Event("click", { bubbles: true }));
assert(copiedText === "0xf28d892f4c955bb26622486afb61660dda242ca0", "copy button actually copies the address, got: " + copiedText);
assert(copyBtn.textContent.trim() === "Copied!", "copy button shows feedback, got: " + copyBtn.textContent);

// decrement floor: can't go below the per-item minimum (34) via "-"
for (let i = 0; i < 3; i++) {
  cartContainer.querySelector('.txcc-qty-btn[data-action="dec"]').dispatchEvent(new win2.Event("click", { bubbles: true }));
}
cartContainer = doc2.getElementById("cart-page-content");
assert(cartContainer.querySelector(".txcc-qty-value").textContent.trim() === "34", "decrement refuses to go below the per-item minimum (34)");

// Cash App: contactEmail placeholder, then simulate the real email being set
const cashBtn = Array.from(cartContainer.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Cash App");
cashBtn.dispatchEvent(new win2.Event("click", { bubbles: true }));
assert(cartContainer.querySelector(".txcc-payment-detail").textContent.includes("coming soon"), "Cash App shows 'coming soon' placeholder with no email set");
win2.PAYMENT_METHODS.find((m) => m.id === "cashapp").contactEmail = "orders@example.com";
Array.from(cartContainer.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Cash App").dispatchEvent(new win2.Event("click", { bubbles: true }));
const emailLink = cartContainer.querySelector(".txcc-payment-email-link");
assert(!!emailLink && emailLink.getAttribute("href").startsWith("mailto:orders@example.com"), "mailto link appears once contactEmail is set, got: " + (emailLink && emailLink.getAttribute("href")));

// remove a line item entirely
cartContainer.querySelector(".txcc-remove-btn").dispatchEvent(new win2.Event("click", { bubbles: true }));
const badgeAfterRemove = doc2.querySelector(".cart-quantity");
assert(badgeAfterRemove.textContent.trim() === "34", "badge shows 34 after removing one line item, got: " + badgeAfterRemove.textContent);

// remove the last item -> empty state with a "continue shopping" link
cartContainer.querySelector(".txcc-remove-btn").dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");
assert(cartContainer.textContent.includes("Your cart is empty"), "empty state shows once all items are removed, got: " + cartContainer.textContent);
assert(!!cartContainer.querySelector('a[href="/all-products/"]'), "empty state includes a continue-shopping link");
const badgeEmpty = doc2.querySelector(".cart-quantity");
assert(badgeEmpty.textContent.trim() === "", "badge is empty once the cart is empty");

// ---------- minimum-order gate: inject a below-threshold cart, load a 3rd "page" ----------
cartStore["txcc_cart_v1"] = JSON.stringify([
  { id: "999", variant: "", name: "Cheap Test Item", price: 2, image: "", qty: 1, minQty: 1 },
]);
let win3 = loadPage("cart/index.html", "http://localhost:8787/cart/index.html");
let doc3 = win3.document;
let container3 = doc3.getElementById("cart-page-content");
const notice = container3.querySelector(".txcc-min-order-notice");
assert(!!notice, "minimum-order notice renders when total is below $100");
assert(notice.textContent.includes("$98.00"), "notice states the correct remaining amount, got: " + notice.textContent);
assert(container3.querySelectorAll(".txcc-payment-btn").length === 0, "payment buttons hidden while below the minimum");

console.log(failed ? "\nSOME TESTS FAILED" : "\nALL TESTS PASSED");
process.exit(failed ? 1 : 0);
