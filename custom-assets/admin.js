// Admin panel for adding/deleting products on a fully static site (no
// database, no server). "Logging in" here means providing a GitHub access
// token with write access to this repo -- the panel then reads/writes
// public-site/products.json directly through GitHub's API from the
// browser. Saving a product = a real git commit; Vercel auto-redeploys on
// it (usually live within under a minute). Regular visitors never need
// this token -- product-display.js just fetches the plain deployed
// products.json like any other static file.
(function () {
  "use strict";

  var OWNER = "Simon2378";
  var REPO = "Arrey";
  var BRANCH = "main";
  var PRODUCTS_PATH = "public-site/products.json";
  var TOKEN_KEY = "txcc_admin_token";

  var CATEGORIES = [
    { value: "all-products", label: "All Products only (no specific category)" },
    { value: "concentrates/crumble", label: "Concentrates → Crumble" },
    { value: "concentrates/live-resin", label: "Concentrates → Live Resin" },
    { value: "concentrates/live-rosin", label: "Concentrates → Live Rosin" },
    { value: "concentrates/shatter", label: "Concentrates → Shatter" },
    { value: "concentrates/thca-diamonds", label: "Concentrates → THCA Diamonds" },
    { value: "edibles-gummies", label: "Edibles & Gummies" },
    { value: "edibles-gummies/mushroom-edibles", label: "Edibles & Gummies → Mushroom Edibles" },
    { value: "edibles-gummies/thcp-edibles", label: "Edibles & Gummies → THCP Edibles" },
    { value: "papers-wraps", label: "Papers & Wraps" },
    { value: "thca-flower", label: "THCA Flower" },
    { value: "shop-by-cannabinoid/cbd-products", label: "Shop by Cannabinoid → CBD" },
    { value: "shop-by-cannabinoid/delta-8-thc-products", label: "Shop by Cannabinoid → Delta-8 THC" },
    { value: "shop-by-cannabinoid/delta-9-thc-products", label: "Shop by Cannabinoid → Delta-9 THC" },
    { value: "shop-by-cannabinoid/delta-10-products", label: "Shop by Cannabinoid → Delta-10" },
    { value: "shop-by-cannabinoid/thca-products", label: "Shop by Cannabinoid → THCA" },
    { value: "shop-by-cannabinoid/thcp-products", label: "Shop by Cannabinoid → THCP" },
  ];

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* ignore */ }
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  function apiHeaders(token) {
    return {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
    };
  }

  function apiError(res, fallbackMsg) {
    return res.json().catch(function () { return {}; }).then(function (body) {
      throw new Error((body && body.message) || fallbackMsg || ("Request failed (" + res.status + ")"));
    });
  }

  // Confirms the token is at least valid and can reach this repo. A fine-
  // grained token's `permissions.push` field in this response isn't a
  // reliable predictor of its actual (possibly narrower) scope, so this
  // doesn't try to guarantee write access up front -- if the token can't
  // actually write, the save/delete calls surface that clearly themselves.
  function verifyToken(token) {
    return fetch("https://api.github.com/repos/" + OWNER + "/" + REPO, { headers: apiHeaders(token) }).then(function (res) {
      if (!res.ok) return apiError(res, "Invalid token, or it doesn't have access to this repo.");
      return true;
    });
  }

  function b64EncodeUnicode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64DecodeUnicode(str) {
    return decodeURIComponent(escape(atob(str.replace(/\n/g, ""))));
  }

  function getProductsFile(token) {
    var url = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + PRODUCTS_PATH + "?ref=" + BRANCH;
    return fetch(url, { headers: apiHeaders(token) }).then(function (res) {
      if (!res.ok) return apiError(res, "Couldn't load the current product list.");
      return res.json();
    }).then(function (data) {
      var products = [];
      try { products = JSON.parse(b64DecodeUnicode(data.content) || "[]"); } catch (e) { products = []; }
      return { products: products, sha: data.sha };
    });
  }

  function saveProductsFile(token, products, sha, message) {
    var url = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + PRODUCTS_PATH;
    return fetch(url, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, apiHeaders(token)),
      body: JSON.stringify({
        message: message,
        content: b64EncodeUnicode(JSON.stringify(products, null, 2)),
        sha: sha,
        branch: BRANCH,
      }),
    }).then(function (res) {
      if (!res.ok) return apiError(res, "Failed to save the product list.");
      return res.json();
    });
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result.split(",")[1]); };
      reader.onerror = function () { reject(new Error("Couldn't read the selected image file.")); };
      reader.readAsDataURL(file);
    });
  }

  function uploadImage(token, file) {
    return fileToBase64(file).then(function (base64) {
      var safeName = Date.now() + "-" + file.name.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
      var path = "public-site/assets/admin-uploads/" + safeName;
      var url = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + path;
      return fetch(url, {
        method: "PUT",
        headers: Object.assign({ "Content-Type": "application/json" }, apiHeaders(token)),
        body: JSON.stringify({
          message: "Admin: upload product image " + safeName,
          content: base64,
          branch: BRANCH,
        }),
      }).then(function (res) {
        if (!res.ok) return apiError(res, "Failed to upload the image.");
        return "assets/admin-uploads/" + safeName;
      });
    });
  }

  // ---- UI ----

  var root = document.getElementById("admin-root");

  function setStatus(el, message, isError) {
    el.textContent = message || "";
    el.className = "txcc-admin-status" + (isError ? " txcc-admin-status--error" : "");
  }

  function renderLogin() {
    root.innerHTML =
      '<div class="txcc-admin-login">' +
        '<label for="admin-token-input">Admin Password</label>' +
        '<input id="admin-token-input" type="password" autocomplete="off" placeholder="Paste your GitHub access token">' +
        '<button type="button" id="admin-login-btn" class="button button--primary">Log In</button>' +
        '<p id="admin-login-status" class="txcc-admin-status"></p>' +
        '<p class="txcc-admin-hint">' +
          "This “password” is a GitHub personal access token with write access to your site's repo. " +
          "Create one once at github.com → Settings → Developer settings → Personal access tokens " +
          "(fine-grained, scoped to just this repo, Contents: Read and write), then paste it here. " +
          "It's remembered in this browser only." +
        "</p>" +
      "</div>";

    document.getElementById("admin-login-btn").addEventListener("click", function () {
      var input = document.getElementById("admin-token-input");
      var statusEl = document.getElementById("admin-login-status");
      var token = input.value.trim();
      if (!token) {
        setStatus(statusEl, "Enter your token first.", true);
        return;
      }
      setStatus(statusEl, "Checking...");
      verifyToken(token).then(function () {
        setToken(token);
        renderDashboard();
      }).catch(function (err) {
        setStatus(statusEl, err.message, true);
      });
    });
  }

  function categoryLabel(value) {
    var match = CATEGORIES.filter(function (c) { return c.value === value; })[0];
    return match ? match.label : value;
  }

  function renderDashboard() {
    var token = getToken();
    root.innerHTML = '<div class="txcc-admin-loading">Loading products…</div>';

    getProductsFile(token).then(function (result) {
      renderDashboardWith(token, result.products, result.sha);
    }).catch(function (err) {
      root.innerHTML =
        '<div class="txcc-admin-status txcc-admin-status--error">' + escapeHtml(err.message) + "</div>" +
        '<button type="button" id="admin-logout-btn" class="button button--small">Log out and try a different token</button>';
      var btn = document.getElementById("admin-logout-btn");
      if (btn) btn.addEventListener("click", function () { clearToken(); renderLogin(); });
    });
  }

  function renderDashboardWith(token, products, sha) {
    var options = CATEGORIES.map(function (c) {
      return '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.label) + "</option>";
    }).join("");

    var rows = products.length
      ? products.map(function (p) {
          return (
            '<div class="txcc-admin-row">' +
              '<img class="txcc-admin-row-img" src="' + escapeHtml(p.image ? "/" + p.image : "/assets/placeholder-product.svg") + '" alt="">' +
              '<div class="txcc-admin-row-body">' +
                '<div class="txcc-admin-row-name">' + escapeHtml(p.name) + "</div>" +
                '<div class="txcc-admin-row-meta">$' + Number(p.price).toFixed(2) + " · " + escapeHtml(categoryLabel(p.category)) + "</div>" +
              "</div>" +
              '<button type="button" class="button button--small txcc-admin-delete-btn" data-id="' + escapeHtml(p.id) + '">Delete</button>' +
            "</div>"
          );
        }).join("")
      : '<p class="txcc-admin-hint">No products added yet.</p>';

    root.innerHTML =
      '<div class="txcc-admin-dashboard">' +
        '<div class="txcc-admin-header">' +
          "<span>Logged in</span>" +
          '<button type="button" id="admin-logout-btn" class="button button--small">Log out</button>' +
        "</div>" +
        '<h2>Add a Product</h2>' +
        '<form id="admin-add-form">' +
          '<label for="admin-name">Name</label>' +
          '<input id="admin-name" type="text" required>' +
          '<label for="admin-price">Price (USD)</label>' +
          '<input id="admin-price" type="number" min="0.01" step="0.01" required>' +
          '<label for="admin-category">Category</label>' +
          '<select id="admin-category">' + options + "</select>" +
          '<label for="admin-description">Description (optional)</label>' +
          '<textarea id="admin-description" rows="3"></textarea>' +
          '<label for="admin-image">Photo (optional)</label>' +
          '<input id="admin-image" type="file" accept="image/*">' +
          '<button type="submit" class="button button--primary">Add Product</button>' +
          '<p id="admin-add-status" class="txcc-admin-status"></p>' +
        "</form>" +
        "<h2>Current Products (" + products.length + ")</h2>" +
        '<div id="admin-product-list">' + rows + "</div>" +
      "</div>";

    document.getElementById("admin-logout-btn").addEventListener("click", function () {
      clearToken();
      renderLogin();
    });

    document.getElementById("admin-add-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var statusEl = document.getElementById("admin-add-status");
      var submitBtn = event.target.querySelector('button[type="submit"]');
      var name = document.getElementById("admin-name").value.trim();
      var price = parseFloat(document.getElementById("admin-price").value);
      var category = document.getElementById("admin-category").value;
      var description = document.getElementById("admin-description").value.trim();
      var imageFile = document.getElementById("admin-image").files[0];

      if (!name || !price || price <= 0) {
        setStatus(statusEl, "Enter a name and a price greater than $0.", true);
        return;
      }

      submitBtn.disabled = true;
      setStatus(statusEl, imageFile ? "Uploading image…" : "Saving…");

      var imageStepPromise = imageFile ? uploadImage(token, imageFile) : Promise.resolve("");

      imageStepPromise.then(function (imagePath) {
        setStatus(statusEl, "Saving product…");
        var newProduct = {
          id: "admin-" + Date.now(),
          name: name,
          price: price,
          category: category,
          description: description,
          image: imagePath,
          createdAt: new Date().toISOString(),
        };
        return getProductsFile(token).then(function (fresh) {
          var updated = fresh.products.concat([newProduct]);
          return saveProductsFile(token, updated, fresh.sha, "Admin: add product \"" + name + "\"");
        });
      }).then(function () {
        setStatus(statusEl, "Saved! It'll be live on the site in under a minute once your host redeploys.");
        setTimeout(renderDashboard, 1200);
      }).catch(function (err) {
        submitBtn.disabled = false;
        setStatus(statusEl, err.message, true);
      });
    });

    document.getElementById("admin-product-list").addEventListener("click", function (event) {
      var btn = event.target.closest(".txcc-admin-delete-btn");
      if (!btn) return;
      if (!window.confirm("Delete this product? This can't be undone.")) return;

      var id = btn.getAttribute("data-id");
      btn.disabled = true;
      btn.textContent = "Deleting…";

      getProductsFile(token).then(function (fresh) {
        var updated = fresh.products.filter(function (p) { return p.id !== id; });
        var removed = fresh.products.filter(function (p) { return p.id === id; })[0];
        return saveProductsFile(token, updated, fresh.sha, "Admin: delete product \"" + (removed ? removed.name : id) + "\"");
      }).then(function () {
        renderDashboard();
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Delete";
        window.alert("Failed to delete: " + err.message);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!root) return;
    var token = getToken();
    if (token) {
      renderDashboard();
    } else {
      renderLogin();
    }
  });
})();
