// Client-side cart for the static export. There is no backend (BigCommerce's
// real cart.php isn't reachable from here), so this stores the cart in the
// browser's localStorage. The cart icon in the header is a plain link to
// /cart/ -- a dedicated page (built at public-site/cart/index.html) that
// renders the full cart into #cart-page-content. No dropdown: a small
// anchored panel doesn't work well on mobile, so every device just
// navigates to the cart page like a normal link.
(function () {
  "use strict";

  var CART_KEY = "txcc_cart_v1";

  function loadCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveCart(items) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch (e) {
      /* storage unavailable (private browsing etc.) -- cart just won't persist */
    }
    renderBadge(items);
  }

  function cartCount(items) {
    return items.reduce(function (sum, i) { return sum + i.qty; }, 0);
  }

  function cartTotal(items) {
    return items.reduce(function (sum, i) { return sum + i.qty * i.price; }, 0);
  }

  function minOrderTotal() {
    return typeof window.MINIMUM_ORDER_TOTAL === "number" ? window.MINIMUM_ORDER_TOTAL : 100;
  }

  // Minimum quantity so a single line item's own total reaches the minimum
  // order amount on its own (e.g. a $2 item needs 50 units to reach $100).
  function minQtyForPrice(price) {
    if (!price || price <= 0) return 1;
    return Math.max(1, Math.ceil(minOrderTotal() / price));
  }

  function money(n) {
    return "$" + n.toFixed(2);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var badgeObserver = null;

  // The original theme JS also tries to sync this same .cart-quantity badge
  // from a live cart-count API call that has nothing to reach here, and
  // overwrites it with a hardcoded "0" once that (failing) call resolves --
  // happens fast enough that even an immediate post-render check can catch
  // the correct value only to have it clobbered moments later. Rather than
  // guess at timing, watch the element and re-assert our own value whenever
  // anything else changes it (same approach as keepAddToCartEnabled below).
  function renderBadge(items) {
    var pill = document.querySelector(".cart-quantity");
    if (!pill) return;
    var count = cartCount(items);
    pill.textContent = count > 0 ? String(count) : "";
    pill.classList.toggle("countPill--positive", count > 0);

    if (!badgeObserver) {
      badgeObserver = new MutationObserver(function () {
        var currentCount = cartCount(loadCart());
        var expectedText = currentCount > 0 ? String(currentCount) : "";
        var expectedPositive = currentCount > 0;
        if (pill.textContent === expectedText && pill.classList.contains("countPill--positive") === expectedPositive) {
          return; // already correct -- this mutation was our own last correction
        }
        badgeObserver.disconnect();
        pill.textContent = expectedText;
        pill.classList.toggle("countPill--positive", expectedPositive);
        badgeObserver.observe(pill, { childList: true, characterData: true, subtree: true });
      });
      badgeObserver.observe(pill, { childList: true, characterData: true, subtree: true });
    }
  }

  function getCartPageContainer() {
    return document.getElementById("cart-page-content");
  }

  function showToast(message) {
    var existing = document.querySelector(".txcc-toast");
    if (existing) existing.remove();

    var toast = document.createElement("div");
    toast.className = "txcc-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    // force layout so the transition actually runs
    void toast.offsetWidth;
    toast.classList.add("txcc-toast--visible");

    setTimeout(function () {
      toast.classList.remove("txcc-toast--visible");
      setTimeout(function () { toast.remove(); }, 300);
    }, 2200);
  }

  function addToCart(item) {
    var items = loadCart();
    var existing = items.filter(function (i) {
      return i.id === item.id && i.variant === item.variant;
    })[0];
    if (existing) {
      existing.qty += item.qty;
    } else {
      items.push(item);
    }
    saveCart(items);
    renderCart();
    showToast("Added to cart: " + item.name + (item.variant ? " (" + item.variant + ")" : ""));
  }

  function removeFromCart(id, variant) {
    var items = loadCart().filter(function (i) {
      return !(i.id === id && i.variant === variant);
    });
    saveCart(items);
    renderCart();
  }

  function changeQty(id, variant, delta) {
    var items = loadCart();
    var item = items.filter(function (i) {
      return i.id === id && i.variant === variant;
    })[0];
    if (!item) return;

    // Don't let the decrement button quietly undercut the per-item minimum
    // that was enforced when it was added -- use Remove to drop it entirely.
    var floor = item.minQty || 1;
    if (delta < 0 && item.qty <= floor) return;

    item.qty += delta;
    if (item.qty <= 0) {
      items = items.filter(function (i) { return i !== item; });
    }
    saveCart(items);
    renderCart();
  }

  // There's no automated order confirmation on a static site -- this note
  // (shown under whichever payment method is selected) is how an order
  // actually gets completed: the customer emails proof of payment. The "i"
  // button opens the customer's mail client directly (mailto:) rather than
  // making them find/click the email address itself.
  function renderProofNote() {
    var email = window.PAYMENT_PROOF_EMAIL;
    var button = email
      ? '<a class="txcc-info-btn" href="mailto:' + escapeHtml(email) + "?subject=" + encodeURIComponent("Payment confirmation - order screenshot") + '" aria-label="Email us your payment screenshot" title="Email us your payment screenshot">i</a>'
      : '<span class="txcc-info-btn txcc-info-btn--disabled" aria-label="Email coming soon" title="Email coming soon">i</span>';

    return (
      '<div class="txcc-proof-note">' +
        "<div>Send us a screenshot of your payment to complete your order.</div>" +
        button +
      "</div>"
    );
  }

  function renderCart() {
    var container = getCartPageContainer();
    if (!container) return; // not on the cart page -- nothing to render into

    var items = loadCart();
    var methods = window.PAYMENT_METHODS || [];
    var selected = container.getAttribute("data-selected-method") || (methods[0] && methods[0].id) || "";

    if (items.length === 0) {
      container.innerHTML = '<div class="txcc-cart-empty">Your cart is empty. <a href="/all-products/">Continue shopping</a></div>';
      return;
    }

    var rows = items.map(function (item) {
      return (
        '<div class="txcc-cart-row" data-id="' + escapeHtml(item.id) + '" data-variant="' + escapeHtml(item.variant) + '">' +
          '<img class="txcc-cart-row-img" src="' + escapeHtml(item.image) + '" alt="">' +
          '<div class="txcc-cart-row-body">' +
            '<div class="txcc-cart-row-name">' + escapeHtml(item.name) + '</div>' +
            (item.variant ? '<div class="txcc-cart-row-variant">' + escapeHtml(item.variant) + '</div>' : '') +
            '<div class="txcc-cart-row-controls">' +
              '<button type="button" class="txcc-qty-btn" data-action="dec" aria-label="Decrease quantity">−</button>' +
              '<span class="txcc-qty-value">' + item.qty + '</span>' +
              '<button type="button" class="txcc-qty-btn" data-action="inc" aria-label="Increase quantity">+</button>' +
              '<button type="button" class="txcc-remove-btn" data-action="remove">Remove</button>' +
            '</div>' +
          '</div>' +
          '<div class="txcc-cart-row-price">' + money(item.price * item.qty) + '</div>' +
        '</div>'
      );
    }).join("");

    var total = cartTotal(items);
    var minTotal = minOrderTotal();
    var meetsMinimum = total >= minTotal;

    var paymentSection;
    if (!meetsMinimum) {
      var remaining = minTotal - total;
      paymentSection =
        '<div class="txcc-min-order-notice">' +
          "Minimum order is " + money(minTotal) + ". Add " + money(remaining) + " more to choose a payment method." +
        "</div>";
    } else {
      var methodButtons = methods.map(function (m) {
        var active = m.id === selected ? " txcc-payment-btn--active" : "";
        return '<button type="button" class="txcc-payment-btn txcc-payment-btn--' + m.id + active + '" data-method="' + m.id + '">' + escapeHtml(m.label) + "</button>";
      }).join("");

      var activeMethod = methods.filter(function (m) { return m.id === selected; })[0];
      var methodDetail = "";
      if (activeMethod) {
        methodDetail = '<div class="txcc-payment-detail">';
        if (Object.prototype.hasOwnProperty.call(activeMethod, "contactEmail")) {
          if (activeMethod.contactEmail) {
            var subject = encodeURIComponent("Order inquiry - " + activeMethod.label);
            methodDetail +=
              '<a class="txcc-payment-email-link" href="mailto:' + escapeHtml(activeMethod.contactEmail) + "?subject=" + subject + '">' +
              "Email us to pay with " + escapeHtml(activeMethod.label) +
              "</a>";
          } else {
            methodDetail += "<div>Email contact coming soon. Contact us to complete your order.</div>";
          }
        } else {
          if (activeMethod.address) {
            methodDetail +=
              '<div class="txcc-payment-address-row">' +
                '<span class="txcc-payment-address">' + escapeHtml(activeMethod.address) + "</span>" +
                '<button type="button" class="txcc-copy-btn" data-copy-address="' + escapeHtml(activeMethod.address) + '">Copy</button>' +
              "</div>";
          }
          methodDetail += "<div>" + escapeHtml(activeMethod.instructions || "") + "</div>";
        }
        methodDetail += "</div>";
      }

      paymentSection =
        '<div class="txcc-payment-label">Pay with</div>' +
        '<div class="txcc-payment-buttons">' + methodButtons + "</div>" +
        methodDetail +
        (activeMethod ? renderProofNote() : "");
    }

    container.innerHTML =
      '<div class="txcc-cart-page">' +
        '<div class="txcc-cart-items">' + rows + "</div>" +
        '<div class="txcc-cart-total">Total: <strong>' + money(total) + "</strong></div>" +
        '<div class="txcc-payment-methods">' + paymentSection + "</div>" +
      "</div>";

    container.setAttribute("data-selected-method", selected);
  }

  function collectVariant(form) {
    var labels = [];
    var groups = {};
    var controls = form.querySelectorAll("[data-product-attribute] input, [data-product-attribute] select");
    controls.forEach(function (el) {
      groups[el.name] = groups[el.name] || [];
      groups[el.name].push(el);
    });
    Object.keys(groups).forEach(function (name) {
      var els = groups[name];
      var chosen = els.filter(function (el) {
        return (el.type === "radio" || el.type === "checkbox") ? el.checked : true;
      })[0];
      if (!chosen) return;
      if (chosen.tagName === "SELECT") {
        var opt = chosen.options[chosen.selectedIndex];
        if (opt && opt.value) labels.push(opt.textContent.trim());
      } else if (chosen.checked) {
        var lbl = form.querySelector('label[for="' + chosen.id + '"] .form-option-variant');
        labels.push(lbl ? lbl.textContent.trim() : chosen.value);
      }
    });
    return labels.join(", ");
  }

  function handleAddToCartSubmit(event) {
    var form = event.target;
    if (!form.matches("form[data-cart-item-add]")) return;
    event.preventDefault();

    if (form.checkValidity && !form.checkValidity()) {
      form.reportValidity();
      return;
    }

    var idInput = form.querySelector('input[name="product_id"]');
    var qtyInput = form.querySelector('input[name="qty[]"], input[name="qty"]');
    var section = form.closest(".productView") || document;
    var titleEl = section.querySelector(".productView-title") || document.querySelector(".productView-title");
    var priceEl = section.querySelector(".productView-price [data-product-price-without-tax]");
    var imgEl = document.querySelector("[data-image-gallery-main] img");

    var id = idInput ? idInput.value : "unknown";
    var qty = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;
    var name = titleEl ? titleEl.textContent.trim() : document.title;
    var priceText = priceEl ? priceEl.textContent.replace(/[^0-9.]/g, "") : "0";
    var price = parseFloat(priceText) || 0;
    var image = imgEl ? imgEl.getAttribute("src") : "";
    var variant = collectVariant(form);

    var minQty = minQtyForPrice(price);
    if (qty < minQty) {
      qty = minQty;
      if (qtyInput) qtyInput.value = String(minQty);
    }

    addToCart({ id: id, variant: variant, name: name, price: price, image: image, qty: qty, minQty: minQty });
  }

  // Pre-fill each product page's quantity field with the minimum needed to
  // reach the minimum order total on that item alone, so cheap items don't
  // let someone order e.g. a single $2 item by itself.
  function applyMinQtyToProductPages() {
    document.querySelectorAll("form[data-cart-item-add]").forEach(function (form) {
      var qtyInput = form.querySelector('input[name="qty[]"], input[name="qty"]');
      if (!qtyInput) return;
      var section = form.closest(".productView") || document;
      var priceEl = section.querySelector(".productView-price [data-product-price-without-tax]");
      if (!priceEl) return;
      var price = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, "")) || 0;
      var minQty = minQtyForPrice(price);
      qtyInput.min = String(minQty);
      var current = parseInt(qtyInput.value, 10) || 1;
      if (current < minQty) qtyInput.value = String(minQty);
    });
  }

  function handleCartActionClick(event) {
    var container = getCartPageContainer();
    if (!container) return;

    var actionBtn = event.target.closest("[data-action]");
    if (actionBtn && container.contains(actionBtn)) {
      var row = actionBtn.closest(".txcc-cart-row");
      if (!row) return;
      var id = row.getAttribute("data-id");
      var variant = row.getAttribute("data-variant");
      var action = actionBtn.getAttribute("data-action");
      if (action === "inc") changeQty(id, variant, 1);
      else if (action === "dec") changeQty(id, variant, -1);
      else if (action === "remove") removeFromCart(id, variant);
      return;
    }

    var methodBtn = event.target.closest(".txcc-payment-btn");
    if (methodBtn && container.contains(methodBtn)) {
      container.setAttribute("data-selected-method", methodBtn.getAttribute("data-method"));
      renderCart();
      return;
    }

    var copyBtn = event.target.closest("[data-copy-address]");
    if (copyBtn && container.contains(copyBtn)) {
      var address = copyBtn.getAttribute("data-copy-address");
      copyToClipboard(address, copyBtn);
    }
  }

  function copyToClipboard(text, btn) {
    function showCopied() {
      var original = btn.textContent;
      btn.textContent = "Copied!";
      btn.classList.add("txcc-copy-btn--done");
      setTimeout(function () {
        btn.textContent = original;
        btn.classList.remove("txcc-copy-btn--done");
      }, 1500);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied, function () {
        fallbackCopy(text);
        showCopied();
      });
    } else {
      fallbackCopy(text);
      showCopied();
    }
  }

  function fallbackCopy(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      /* clipboard unavailable -- address is still visible to select manually */
    }
    document.body.removeChild(textarea);
  }

  // The original BigCommerce theme JS (theme-bundle.main.js, still loaded from
  // the live CDN) disables the Add to Cart button pending a live stock/price
  // check API call. That call has nothing to reach on a static export, so the
  // button never gets re-enabled. Force it back on, and keep forcing it in
  // case the theme JS disables it again after we do.
  function keepAddToCartEnabled() {
    var buttons = document.querySelectorAll('form[data-cart-item-add] [type="submit"]');
    buttons.forEach(function (btn) {
      if (btn.disabled) btn.disabled = false;
      new MutationObserver(function () {
        if (btn.disabled) btn.disabled = false;
      }).observe(btn, { attributes: true, attributeFilter: ["disabled"] });
    });
  }

  // Small public API for other scripts on the site (product-display.js, for
  // admin-added products that have no scraped <form data-cart-item-add> to
  // hook into) to add items to the same cart through the same logic.
  window.TxccCart = {
    addToCart: addToCart,
    minQtyForPrice: minQtyForPrice,
    money: money,
  };

  document.addEventListener("submit", handleAddToCartSubmit, true);
  document.addEventListener("click", handleCartActionClick);

  keepAddToCartEnabled();

  document.addEventListener("DOMContentLoaded", function () {
    renderBadge(loadCart());
    renderCart();
    keepAddToCartEnabled();
    applyMinQtyToProductPages();
  });
})();
