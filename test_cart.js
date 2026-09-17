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

function loadIsolatedPage(relPath, url, initialCart) {
  const store = { txcc_cart_v1: JSON.stringify(initialCart) };
  const html = fs.readFileSync(path.join(SITE, relPath), "utf-8");
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const { window } = dom;
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k in store) delete store[k]; },
    },
    configurable: true,
  });
  window.eval(paymentConfigSrc);
  window.eval(cartJsSrc);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));
  return window;
}

// ---------- Place Order gate, tested in isolation: blocks below the
// minimum, and the info form never even shows until that's cleared ----------
let winGate = loadIsolatedPage("cart/index.html", "http://localhost:8787/cart/index.html", [
  { id: "999", variant: "", name: "Cheap Test Item", price: 2, image: "", qty: 1, minQty: 1 },
]);
let containerGate = winGate.document.getElementById("cart-page-content");
assert(!!containerGate.querySelector(".txcc-place-order-btn"), "Place Order button shows for a fresh cart with no checkout info yet");
assert(!containerGate.querySelector(".txcc-payment-btn"), "no payment methods render before Place Order is clicked");
assert(!containerGate.querySelector(".txcc-checkout-form"), "no info form shown yet before clicking Place Order");
containerGate.querySelector("[data-place-order]").dispatchEvent(new winGate.Event("click", { bubbles: true }));
containerGate = winGate.document.getElementById("cart-page-content");
const gateNotice = containerGate.querySelector(".txcc-min-order-notice");
assert(!!gateNotice, "clicking Place Order under the minimum pops the minimum-order notice instead of the form");
assert(gateNotice.textContent.includes("$100") && gateNotice.textContent.includes("$98.00"), "gate notice states the right amounts, got: " + gateNotice.textContent);
assert(!containerGate.querySelector(".txcc-checkout-form"), "the info form still does NOT show while under the minimum");
assert(!!containerGate.querySelector(".txcc-place-order-btn"), "Place Order button remains so they can try again");

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

// Quantity is free to pick per item now -- no per-item minimum is forced.
// The $100 order minimum is enforced once, for the whole cart, at Order Now.
const qtyInput = doc1.querySelector('input[name="qty[]"]');
assert(qtyInput.value === "1", "qty field is NOT auto-bumped on page load, defaults to whatever the page itself set, got: " + qtyInput.value);

const firstRadio = doc1.querySelector('input[name="attribute[175]"]');
firstRadio.checked = true;

const form = doc1.querySelector("form[data-cart-item-add]");
form.checkValidity = () => true;
form.reportValidity = () => true;
// pick 34 by hand (same as a customer typing a quantity in) so the rest of
// this suite still has a $100+ cart to exercise the payment-method flow
qtyInput.value = "34";
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

// ---------- Place Order gate: name/email/phone/shipping info is required
// before any payment method or Message Us / Call Us option even appears ----------
assert(!!cartContainer.querySelector(".txcc-place-order-btn"), "Place Order button shows before checkout info is collected");
assert(!cartContainer.querySelector(".txcc-payment-btn"), "no payment methods render before Place Order is clicked");
assert(!cartContainer.querySelector(".txcc-message-us-btn"), "no Message Us / Call Us buttons render before Place Order is clicked");
cartContainer.querySelector("[data-place-order]").dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");
assert(!cartContainer.querySelector(".txcc-min-order-notice"), "cart already meets the minimum, so Place Order goes straight to the form, no notice");

const checkoutForm = cartContainer.querySelector(".txcc-checkout-form");
assert(!!checkoutForm, "checkout info form appears after clicking Place Order");
["name", "email", "phone", "street", "city", "state", "zip"].forEach((field) => {
  const input = checkoutForm.querySelector('[name="' + field + '"]');
  assert(!!input && input.hasAttribute("required"), "checkout form has a required '" + field + "' field");
});

// submitting empty must not proceed -- required-field validation blocks it
checkoutForm.dispatchEvent(new win2.Event("submit", { bubbles: true, cancelable: true }));
cartContainer = doc2.getElementById("cart-page-content");
assert(!!cartContainer.querySelector(".txcc-checkout-form"), "submitting the checkout form empty does not proceed past it");

checkoutForm.querySelector('[name="name"]').value = "Jane Doe";
checkoutForm.querySelector('[name="email"]').value = "jane@example.com";
checkoutForm.querySelector('[name="phone"]').value = "555-123-4567";
checkoutForm.querySelector('[name="street"]').value = "123 Main St";
checkoutForm.querySelector('[name="city"]').value = "Wichita Falls";
checkoutForm.querySelector('[name="state"]').value = "TX";
checkoutForm.querySelector('[name="zip"]').value = "76308";
checkoutForm.dispatchEvent(new win2.Event("submit", { bubbles: true, cancelable: true }));
cartContainer = doc2.getElementById("cart-page-content");
assert(!cartContainer.querySelector(".txcc-checkout-form"), "checkout form is gone once a complete submit goes through");
assert(!cartContainer.querySelector(".txcc-place-order-btn"), "Place Order button is gone too -- info is now on file for this browser");

const methodBtns = cartContainer.querySelectorAll(".txcc-payment-btn");
assert(methodBtns.length === 4, "4 payment method buttons rendered on cart page, got " + methodBtns.length);
const labels = Array.from(methodBtns).map((b) => b.textContent.trim()).join(",");
assert(labels === "Bitcoin,Cash App,Chime,USDT (ERC20)", "payment method labels correct, got: " + labels);

// each button carries a real brand logo now
assert(Array.from(methodBtns).every((b) => !!b.querySelector(".txcc-payment-btn-logo")), "every payment button includes a logo image");

// select USDT: this only highlights the button and shows "Order Now" --
// the address must NOT appear until Order Now is actually clicked
const usdtBtn = Array.from(methodBtns).find((b) => b.textContent.trim() === "USDT (ERC20)");
usdtBtn.dispatchEvent(new win2.Event("click", { bubbles: true }));
let activeBtn = cartContainer.querySelector(".txcc-payment-btn--active");
assert(activeBtn && activeBtn.textContent.trim() === "USDT (ERC20)", "clicking USDT makes it active");
assert(!cartContainer.querySelector(".txcc-payment-detail"), "USDT address is NOT shown just from selecting the method");
let orderNowBtn = cartContainer.querySelector("[data-order-now]");
assert(!!orderNowBtn && orderNowBtn.getAttribute("data-order-now") === "usdt", "an Order Now button appears for the selected method instead");

// click Order Now -- now the address/instructions reveal
orderNowBtn.dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");
let detail = cartContainer.querySelector(".txcc-payment-detail");
assert(!!detail, "clicking Order Now reveals the payment detail section");
assert(detail.textContent.includes("0xf28d892f4c955bb26622486afb61660dda242ca0"), "USDT address shown after Order Now, got: " + detail.textContent);
assert(!cartContainer.querySelector("[data-order-now]"), "Order Now button is gone once details are revealed");
assert(detail.textContent.includes("Once paid, contact us"), "revealed detail includes the once-paid contact-us note, got: " + detail.textContent);

// switching to a different method hides the detail again until Order Now
// is clicked for that new method too
const chimeBtnForSwitch = Array.from(cartContainer.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Chime");
chimeBtnForSwitch.dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");
assert(!cartContainer.querySelector(".txcc-payment-detail"), "switching methods hides the previous method's revealed detail");
assert(!!cartContainer.querySelector("[data-order-now]"), "Order Now reappears for the newly-selected method");
// switch back to USDT and confirm again so the rest of this suite (which
// expects USDT's detail to be visible) continues to work unchanged
Array.from(cartContainer.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "USDT (ERC20)").dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");
cartContainer.querySelector("[data-order-now]").dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");

// force the "not configured yet" state (the shipped site now ships with
// real values, so blank them out here to exercise the placeholder path)
win2.PAYMENT_PROOF_EMAIL = "";
win2.PAYMENT_PROOF_PHONE = "";
Array.from(cartContainer.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "USDT (ERC20)").dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");

// "Message Us Now" / "Call or Text Us": hidden entirely with nothing configured
assert(!cartContainer.querySelector(".txcc-message-us-btn"), "Message Us Now / Call or Text buttons do not render before a proof email or phone is configured");

// payment-proof note + "i" button: disabled placeholder state (no email set yet)
let infoBtn = cartContainer.querySelector(".txcc-info-btn");
assert(!!infoBtn, "info button renders under the proof note");
assert(infoBtn.tagName === "SPAN" && infoBtn.classList.contains("txcc-info-btn--disabled"), "info button is disabled (a <span>, not a link) when no proof email is set yet");
assert(cartContainer.querySelector(".txcc-proof-note").textContent.includes("screenshot"), "proof note mentions sending a screenshot");

// simulate the real email + phone being set, then re-click USDT (click handler always re-renders)
win2.PAYMENT_PROOF_EMAIL = "orders@example.com";
win2.PAYMENT_PROOF_PHONE = "+1 (555) 010-2030";
Array.from(cartContainer.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "USDT (ERC20)").dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");
infoBtn = cartContainer.querySelector(".txcc-info-btn");
assert(infoBtn.tagName === "A", "info button becomes a real link once the proof email is set");
assert(infoBtn.getAttribute("href").startsWith("mailto:orders@example.com"), "info button links to the configured email, got: " + infoBtn.getAttribute("href"));
assert(decodeURIComponent(infoBtn.getAttribute("href")).includes("Jane Doe"), "info button's mailto body includes the collected checkout info, got: " + decodeURIComponent(infoBtn.getAttribute("href")));

// "Message Us Now" button: appears once a proof email is configured, and
// opens a mailto: link pre-filled with the cart contents
const messageUsBtns = cartContainer.querySelectorAll(".txcc-message-us-btn");
const messageUsBtn = messageUsBtns[0];
assert(messageUsBtns.length === 2, "both Message Us Now and Call or Text Us render once configured, got: " + messageUsBtns.length);
assert(!!messageUsBtn, "Message Us Now button renders once a proof email is configured");
assert(messageUsBtn.tagName === "A", "Message Us Now is a real link, got: " + (messageUsBtn && messageUsBtn.tagName));
const messageUsHref = decodeURIComponent(messageUsBtn.getAttribute("href") || "");
assert(messageUsHref.startsWith("mailto:orders@example.com"), "Message Us Now links to the configured proof email, got: " + messageUsHref);
assert(messageUsHref.includes("subject=Order inquiry"), "Message Us Now sets a subject line, got: " + messageUsHref);
assert(messageUsHref.includes("Packwraps"), "Message Us Now pre-fills the order body with the cart's item name, got: " + messageUsHref);
assert(/Total: \$\d+\.\d{2}/.test(messageUsHref), "Message Us Now pre-fills the order body with the cart total, got: " + messageUsHref);
assert(messageUsHref.includes("Jane Doe") && messageUsHref.includes("123 Main St"), "Message Us Now includes the checkout info collected at Place Order, got: " + messageUsHref);
assert(!!cartContainer.querySelector(".txcc-message-us-divider"), "a divider separates Message Us Now from the self-serve payment methods below it");

// "Call or Text Us" button: opens a tel: link built from the configured phone
const callBtn = messageUsBtns[1];
assert(callBtn.tagName === "A", "Call or Text Us is a real link, got: " + (callBtn && callBtn.tagName));
assert(callBtn.getAttribute("href") === "tel:+15550102030", "Call or Text Us links to the configured phone as a tel: link, got: " + callBtn.getAttribute("href"));
assert(callBtn.textContent.trim() === "Call or Text Us", "Call or Text Us button has the expected label, got: " + callBtn.textContent.trim());

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

// decrement is free to go all the way down to 1 now (no per-item minimum
// forced) -- only stops at 1, use Remove to drop the line item entirely
for (let i = 0; i < 3; i++) {
  cartContainer.querySelector('.txcc-qty-btn[data-action="dec"]').dispatchEvent(new win2.Event("click", { bubbles: true }));
}
cartContainer = doc2.getElementById("cart-page-content");
assert(cartContainer.querySelector(".txcc-qty-value").textContent.trim() === "31", "decrement freely reduces quantity (34 - 3 = 31), no per-item floor, got: " + cartContainer.querySelector(".txcc-qty-value").textContent.trim());

// Cash App: contactEmail placeholder (blanked here since the shipped site
// now ships with a real address), then simulate the real email being set
win2.PAYMENT_METHODS.find((m) => m.id === "cashapp").contactEmail = "";
const cashBtn = Array.from(cartContainer.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Cash App");
cashBtn.dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer.querySelector("[data-order-now]").dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");
assert(cartContainer.querySelector(".txcc-payment-detail").textContent.includes("coming soon"), "Cash App shows 'coming soon' placeholder with no email set");
win2.PAYMENT_METHODS.find((m) => m.id === "cashapp").contactEmail = "orders@example.com";
// re-selecting the SAME method it's already confirmed for keeps the detail
// visible (no Order Now button to click again) -- only *switching* methods
// hides it, which is already covered above
Array.from(cartContainer.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Cash App").dispatchEvent(new win2.Event("click", { bubbles: true }));
cartContainer = doc2.getElementById("cart-page-content");
assert(!cartContainer.querySelector("[data-order-now]"), "re-clicking an already-confirmed method doesn't hide its detail behind Order Now again");
const emailLink = cartContainer.querySelector(".txcc-payment-email-link");
assert(!!emailLink && emailLink.getAttribute("href").startsWith("mailto:orders@example.com"), "mailto link appears once contactEmail is set, got: " + (emailLink && emailLink.getAttribute("href")));
assert(decodeURIComponent(emailLink.getAttribute("href")).includes("Jane Doe"), "Cash App mailto body includes the collected checkout info, got: " + decodeURIComponent(emailLink.getAttribute("href")));

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

// ---------- minimum-order gate: enforced once, at Order Now, on the whole
// cart total -- not by hiding payment methods or forcing per-item quantity ----------
cartStore["txcc_cart_v1"] = JSON.stringify([
  { id: "999", variant: "", name: "Cheap Test Item", price: 2, image: "", qty: 1, minQty: 1 },
]);
let win3 = loadPage("cart/index.html", "http://localhost:8787/cart/index.html");
let doc3 = win3.document;
let container3 = doc3.getElementById("cart-page-content");
assert(container3.querySelectorAll(".txcc-payment-btn").length === 4, "payment methods are still selectable even while under the minimum, got " + container3.querySelectorAll(".txcc-payment-btn").length);
assert(!container3.querySelector(".txcc-min-order-notice"), "no minimum-order notice just from loading a below-threshold cart");

// select a method -- still no notice yet, just the Order Now button
const bitcoinBtn3 = Array.from(container3.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Bitcoin");
bitcoinBtn3.dispatchEvent(new win3.Event("click", { bubbles: true }));
container3 = doc3.getElementById("cart-page-content");
assert(!container3.querySelector(".txcc-min-order-notice"), "selecting a method under the minimum still doesn't show the notice yet");
assert(!!container3.querySelector("[data-order-now]"), "Order Now button is available even under the minimum");
assert(!container3.querySelector(".txcc-payment-detail"), "no address/instructions shown yet");

// click Order Now while under $100 -- THIS is what pops the message, and
// it must not reveal the address
container3.querySelector("[data-order-now]").dispatchEvent(new win3.Event("click", { bubbles: true }));
container3 = doc3.getElementById("cart-page-content");
const notice = container3.querySelector(".txcc-min-order-notice");
assert(!!notice, "clicking Order Now under the minimum pops a minimum-order message");
assert(notice.textContent.includes("$100") && notice.textContent.includes("$98.00"), "message states the $100+ minimum and correct remaining amount, got: " + notice.textContent);
assert(!container3.querySelector(".txcc-payment-detail"), "clicking Order Now under the minimum does NOT reveal the address");
assert(!!container3.querySelector("[data-order-now]"), "Order Now button remains so they can try again once the cart meets the minimum");

// add enough to clear $100, then Order Now actually confirms this time
cartStore["txcc_cart_v1"] = JSON.stringify([
  { id: "999", variant: "", name: "Cheap Test Item", price: 2, image: "", qty: 60, minQty: 1 },
]);
win3 = loadPage("cart/index.html", "http://localhost:8787/cart/index.html");
doc3 = win3.document;
container3 = doc3.getElementById("cart-page-content");
Array.from(container3.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Bitcoin").dispatchEvent(new win3.Event("click", { bubbles: true }));
container3.querySelector("[data-order-now]").dispatchEvent(new win3.Event("click", { bubbles: true }));
container3 = doc3.getElementById("cart-page-content");
assert(!container3.querySelector(".txcc-min-order-notice"), "no minimum-order message once the cart actually meets $100");
assert(!!container3.querySelector(".txcc-payment-detail"), "Order Now reveals payment details once the cart meets the minimum");

// ---------- Shipping fee: pay a flat fee instead of adding more items ----------
let winShip = loadIsolatedPage("cart/index.html", "http://localhost:8787/cart/index.html", [
  { id: "888", variant: "", name: "Shipping Test Item", price: 80, image: "", qty: 1, minQty: 1 },
]);
let containerShip = winShip.document.getElementById("cart-page-content");
containerShip.querySelector("[data-place-order]").dispatchEvent(new winShip.Event("click", { bubbles: true }));
containerShip = winShip.document.getElementById("cart-page-content");
const shipNotice = containerShip.querySelector(".txcc-min-order-notice");
assert(!!shipNotice, "under the minimum, Place Order shows the choice notice instead of the form");
assert(shipNotice.textContent.includes("$20.00") && shipNotice.textContent.includes("$20.00 more"), "notice mentions both the shipping fee and how much more is needed, got: " + shipNotice.textContent);
assert(!!containerShip.querySelector("[data-add-shipping]"), "an 'Add Shipping & Continue' button is offered");
assert(!!containerShip.querySelector('a[href="/all-products/"]'), "a Continue Shopping link is offered as the add-more-items alternative");
assert(!containerShip.querySelector(".txcc-checkout-form"), "the info form still doesn't show until a choice is made");

containerShip.querySelector("[data-add-shipping]").dispatchEvent(new winShip.Event("click", { bubbles: true }));
containerShip = winShip.document.getElementById("cart-page-content");
const shipForm = containerShip.querySelector(".txcc-checkout-form");
assert(!!shipForm, "clicking Add Shipping & Continue goes straight to the info form");

shipForm.querySelector('[name="name"]').value = "Sam Shipper";
shipForm.querySelector('[name="email"]').value = "sam@example.com";
shipForm.querySelector('[name="phone"]').value = "555-999-0000";
shipForm.querySelector('[name="street"]').value = "1 Ship Ln";
shipForm.querySelector('[name="city"]').value = "Austin";
shipForm.querySelector('[name="state"]').value = "TX";
shipForm.querySelector('[name="zip"]').value = "73301";
shipForm.dispatchEvent(new winShip.Event("submit", { bubbles: true, cancelable: true }));
containerShip = winShip.document.getElementById("cart-page-content");
assert(!containerShip.querySelector(".txcc-checkout-form"), "form is gone after submitting with the shipping choice made");

const shipTotalsText = containerShip.textContent.replace(/\s+/g, " ");
assert(shipTotalsText.includes("Subtotal:") && shipTotalsText.includes("Shipping:"), "cart total area shows a subtotal/shipping breakdown once the fee is applied, got: " + shipTotalsText.slice(0, 200));
assert(/Total:\s*\$100\.00/.test(shipTotalsText), "grand total is $80 subtotal + $20 shipping = $100.00, got: " + shipTotalsText.slice(0, 200));

assert(containerShip.querySelectorAll(".txcc-payment-btn").length === 4, "payment methods render immediately, no further block, once shipping is applied");
const shipMessageBtn = containerShip.querySelector(".txcc-message-us-btn");
const shipMailHref = decodeURIComponent(shipMessageBtn.getAttribute("href"));
assert(shipMailHref.includes("Shipping: $20.00") && shipMailHref.includes("Total: $100.00"), "Message Us Now mailto includes the shipping line and the correct grand total, got: " + shipMailHref);

const shipBitcoinBtn = Array.from(containerShip.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Bitcoin");
shipBitcoinBtn.dispatchEvent(new winShip.Event("click", { bubbles: true }));
containerShip = winShip.document.getElementById("cart-page-content");
assert(!containerShip.querySelector(".txcc-min-order-notice"), "no minimum-order notice once the shipping fee is already on file");
containerShip.querySelector("[data-order-now]").dispatchEvent(new winShip.Event("click", { bubbles: true }));
containerShip = winShip.document.getElementById("cart-page-content");
const shipDetail = containerShip.querySelector(".txcc-payment-detail");
assert(!!shipDetail, "Order Now confirms immediately -- no minimum block -- once the shipping fee is on file");
assert(shipDetail.textContent.includes("$20.00 shipping") && shipDetail.textContent.includes("$100.00"), "payment detail shows the order total including shipping, got: " + shipDetail.textContent);

// ---------- fallback: cart shrinks below the minimum AFTER checkout info
// was already saved without a shipping fee -- Order Now offers the same
// shipping-fee option, and taking it confirms immediately ----------
let winShrink = loadIsolatedPage("cart/index.html", "http://localhost:8787/cart/index.html", [
  { id: "777", variant: "", name: "Shrink Test Item", price: 60, image: "", qty: 2, minQty: 1 },
]);
let containerShrink = winShrink.document.getElementById("cart-page-content");
containerShrink.querySelector("[data-place-order]").dispatchEvent(new winShrink.Event("click", { bubbles: true }));
containerShrink = winShrink.document.getElementById("cart-page-content");
const shrinkForm = containerShrink.querySelector(".txcc-checkout-form");
assert(!!shrinkForm, "cart starts at $120 (meets the minimum), so Place Order goes straight to the form");
shrinkForm.querySelector('[name="name"]').value = "Shrinky Dev";
shrinkForm.querySelector('[name="email"]').value = "shrink@example.com";
shrinkForm.querySelector('[name="phone"]').value = "555-111-2222";
shrinkForm.querySelector('[name="street"]').value = "2 Shrink Rd";
shrinkForm.querySelector('[name="city"]').value = "Dallas";
shrinkForm.querySelector('[name="state"]').value = "TX";
shrinkForm.querySelector('[name="zip"]').value = "75201";
shrinkForm.dispatchEvent(new winShrink.Event("submit", { bubbles: true, cancelable: true }));
containerShrink = winShrink.document.getElementById("cart-page-content");
assert(containerShrink.querySelectorAll(".txcc-payment-btn").length === 4, "payment methods render normally -- the cart met the minimum with no shipping fee needed");

// shrink the cart from $120 to $60 (qty 2 -> 1 at $60 each)
containerShrink.querySelector('.txcc-qty-btn[data-action="dec"]').dispatchEvent(new winShrink.Event("click", { bubbles: true }));
containerShrink = winShrink.document.getElementById("cart-page-content");
assert(containerShrink.textContent.includes("$60.00"), "cart total dropped to $60 after decrementing, got: " + containerShrink.textContent.replace(/\s+/g, " ").slice(0, 200));

const shrinkBitcoinBtn = Array.from(containerShrink.querySelectorAll(".txcc-payment-btn")).find((b) => b.textContent.trim() === "Bitcoin");
shrinkBitcoinBtn.dispatchEvent(new winShrink.Event("click", { bubbles: true }));
containerShrink = winShrink.document.getElementById("cart-page-content");
containerShrink.querySelector("[data-order-now]").dispatchEvent(new winShrink.Event("click", { bubbles: true }));
containerShrink = winShrink.document.getElementById("cart-page-content");
assert(!!containerShrink.querySelector(".txcc-min-order-notice"), "Order Now on the now-under-minimum cart pops the notice again (no shipping fee on file yet)");
const applyShippingBtn = containerShrink.querySelector("[data-apply-shipping-now]");
assert(!!applyShippingBtn, "a recovery 'Add Shipping & Place Order' button is offered right here too");
applyShippingBtn.dispatchEvent(new winShrink.Event("click", { bubbles: true }));
containerShrink = winShrink.document.getElementById("cart-page-content");
const shrinkDetail = containerShrink.querySelector(".txcc-payment-detail");
assert(!!shrinkDetail, "clicking it confirms the order immediately, no extra Order Now click needed");
assert(shrinkDetail.textContent.includes("$20.00 shipping") && shrinkDetail.textContent.includes("$80.00"), "payment detail shows $60 + $20 shipping = $80.00, got: " + shrinkDetail.textContent);

console.log(failed ? "\nSOME TESTS FAILED" : "\nALL TESTS PASSED");
process.exit(failed ? 1 : 0);
