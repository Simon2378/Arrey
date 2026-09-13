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
    { value: "concentrates", label: "Concentrates" },
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

  function fileToBase64(fileOrBlob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result.split(",")[1]); };
      reader.onerror = function () { reject(new Error("Couldn't read the selected image file.")); };
      reader.readAsDataURL(fileOrBlob);
    });
  }

  // GitHub's Contents API (used to save images as real git blobs via this
  // simple create/update-file endpoint) rejects content much over ~1MB --
  // a full-resolution phone camera photo is routinely 3-10MB and fails
  // silently from the user's point of view (just an upload error). Resize
  // and re-encode as JPEG client-side first, shrinking further if needed,
  // so any photo the browser can display can also be saved here.
  var MAX_UPLOAD_BYTES = 700000; // binary size; base64 inflates ~33% on top

  function drawToBlob(img, maxDim, quality) {
    var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error("Couldn't process the selected image."));
        else resolve(blob);
      }, "image/jpeg", quality);
    });
  }

  function loadImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Couldn't read the selected image file -- is it a valid photo?")); };
      img.src = url;
    });
  }

  function resizeImageFile(file) {
    return loadImageElement(file).then(function (img) {
      var attempts = [
        [1600, 0.82], [1600, 0.6], [1200, 0.6], [900, 0.55], [700, 0.5],
      ];
      function tryAttempt(i) {
        var maxDim = attempts[i][0], quality = attempts[i][1];
        return drawToBlob(img, maxDim, quality).then(function (blob) {
          if (blob.size <= MAX_UPLOAD_BYTES || i === attempts.length - 1) return blob;
          return tryAttempt(i + 1);
        });
      }
      return tryAttempt(0);
    });
  }

  function uploadImage(token, file) {
    return resizeImageFile(file).then(function (blob) {
      return fileToBase64(blob).then(function (base64) {
        var baseName = file.name.toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/\.[a-z0-9]+$/, "");
        var safeName = Date.now() + "-" + baseName + ".jpg";
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

  function categoryOptionsHtml(selected) {
    return CATEGORIES.map(function (c) {
      var sel = c.value === selected ? " selected" : "";
      return '<option value="' + escapeHtml(c.value) + '"' + sel + ">" + escapeHtml(c.label) + "</option>";
    }).join("");
  }

  function editFormHtml(p) {
    return (
      '<form class="txcc-admin-edit-form" data-id="' + escapeHtml(p.id) + '">' +
        '<img class="txcc-admin-row-img" src="' + escapeHtml(p.image ? "/" + p.image : "/assets/placeholder-product.svg") + '" alt="">' +
        '<label>Name</label>' +
        '<input class="txcc-edit-name" type="text" value="' + escapeHtml(p.name) + '" required>' +
        '<label>Price (USD)</label>' +
        '<input class="txcc-edit-price" type="number" min="0.01" step="0.01" value="' + escapeHtml(p.price) + '" required>' +
        '<label>Category</label>' +
        '<select class="txcc-edit-category">' + categoryOptionsHtml(p.category) + "</select>" +
        '<label>Description (optional)</label>' +
        '<textarea class="txcc-edit-description" rows="2">' + escapeHtml(p.description || "") + "</textarea>" +
        '<label>Replace Photo (optional)</label>' +
        '<input class="txcc-edit-image" type="file" accept="image/*">' +
        '<div class="txcc-admin-edit-actions">' +
          '<button type="submit" class="button button--small button--primary">Save Changes</button>' +
          '<button type="button" class="button button--small txcc-admin-cancel-btn">Cancel</button>' +
        "</div>" +
        '<p class="txcc-admin-status txcc-edit-status"></p>' +
      "</form>"
    );
  }

  function rows(products) {
    return products.length
      ? products.map(function (p) {
          return (
            '<div class="txcc-admin-row" data-row-id="' + escapeHtml(p.id) + '">' +
              '<img class="txcc-admin-row-img" src="' + escapeHtml(p.image ? "/" + p.image : "/assets/placeholder-product.svg") + '" alt="">' +
              '<div class="txcc-admin-row-body">' +
                '<div class="txcc-admin-row-name">' + escapeHtml(p.name) + "</div>" +
                '<div class="txcc-admin-row-meta">$' + Number(p.price).toFixed(2) + " · " + escapeHtml(categoryLabel(p.category)) + "</div>" +
              "</div>" +
              '<button type="button" class="button button--small txcc-admin-edit-btn" data-id="' + escapeHtml(p.id) + '">Edit</button>' +
              '<button type="button" class="button button--small txcc-admin-delete-btn" data-id="' + escapeHtml(p.id) + '">Delete</button>' +
            "</div>"
          );
        }).join("")
      : '<p class="txcc-admin-hint">No products added yet.</p>';
  }

  function renderDashboardWith(token, products, sha) {
    var options = CATEGORIES.map(function (c) {
      return '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.label) + "</option>";
    }).join("");

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
        '<div id="admin-product-list">' + rows(products) + "</div>" +
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

    var listEl = document.getElementById("admin-product-list");

    listEl.addEventListener("click", function (event) {
      var deleteBtn = event.target.closest(".txcc-admin-delete-btn");
      if (deleteBtn) {
        if (!window.confirm("Delete this product? This can't be undone.")) return;

        var id = deleteBtn.getAttribute("data-id");
        deleteBtn.disabled = true;
        deleteBtn.textContent = "Deleting…";

        getProductsFile(token).then(function (fresh) {
          var updated = fresh.products.filter(function (p) { return p.id !== id; });
          var removed = fresh.products.filter(function (p) { return p.id === id; })[0];
          return saveProductsFile(token, updated, fresh.sha, "Admin: delete product \"" + (removed ? removed.name : id) + "\"");
        }).then(function () {
          renderDashboard();
        }).catch(function (err) {
          deleteBtn.disabled = false;
          deleteBtn.textContent = "Delete";
          window.alert("Failed to delete: " + err.message);
        });
        return;
      }

      var editBtn = event.target.closest(".txcc-admin-edit-btn");
      if (editBtn) {
        var editId = editBtn.getAttribute("data-id");
        var product = products.filter(function (p) { return p.id === editId; })[0];
        if (!product) return;
        var rowEl = listEl.querySelector('[data-row-id="' + editId + '"]');
        if (rowEl) rowEl.outerHTML = editFormHtml(product);
        return;
      }

      var cancelBtn = event.target.closest(".txcc-admin-cancel-btn");
      if (cancelBtn) {
        var form = cancelBtn.closest(".txcc-admin-edit-form");
        var cancelId = form.getAttribute("data-id");
        var original = products.filter(function (p) { return p.id === cancelId; })[0];
        if (original) form.outerHTML = rows([original]);
        return;
      }
    });

    listEl.addEventListener("submit", function (event) {
      var form = event.target.closest(".txcc-admin-edit-form");
      if (!form) return;
      event.preventDefault();

      var id = form.getAttribute("data-id");
      var statusEl = form.querySelector(".txcc-edit-status");
      var submitBtn = form.querySelector('button[type="submit"]');
      var name = form.querySelector(".txcc-edit-name").value.trim();
      var price = parseFloat(form.querySelector(".txcc-edit-price").value);
      var category = form.querySelector(".txcc-edit-category").value;
      var description = form.querySelector(".txcc-edit-description").value.trim();
      var imageFile = form.querySelector(".txcc-edit-image").files[0];

      if (!name || !price || price <= 0) {
        setStatus(statusEl, "Enter a name and a price greater than $0.", true);
        return;
      }

      submitBtn.disabled = true;
      setStatus(statusEl, imageFile ? "Uploading image…" : "Saving…");

      var imageStepPromise = imageFile ? uploadImage(token, imageFile) : Promise.resolve(null);

      imageStepPromise.then(function (newImagePath) {
        setStatus(statusEl, "Saving product…");
        return getProductsFile(token).then(function (fresh) {
          var updated = fresh.products.map(function (p) {
            if (p.id !== id) return p;
            return {
              id: p.id,
              name: name,
              price: price,
              category: category,
              description: description,
              image: newImagePath !== null ? newImagePath : p.image,
              createdAt: p.createdAt,
            };
          });
          return saveProductsFile(token, updated, fresh.sha, "Admin: edit product \"" + name + "\"");
        });
      }).then(function () {
        setStatus(statusEl, "Saved! It'll be live on the site in under a minute once your host redeploys.");
        setTimeout(renderDashboard, 1200);
      }).catch(function (err) {
        submitBtn.disabled = false;
        setStatus(statusEl, err.message, true);
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
