// Client-side cart for the static export. There is no backend (BigCommerce's
// real cart.php isn't reachable from here), so this stores the cart in the
// browser's localStorage and renders it into the existing header cart-preview
// dropdown that the theme already ships (#cart-preview-dropdown).
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

  function renderBadge(items) {
    var pill = document.querySelector(".cart-quantity");
    if (!pill) return;
    var count = cartCount(items);
    pill.textContent = count > 0 ? String(count) : "";
    pill.classList.toggle("countPill--positive", count > 0);
  }

  function getPanel() {
    return document.getElementById("cart-preview-dropdown");
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
    renderPanel();
    openPanel();
  }

  function removeFromCart(id, variant) {
    var items = loadCart().filter(function (i) {
      return !(i.id === id && i.variant === variant);
    });
    saveCart(items);
    renderPanel();
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
    renderPanel();
  }

  function renderPanel() {
    var panel = getPanel();
    if (!panel) return;
    var items = loadCart();
    var methods = window.PAYMENT_METHODS || [];
    var selected = panel.getAttribute("data-selected-method") || (methods[0] && methods[0].id) || "";

    if (items.length === 0) {
      panel.innerHTML = '<div class="txcc-cart-empty">Your cart is empty.</div>';
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
        methodDetail;
    }

    panel.innerHTML =
      '<div class="txcc-cart-panel">' +
        '<div class="txcc-cart-items">' + rows + "</div>" +
        '<div class="txcc-cart-total">Total: <strong>' + money(total) + "</strong></div>" +
        '<div class="txcc-payment-methods">' + paymentSection + "</div>" +
      "</div>";

    panel.setAttribute("data-selected-method", selected);
  }

  function openPanel() {
    var panel = getPanel();
    var cartLink = document.querySelector(".navUser-action--cart");
    if (!panel || !cartLink) return;
    panel.classList.add("open", "is-open");
    panel.setAttribute("aria-hidden", "false");
    cartLink.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    var panel = getPanel();
    var cartLink = document.querySelector(".navUser-action--cart");
    if (!panel || !cartLink) return;
    panel.classList.remove("open", "is-open");
    panel.setAttribute("aria-hidden", "true");
    cartLink.setAttribute("aria-expanded", "false");
  }

  function togglePanel() {
    var panel = getPanel();
    if (!panel) return;
    if (panel.classList.contains("open")) closePanel();
    else openPanel();
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

  function handlePanelClick(event) {
    var actionBtn = event.target.closest("[data-action]");
    if (actionBtn && getPanel() && getPanel().contains(actionBtn)) {
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
    if (methodBtn && getPanel() && getPanel().contains(methodBtn)) {
      getPanel().setAttribute("data-selected-method", methodBtn.getAttribute("data-method"));
      renderPanel();
      return;
    }

    var copyBtn = event.target.closest("[data-copy-address]");
    if (copyBtn && getPanel() && getPanel().contains(copyBtn)) {
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

  function handleDocumentClick(event) {
    var panel = getPanel();
    var cartLink = document.querySelector(".navUser-action--cart");
    if (!panel || !cartLink) return;

    // Use composedPath() rather than testing event.target against the current
    // DOM: handlePanelClick (registered before this listener) may have already
    // called renderPanel() and replaced the clicked element's node, leaving
    // event.target detached. panel.contains(event.target) would then wrongly
    // say "outside" and close the panel right after opening/updating it.
    // composedPath() is captured at dispatch time, before any handler mutates
    // the DOM, so it still reflects the real ancestry of the original click.
    var path = event.composedPath ? event.composedPath() : [event.target];

    if (path.indexOf(cartLink) !== -1) {
      event.preventDefault();
      togglePanel();
      return;
    }
    if (path.indexOf(panel) === -1) {
      closePanel();
    }
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

  document.addEventListener("submit", handleAddToCartSubmit, true);
  document.addEventListener("click", handlePanelClick);
  document.addEventListener("click", handleDocumentClick);

  keepAddToCartEnabled();

  document.addEventListener("DOMContentLoaded", function () {
    renderBadge(loadCart());
    renderPanel();
    keepAddToCartEnabled();
    applyMinQtyToProductPages();
  });
})();
