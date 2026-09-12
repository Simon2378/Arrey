const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SITE = "C:/Users/ESEMBE SIMON/Desktop/Arrey/public-site";

let failed = false;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed = true;
  } else {
    console.log("PASS:", msg);
  }
}

function b64EncodeUnicode(str) {
  return Buffer.from(str, "utf-8").toString("base64");
}
function b64DecodeUnicode(str) {
  return Buffer.from(str, "base64").toString("utf-8");
}

// ============================================================
// Part 1: admin.js -- login, add product, delete product
// (all GitHub API calls mocked; nothing here touches the real network)
// ============================================================

function loadAdminPage(cartStore) {
  const html = fs.readFileSync(path.join(SITE, "admin", "index.html"), "utf-8");
  const dom = new JSDOM(html, { url: "http://localhost:8787/admin/", runScripts: "outside-only" });
  const { window } = dom;
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(cartStore, k) ? cartStore[k] : null),
      setItem: (k, v) => { cartStore[k] = String(v); },
      removeItem: (k) => { delete cartStore[k]; },
    },
    configurable: true,
  });
  window.eval(fs.readFileSync(path.join(SITE, "admin.js"), "utf-8"));
  return window;
}

(async function testAdminFlow() {
  let store = {};
  let serverProducts = [];
  let serverSha = "sha-0";
  const putCalls = [];

  function mockFetch(url, opts) {
    opts = opts || {};
    // 1. token verification
    if (url === "https://api.github.com/repos/Simon2378/Arrey" && (!opts.method || opts.method === "GET")) {
      const token = opts.headers.Authorization;
      if (token !== "Bearer good-token") {
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ message: "Bad credentials" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ permissions: { push: true } }) });
    }
    // 2. GET products.json
    if (url.indexOf("contents/public-site/products.json") !== -1 && (!opts.method || opts.method === "GET")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ content: b64EncodeUnicode(JSON.stringify(serverProducts)), sha: serverSha }),
      });
    }
    // 3. PUT products.json (save)
    if (url.indexOf("contents/public-site/products.json") !== -1 && opts.method === "PUT") {
      const body = JSON.parse(opts.body);
      putCalls.push(body);
      serverProducts = JSON.parse(b64DecodeUnicode(body.content));
      serverSha = "sha-" + putCalls.length;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ commit: { sha: serverSha } }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ message: "not mocked: " + url }) });
  }

  let win = loadAdminPage(store);
  win.fetch = mockFetch;
  // jsdom fires its own real (async) DOMContentLoaded once parsing completes,
  // separate from anything dispatched manually -- waiting for that single
  // natural firing (rather than also dispatching one ourselves) avoids
  // double-invoking handlers that aren't all idempotent (e.g. injecting DOM
  // content twice). See product-display.js tests below for where that
  // actually broke a result, not just wasted work.
  await new Promise((r) => setTimeout(r, 30));

  const loginInput = win.document.getElementById("admin-token-input");
  assert(!!loginInput, "login screen renders with a token input");

  // wrong token -> error shown, stays on login screen
  loginInput.value = "wrong-token";
  win.document.getElementById("admin-login-btn").dispatchEvent(new win.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  let statusEl = win.document.getElementById("admin-login-status");
  assert(statusEl && statusEl.textContent.indexOf("Bad credentials") !== -1, "wrong token shows the real error message, got: " + (statusEl && statusEl.textContent));

  // correct token -> dashboard renders
  win.document.getElementById("admin-token-input").value = "good-token";
  win.document.getElementById("admin-login-btn").dispatchEvent(new win.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert(!!win.document.getElementById("admin-add-form"), "dashboard renders after a valid token");
  assert(store["txcc_admin_token"] === "good-token", "token is persisted to localStorage after successful login");

  // add a product (no image)
  win.document.getElementById("admin-name").value = "Test Shatter 1g";
  win.document.getElementById("admin-price").value = "19.99";
  win.document.getElementById("admin-category").value = "concentrates/shatter";
  win.document.getElementById("admin-description").value = "A test product.";
  win.document.getElementById("admin-add-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 30));

  assert(putCalls.length === 1, "submitting the add form makes exactly one PUT call, got " + putCalls.length);
  assert(serverProducts.length === 1, "server-side product list now has 1 product");
  assert(serverProducts[0].name === "Test Shatter 1g", "saved product has the right name, got: " + (serverProducts[0] && serverProducts[0].name));
  assert(serverProducts[0].price === 19.99, "saved product has the right price, got: " + (serverProducts[0] && serverProducts[0].price));
  assert(serverProducts[0].category === "concentrates/shatter", "saved product has the right category");
  assert(/^admin-\d+$/.test(serverProducts[0].id), "saved product has a generated admin- id, got: " + (serverProducts[0] && serverProducts[0].id));
  assert(putCalls[0].sha === "sha-0", "PUT includes the sha it originally read (optimistic concurrency), got: " + putCalls[0].sha);

  // dashboard re-renders showing the new product
  await new Promise((r) => setTimeout(r, 1300));
  const rows = win.document.querySelectorAll(".txcc-admin-row");
  assert(rows.length === 1, "dashboard lists the 1 saved product after re-render, got " + rows.length);
  assert(rows[0].textContent.indexOf("Test Shatter 1g") !== -1, "listed row shows the product name");

  // delete it
  const deleteBtn = win.document.querySelector(".txcc-admin-delete-btn");
  assert(!!deleteBtn, "delete button present on the row");
  win.confirm = () => true; // simulate the user confirming the delete prompt
  deleteBtn.dispatchEvent(new win.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  assert(putCalls.length === 2, "delete makes a second PUT call");
  assert(serverProducts.length === 0, "server-side product list is empty after delete");

  // logout clears the token and returns to login
  await new Promise((r) => setTimeout(r, 30));
  const logoutBtn = win.document.getElementById("admin-logout-btn");
  logoutBtn.dispatchEvent(new win.Event("click", { bubbles: true }));
  assert(store["txcc_admin_token"] === undefined, "logout clears the stored token");
  assert(!!win.document.getElementById("admin-token-input"), "logout returns to the login screen");

  // ============================================================
  // Part 2: product-display.js -- listing injection + product detail page
  // ============================================================

  const products = [
    { id: "admin-1", name: "Test Shatter 1g", price: 19.99, category: "concentrates/shatter", description: "desc A", image: "" },
    { id: "admin-2", name: "Test Gummies", price: 9.5, category: "edibles-gummies/mushroom-edibles", description: "desc B", image: "" },
  ];

  function mockProductsFetch(url) {
    if (url === "/products.json") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(products) });
    }
    return Promise.resolve({ ok: false });
  }

  // 2a. an already-empty category page (uses #product-listing-container)
  const emptyPageHtml =
    '<html><body><div id="product-listing-container"><p>There are no products listed under this category.</p></div>' +
    '<script src="../product-display.js"></script></body></html>';
  let dom = new JSDOM(emptyPageHtml, { url: "http://localhost:8787/concentrates/shatter/", runScripts: "outside-only" });
  dom.window.fetch = mockProductsFetch;
  dom.window.eval(fs.readFileSync(path.join(SITE, "product-display.js"), "utf-8"));
  // rely on jsdom's own natural DOMContentLoaded firing (async, shortly
  // after eval registers the listener) rather than also dispatching one
  // ourselves -- injectIntoListing() isn't idempotent, so a double-fire
  // here doubles up the injected cards instead of just doing harmless
  // redundant work.
  await new Promise((r) => setTimeout(r, 30));

  let cards = dom.window.document.querySelectorAll(".product");
  assert(cards.length === 1, "empty category page gets exactly the 1 matching admin product injected, got " + cards.length);
  assert(dom.window.document.body.textContent.indexOf("Test Shatter 1g") !== -1, "injected card shows the matching product's name");
  assert(dom.window.document.body.textContent.indexOf("Test Gummies") === -1, "non-matching category's product is NOT injected here");

  // 2a2. the top-level parent page ("concentrates") should show every
  // product from ALL of its subcategories (e.g. concentrates/shatter),
  // not just ones exactly categorized as the bare parent
  const parentPageHtml =
    '<html><body><div id="product-listing-container"><p>There are no products listed under this category.</p></div>' +
    '<script src="../product-display.js"></script></body></html>';
  let parentDom = new JSDOM(parentPageHtml, { url: "http://localhost:8787/concentrates/", runScripts: "outside-only" });
  parentDom.window.fetch = mockProductsFetch;
  parentDom.window.eval(fs.readFileSync(path.join(SITE, "product-display.js"), "utf-8"));
  await new Promise((r) => setTimeout(r, 30));

  const parentCards = parentDom.window.document.querySelectorAll(".product");
  assert(parentCards.length === 1, "parent /concentrates/ page shows the subcategory product, got " + parentCards.length);
  assert(parentDom.window.document.body.textContent.indexOf("Test Shatter 1g") !== -1, "parent page shows the concentrates/shatter product");
  assert(parentDom.window.document.body.textContent.indexOf("Test Gummies") === -1, "parent /concentrates/ page still excludes an unrelated category's product");

  // 2a3. real in-site navigation lands on a literal .../index.html URL (this
  // is a static export, every link points at the actual file, not a clean
  // directory URL) -- the slug detection has to strip that filename or it
  // reads the path as "concentrates/index.html" and matches nothing
  const indexHtmlPageHtml =
    '<html><body><div id="product-listing-container"><p>There are no products listed under this category.</p></div>' +
    '<script src="../product-display.js"></script></body></html>';
  let indexHtmlDom = new JSDOM(indexHtmlPageHtml, { url: "http://localhost:8787/concentrates/index.html", runScripts: "outside-only" });
  indexHtmlDom.window.fetch = mockProductsFetch;
  indexHtmlDom.window.eval(fs.readFileSync(path.join(SITE, "product-display.js"), "utf-8"));
  await new Promise((r) => setTimeout(r, 30));

  const indexHtmlCards = indexHtmlDom.window.document.querySelectorAll(".product");
  assert(indexHtmlCards.length === 1, "literal /concentrates/index.html URL still matches the concentrates/shatter product, got " + indexHtmlCards.length);

  // 2b. all-products page shows every admin product regardless of category
  const allProductsHtml =
    '<html><body><ul class="productGrid"><li class="product">existing scraped item</li></ul>' +
    '<script src="../product-display.js"></script></body></html>';
  dom = new JSDOM(allProductsHtml, { url: "http://localhost:8787/all-products/", runScripts: "outside-only" });
  dom.window.fetch = mockProductsFetch;
  dom.window.eval(fs.readFileSync(path.join(SITE, "product-display.js"), "utf-8"));
  // rely on jsdom's own natural DOMContentLoaded firing (async, shortly
  // after eval registers the listener) rather than also dispatching one
  // ourselves -- injectIntoListing() isn't idempotent, so a double-fire
  // here doubles up the injected cards instead of just doing harmless
  // redundant work.
  await new Promise((r) => setTimeout(r, 30));

  cards = dom.window.document.querySelectorAll("ul.productGrid > li");
  assert(cards.length === 3, "/all-products/ shows the 1 existing scraped item plus both admin products (3 total), got " + cards.length);

  // 2c. product detail page
  const detailHtml = '<html><body><div id="product-detail-content"></div><script src="../product-display.js"></script></body></html>';
  dom = new JSDOM(detailHtml, { url: "http://localhost:8787/p/?id=admin-2", runScripts: "outside-only" });
  dom.window.fetch = mockProductsFetch;
  let addedItem = null;
  dom.window.TxccCart = {
    addToCart: (item) => { addedItem = item; },
    minQtyForPrice: (price) => Math.max(1, Math.ceil(100 / price)),
    money: (n) => "$" + n.toFixed(2),
  };
  dom.window.eval(fs.readFileSync(path.join(SITE, "product-display.js"), "utf-8"));
  // rely on jsdom's own natural DOMContentLoaded firing (async, shortly
  // after eval registers the listener) rather than also dispatching one
  // ourselves -- injectIntoListing() isn't idempotent, so a double-fire
  // here doubles up the injected cards instead of just doing harmless
  // redundant work.
  await new Promise((r) => setTimeout(r, 30));

  assert(dom.window.document.title.indexOf("Test Gummies") === 0, "product detail page sets the document title, got: " + dom.window.document.title);
  assert(dom.window.document.body.textContent.indexOf("$9.50") !== -1, "product detail page shows the price");
  assert(dom.window.document.body.textContent.indexOf("desc B") !== -1, "product detail page shows the description");

  const qtyInput = dom.window.document.getElementById("txcc-pd-qty");
  assert(qtyInput.value === "1", "quantity defaults to 1 on the detail page");
  const addBtn = dom.window.document.getElementById("txcc-pd-add");
  addBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  assert(!!addedItem, "clicking Add to Cart calls TxccCart.addToCart");
  assert(addedItem.id === "admin-2" && addedItem.qty === 11, "add-to-cart item has right id and qty bumped to minQty (ceil(100/9.5)=11), got: " + JSON.stringify(addedItem));

  console.log(failed ? "\nSOME TESTS FAILED" : "\nALL TESTS PASSED");
  process.exit(failed ? 1 : 0);
})();
