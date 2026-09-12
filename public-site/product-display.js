// Shows admin-added products (from products.json, written by admin.js) to
// regular visitors. Runs on every page; does nothing if the page has
// neither a product grid nor the product-detail container. products.json
// is fetched as a plain static file -- no GitHub token needed for this,
// that's only required to WRITE it (see admin.js).
(function () {
  "use strict";

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(n) {
    return (window.TxccCart && window.TxccCart.money) ? window.TxccCart.money(n) : "$" + Number(n).toFixed(2);
  }

  function currentCategorySlug() {
    // every in-site link points at a literal .../index.html file (this is a
    // static export, not a server that resolves directory URLs), so the
    // trailing filename has to be stripped before the path becomes a slug --
    // otherwise "/concentrates/index.html" reads as "concentrates/index.html"
    // and never matches a plain "concentrates" category.
    return window.location.pathname
      .replace(/index\.html$/i, "")
      .replace(/^\/+|\/+$/g, "");
  }

  function rootRelative(path) {
    // pages live at varying depths (e.g. /concentrates/crumble/) but
    // product-display.js only ever needs to link to root-absolute paths,
    // which work regardless of the current page's depth.
    return "/" + path.replace(/^\/+/, "");
  }

  // the concentrate-*.jpg files are generic licensed stock photos (CC0/
  // public domain/CC BY-SA, see /CONCENTRATE_IMAGE_CREDITS.md), used as a
  // stand-in per concentrate type until real photos are added via /admin/
  function productImageSrc(p) {
    return p.image ? rootRelative(p.image) : rootRelative("placeholder-product.svg");
  }

  function cardHtml(p) {
    var href = "/p/?id=" + encodeURIComponent(p.id);
    return (
      '<li class="product" data-admin-product-id="' + escapeHtml(p.id) + '">' +
        '<article class="card">' +
          '<figure class="card-figure">' +
            '<a href="' + href + '">' +
              '<div class="card-img-container">' +
                '<img class="card-image" src="' + escapeHtml(productImageSrc(p)) + '" alt="' + escapeHtml(p.name) + '">' +
              "</div>" +
            "</a>" +
            '<figcaption class="card-figcaption">' +
              '<div class="card-figcaption-body">' +
                '<div class="card-buttons">' +
                  '<a class="button button--small button--primary card-figcaption-button" href="' + href + '">View</a>' +
                "</div>" +
              "</div>" +
            "</figcaption>" +
          "</figure>" +
          '<div class="card-body">' +
            '<h4 class="card-title"><a href="' + href + '">' + escapeHtml(p.name) + "</a></h4>" +
            '<div class="card-text card-text--price">' +
              '<span class="price price--withoutTax price--main">' + money(p.price) + "</span>" +
            "</div>" +
          "</div>" +
        "</article>" +
      "</li>"
    );
  }

  function injectIntoListing(products) {
    if (!products.length) return;

    var grid = document.querySelector("ul.productGrid");
    if (grid) {
      products.forEach(function (p) { grid.insertAdjacentHTML("beforeend", cardHtml(p)); });
      return;
    }

    // Empty-category pages render a plain message instead of a grid --
    // replace it with a real grid containing just the admin products.
    var emptyContainer = document.getElementById("product-listing-container");
    if (emptyContainer) {
      emptyContainer.innerHTML = '<ul class="productGrid productGrid--maxCol4">' + products.map(cardHtml).join("") + "</ul>";
    }
  }

  function renderProductDetail(products) {
    var container = document.getElementById("product-detail-content");
    if (!container) return;

    var params = new URLSearchParams(window.location.search);
    var id = params.get("id");
    var product = products.filter(function (p) { return p.id === id; })[0];

    if (!product) {
      container.innerHTML = '<div class="txcc-cart-empty">Product not found. <a href="/all-products/">Back to all products</a></div>';
      return;
    }

    document.title = product.name + " - Texas Cannabis Company";

    container.innerHTML =
      '<div class="txcc-product-detail">' +
        '<img class="txcc-product-detail-img" src="' + escapeHtml(productImageSrc(product)) + '" alt="' + escapeHtml(product.name) + '">' +
        '<div class="txcc-product-detail-body">' +
          "<h1>" + escapeHtml(product.name) + "</h1>" +
          '<div class="txcc-product-detail-price">' + money(product.price) + "</div>" +
          (product.description ? '<p class="txcc-product-detail-desc">' + escapeHtml(product.description) + "</p>" : "") +
          '<div class="txcc-product-detail-qty">' +
            '<label for="txcc-pd-qty">Quantity</label>' +
            '<input id="txcc-pd-qty" type="number" min="1" value="1">' +
          "</div>" +
          '<button type="button" id="txcc-pd-add" class="button button--primary">Add to Cart</button>' +
          '<p id="txcc-pd-status" class="txcc-admin-status"></p>' +
        "</div>" +
      "</div>";

    document.getElementById("txcc-pd-add").addEventListener("click", function () {
      if (!window.TxccCart) return;
      var qtyInput = document.getElementById("txcc-pd-qty");
      var minQty = window.TxccCart.minQtyForPrice(product.price);
      var qty = Math.max(minQty, parseInt(qtyInput.value, 10) || 1);
      window.TxccCart.addToCart({
        id: product.id,
        variant: "",
        name: product.name,
        price: product.price,
        image: productImageSrc(product),
        qty: qty,
        minQty: minQty,
      });
      document.getElementById("txcc-pd-status").textContent = "Added to cart.";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var needsListing = document.querySelector("ul.productGrid") || document.getElementById("product-listing-container");
    var needsDetail = document.getElementById("product-detail-content");
    if (!needsListing && !needsDetail) return;

    fetch("/products.json").then(function (res) {
      return res.ok ? res.json() : [];
    }).catch(function () {
      return [];
    }).then(function (products) {
      if (needsDetail) {
        renderProductDetail(products);
        return;
      }
      var slug = currentCategorySlug();
      var matching;
      if (slug === "all-products") {
        matching = products;
      } else {
        // an exact match ("concentrates/live-rosin") is a specific
        // subcategory; a parent page ("concentrates") should show every
        // product from all of its subcategories too, not just ones
        // categorized as the bare parent (which none are, in practice).
        matching = products.filter(function (p) {
          return p.category === slug || p.category.indexOf(slug + "/") === 0;
        });
      }
      injectIntoListing(matching);
    });
  });
})();
