"use strict";

const CART_KEY = "devin.cart.v1";
const CART_MAX_QTY = 99;
const SUPPORT_EMAIL = "superapp.devin@gmail.com";
const SITE_ORIGIN = "https://hhfa008.github.io/store";
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

let lastCartTrigger = null;
let fallbackCart = [];

function money(value) {
  return currency.format(value);
}

function catalog() {
  return typeof PRODUCTS !== "undefined" && Array.isArray(PRODUCTS) ? PRODUCTS : [];
}

function getProduct(id) {
  return catalog().find((product) => product.id === id) || null;
}

function productHref(id) {
  return `product.html?id=${encodeURIComponent(id)}`;
}

function productJsonLd(product) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    sku: product.id,
    brand: {
      "@type": "Brand",
      name: "Devin"
    },
    offers: {
      "@type": "Offer",
      price: Number(product.price).toFixed(2),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: product.buyUrl
    }
  };
}

// product.html renders from ?id=, so the Product JSON-LD is injected at runtime
// and rewritten whenever the rendered product changes (or removed for an unknown id).
function renderProductJsonLd(product) {
  const existing = document.getElementById("product-jsonld");

  if (!product) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  let node = existing;
  if (!node) {
    node = document.createElement("script");
    node.type = "application/ld+json";
    node.id = "product-jsonld";
    document.head.append(node);
  }

  node.textContent = JSON.stringify(productJsonLd(product), null, 2);
}

function readCart() {
  let entries = [];

  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        entries = parsed;
      }
    }
  } catch (error) {
    entries = fallbackCart;
  }

  if (!entries.length && fallbackCart.length) {
    entries = fallbackCart;
  }

  const merged = new Map();

  entries.forEach((entry) => {
    if (!entry || typeof entry.id !== "string") {
      return;
    }

    const product = getProduct(entry.id);
    if (!product) {
      return;
    }

    const requested = Number(entry.qty);
    const qty = Number.isFinite(requested)
      ? Math.min(CART_MAX_QTY, Math.max(1, Math.floor(requested)))
      : 1;

    merged.set(entry.id, Math.min(CART_MAX_QTY, (merged.get(entry.id) || 0) + qty));
  });

  return Array.from(merged, ([id, qty]) => ({ id, qty }));
}

function writeCart(items) {
  const clean = items
    .filter((item) => getProduct(item.id))
    .map((item) => ({
      id: item.id,
      qty: Math.min(CART_MAX_QTY, Math.max(1, Math.floor(item.qty)))
    }));

  fallbackCart = clean.map((item) => ({ ...item }));

  try {
    localStorage.setItem(CART_KEY, JSON.stringify(clean));
  } catch (error) {
    // The in-memory cart keeps the current page usable when storage is blocked.
  }
}

function cartTotals(items) {
  return items.reduce(
    (totals, item) => {
      const product = getProduct(item.id);
      if (!product) {
        return totals;
      }

      totals.count += item.qty;
      totals.subtotal += product.price * item.qty;
      return totals;
    },
    { count: 0, subtotal: 0 }
  );
}

function itemLabel(count) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function canBuyOnGumroad(product) {
  if (!product || !product.buyUrl) {
    return false;
  }

  // Never send a buyer to Gumroad at a price different from the one shown here.
  // compareAt is marketing copy; the price that matters is what Gumroad charges.
  return Number(product.gumroadPrice) === Number(product.price);
}

function singleItemBuyUrl(items) {
  if (items.length !== 1) {
    return "";
  }

  const item = items[0];
  if (Number(item.qty) !== 1) {
    return "";
  }

  const product = getProduct(item.id);
  return canBuyOnGumroad(product) ? product.buyUrl : "";
}

function buildManualCheckoutUrl(items) {
  const lines = [];
  const subjectItems = [];
  let total = 0;

  items.forEach((item) => {
    const product = getProduct(item.id);
    if (!product) {
      return;
    }

    const qty = Math.min(
      CART_MAX_QTY,
      Math.max(1, Math.floor(Number(item.qty) || 1))
    );

    subjectItems.push(`${product.name} × ${qty}`);
    lines.push(`- ${product.name} × ${qty}: ${money(product.price * qty)}`);
    total += product.price * qty;
  });

  if (!lines.length) {
    return "";
  }

  const subject = `Purchase: ${subjectItems.join(", ")}`;
  const body = [
    "Order summary",
    "",
    ...lines,
    "",
    `Total: ${money(total)}`,
    "",
    "Please reply with an invoice (PayPal or bank transfer). I'll send payment right away.",
    "",
    "Thanks!"
  ].join("\n");

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

function addToCart(id) {
  const product = getProduct(id);
  if (!product) {
    return null;
  }

  const items = readCart();
  const existing = items.find((item) => item.id === id);

  if (existing) {
    existing.qty = Math.min(CART_MAX_QTY, existing.qty + 1);
  } else {
    items.push({ id, qty: 1 });
  }

  writeCart(items);
  refreshCartUI();
  announce(`${product.name} added to your cart.`);
  return product;
}

function setCartQty(id, nextQty) {
  const items = readCart();
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    return;
  }

  item.qty = Math.min(CART_MAX_QTY, Math.max(1, nextQty));
  writeCart(items);
  refreshCartUI();
}

function removeCartItem(id) {
  const product = getProduct(id);
  const items = readCart().filter((item) => item.id !== id);
  writeCart(items);
  refreshCartUI();
  if (product) {
    announce(`${product.name} removed from your cart.`);
  }
}

function announce(message) {
  const node = document.getElementById("cart-announcer");
  if (!node) {
    return;
  }

  node.textContent = "";
  window.setTimeout(() => {
    node.textContent = message;
  }, 30);
}

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (typeof text === "string") {
    node.textContent = text;
  }
  return node;
}

function productMarkClass(id) {
  return `item-mark item-mark--${id}`;
}

function ensureCartDrawer() {
  if (document.getElementById("cart-layer")) {
    return;
  }

  const layer = document.createElement("div");
  layer.className = "cart-layer";
  layer.id = "cart-layer";
  layer.hidden = true;
  layer.innerHTML = `
    <div class="cart-backdrop" data-close-cart aria-hidden="true"></div>
    <aside class="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" tabindex="-1">
      <div class="cart-head">
        <div>
          <p class="eyebrow eyebrow--small">YOUR CART</p>
          <h2 id="cart-title">Your cart.</h2>
        </div>
        <button class="icon-button" id="cart-close" type="button" data-close-cart aria-label="Close cart">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
          </svg>
        </button>
      </div>
      <div class="cart-body">
        <div class="cart-items" id="cart-items"></div>
        <div class="cart-empty" id="cart-empty" hidden>
          <span class="cart-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 8h14l-1 11H6L5 8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>
              <path d="M9 9V6a3 3 0 0 1 6 0v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
            </svg>
          </span>
          <h3>Your cart is empty.</h3>
          <p>Pick the kit that matches the problem in front of you.</p>
          <button class="button button--secondary" type="button" data-browse-kits>Browse the kits</button>
        </div>
      </div>
      <div class="cart-foot" id="cart-foot" hidden>
        <div class="cart-subtotal-line">
          <span>Subtotal</span>
          <strong data-cart-subtotal>$0</strong>
        </div>
        <p class="cart-foot-note">Digital delivery. No shipping or recurring fees.</p>
        <a class="button button--primary cart-checkout" href="checkout.html">
          Checkout
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 10h12M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </a>
        <button class="button button--ghost" type="button" data-close-cart>Continue browsing</button>
      </div>
    </aside>
  `;

  const announcer = createElement("p", "sr-only");
  announcer.id = "cart-announcer";
  announcer.setAttribute("aria-live", "polite");
  announcer.setAttribute("aria-atomic", "true");
  document.body.append(layer, announcer);

  layer.addEventListener("click", handleCartLayerClick);
  layer.addEventListener("keydown", trapCartFocus);
}

function handleCartLayerClick(event) {
  if (event.target.closest("[data-close-cart]")) {
    closeCart();
    return;
  }

  if (event.target.closest("[data-browse-kits]")) {
    closeCart();
    if (document.body.dataset.page === "home") {
      document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
    } else {
      window.location.href = "index.html#products";
    }
    return;
  }

  const stepButton = event.target.closest("[data-qty-step]");
  if (stepButton) {
    const item = readCart().find((entry) => entry.id === stepButton.dataset.productId);
    if (item) {
      setCartQty(item.id, item.qty + Number(stepButton.dataset.qtyStep));
      const selector = `[data-qty-step="${stepButton.dataset.qtyStep}"][data-product-id="${item.id}"]`;
      document.querySelector(selector)?.focus();
    }
    return;
  }

  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) {
    event.stopPropagation();
    removeCartItem(removeButton.dataset.remove);
    document.getElementById("cart-close")?.focus();
  }
}

function trapCartFocus(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeCart();
    return;
  }

  if (event.key !== "Tab") {
    return;
  }

  const layer = document.getElementById("cart-layer");
  const drawer = layer?.querySelector(".cart-drawer");
  if (!drawer) {
    return;
  }

  const focusable = Array.from(
    drawer.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((node) => node.offsetParent !== null);

  if (!focusable.length) {
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openCart() {
  ensureCartDrawer();
  const layer = document.getElementById("cart-layer");
  if (!layer || !layer.hidden) {
    return;
  }

  lastCartTrigger = document.activeElement;
  renderCartDrawer(readCart());
  layer.hidden = false;
  document.body.classList.add("cart-open");
  window.requestAnimationFrame(() => {
    document.getElementById("cart-close")?.focus();
  });
}

function closeCart() {
  const layer = document.getElementById("cart-layer");
  if (!layer || layer.hidden) {
    return;
  }

  layer.hidden = true;
  document.body.classList.remove("cart-open");
  if (lastCartTrigger instanceof HTMLElement) {
    lastCartTrigger.focus({ preventScroll: true });
  }
}

function renderCartDrawer(items) {
  const itemsNode = document.getElementById("cart-items");
  const emptyNode = document.getElementById("cart-empty");
  const footNode = document.getElementById("cart-foot");
  if (!itemsNode || !emptyNode || !footNode) {
    return;
  }

  itemsNode.replaceChildren();
  const totals = cartTotals(items);
  const isEmpty = items.length === 0;

  itemsNode.hidden = isEmpty;
  emptyNode.hidden = !isEmpty;
  footNode.hidden = isEmpty;

  items.forEach((item) => {
    const product = getProduct(item.id);
    if (!product) {
      return;
    }

    const row = createElement("article", "cart-item");

    const mark = createElement("div", productMarkClass(product.id), product.code);
    mark.setAttribute("aria-hidden", "true");

    const info = createElement("div", "cart-item-info");
    const type = createElement(
      "p",
      "cart-item-type",
      `${product.type} · ${product.format}`
    );
    const name = createElement("h3", "cart-item-name", product.name);

    const controls = createElement("div", "cart-item-controls");
    const stepper = createElement("div", "stepper");
    stepper.setAttribute("aria-label", `Quantity for ${product.name}`);

    const minus = createElement("button", "stepper-button", "−");
    minus.type = "button";
    minus.dataset.qtyStep = "-1";
    minus.dataset.productId = product.id;
    minus.disabled = item.qty <= 1;
    minus.setAttribute("aria-label", `Decrease quantity for ${product.name}`);

    const quantity = createElement("span", "stepper-value", String(item.qty));
    quantity.setAttribute("aria-live", "polite");

    const plus = createElement("button", "stepper-button", "+");
    plus.type = "button";
    plus.dataset.qtyStep = "1";
    plus.dataset.productId = product.id;
    plus.disabled = item.qty >= CART_MAX_QTY;
    plus.setAttribute("aria-label", `Increase quantity for ${product.name}`);

    stepper.append(minus, quantity, plus);

    const remove = createElement("button", "text-button", "Remove");
    remove.type = "button";
    remove.dataset.remove = product.id;
    remove.setAttribute("aria-label", `Remove ${product.name} from cart`);

    controls.append(stepper, remove);
    info.append(type, name, controls);

    const price = createElement(
      "strong",
      "cart-item-price",
      money(product.price * item.qty)
    );

    row.append(mark, info, price);
    itemsNode.append(row);
  });

  const subtotalNode = document.querySelector("[data-cart-subtotal]");
  if (subtotalNode) {
    subtotalNode.textContent = money(totals.subtotal);
  }
}

function refreshCartUI(items = readCart()) {
  const totals = cartTotals(items);

  document.querySelectorAll("[data-cart-count]").forEach((node) => {
    node.textContent = itemLabel(totals.count);
  });

  document.querySelectorAll("[data-cart-total]").forEach((node) => {
    node.textContent = money(totals.subtotal);
  });

  document.querySelectorAll("[data-open-cart]").forEach((node) => {
    node.setAttribute(
      "aria-label",
      `Open cart, ${itemLabel(totals.count)}, ${money(totals.subtotal)}`
    );
  });

  renderCartDrawer(items);

  if (document.body.dataset.page === "checkout") {
    renderCheckout(items);
  }
}

function hydrateHome() {
  document.querySelectorAll("[data-product-card]").forEach((card) => {
    const product = getProduct(card.dataset.productCard);
    if (!product) {
      return;
    }

    card.querySelectorAll("[data-product-name]").forEach((node) => {
      node.textContent = product.name;
      if (node.tagName === "A") {
        node.href = productHref(product.id);
      }
    });

    card.querySelectorAll("[data-product-type]").forEach((node) => {
      node.textContent = product.type;
    });

    const tagline = card.querySelector("[data-product-tagline]");
    if (tagline) {
      tagline.textContent = product.tagline;
    }

    const price = card.querySelector("[data-product-price]");
    if (price) {
      price.textContent = money(product.price);
    }

    const compare = card.querySelector("[data-price-compare]");
    if (compare) {
      compare.textContent = product.compareAt
        ? `reg. ${money(product.compareAt)}`
        : "";
      compare.hidden = !product.compareAt;
    }

    const points = card.querySelector("[data-product-points]");
    if (points) {
      points.replaceChildren();
      product.highlights.forEach((highlight) => {
        points.append(createElement("li", "", highlight));
      });
    }

    const addButton = card.querySelector("[data-add]");
    if (addButton) {
      addButton.dataset.add = product.id;
      addButton.setAttribute("aria-label", `Buy ${product.name} for ${money(product.price)}`);
    }

    const details = card.querySelector("[data-product-link]");
    if (details) {
      details.href = productHref(product.id);
      details.setAttribute("aria-label", `View details for ${product.name}`);
    }
  });
}

function renderProductPage() {
  const view = document.getElementById("product-view");
  const missing = document.getElementById("product-missing");
  if (!view || !missing) {
    return;
  }

  const id = new URLSearchParams(window.location.search).get("id");
  const product = getProduct(id);

  // The canonical URL is static in the HTML because this is one template.
  // Point it at the actual ?id= URL so crawlers never treat the bare page as a soft 404.
  const canonical = document.getElementById("page-canonical");
  if (canonical) {
    canonical.href = product
      ? `${SITE_ORIGIN}/product.html?id=${encodeURIComponent(product.id)}`
      : `${SITE_ORIGIN}/index.html#products`;
  }

  renderProductJsonLd(product);

  if (!product) {
    view.hidden = true;
    missing.hidden = false;
    document.title = "Kit not found — Devin";
    return;
  }

  document.title = `${product.name} — Devin`;
  missing.hidden = true;
  view.hidden = false;

  document.querySelectorAll("[data-product-name]").forEach((node) => {
    node.textContent = product.name;
  });
  document.querySelectorAll("[data-product-type]").forEach((node) => {
    node.textContent = product.type;
  });
  document.querySelectorAll("[data-product-format]").forEach((node) => {
    node.textContent = product.format;
  });
  document.querySelectorAll("[data-product-files]").forEach((node) => {
    node.textContent = product.files || product.format;
  });
  document.querySelectorAll("[data-product-version]").forEach((node) => {
    node.textContent = product.version || "";
  });
  document.querySelectorAll("[data-product-updated]").forEach((node) => {
    node.textContent = product.updated || "";
  });
  document.querySelectorAll("[data-product-support]").forEach((node) => {
    node.textContent = product.support || "";
  });
  document.querySelectorAll("[data-product-price]").forEach((node) => {
    node.textContent = money(product.price);
  });
  document.querySelectorAll("[data-price-compare]").forEach((node) => {
    node.textContent = product.compareAt
      ? `reg. ${money(product.compareAt)}`
      : "";
    node.hidden = !product.compareAt;
  });

  const tagline = document.querySelector("[data-product-tagline]");
  if (tagline) {
    tagline.textContent = product.tagline;
  }

  const description = document.querySelector("[data-product-description]");
  if (description) {
    description.textContent = product.description;
  }

  const fit = document.querySelector("[data-product-fit]");
  if (fit) {
    fit.textContent = product.fit;
  }

  const licensePanel = document.getElementById("product-license-panel");
  const licenseNode = document.querySelector("[data-product-license]");
  if (licensePanel && licenseNode) {
    const licenseText = product.license || "";
    licensePanel.hidden = !licenseText;
    licenseNode.textContent = licenseText;
  }

  const includes = document.getElementById("product-includes");
  if (includes) {
    includes.replaceChildren();
    product.includes.forEach((entry) => {
      const item = document.createElement("li");
      const check = createElement("span", "include-check");
      check.setAttribute("aria-hidden", "true");
      check.innerHTML = `
        <svg viewBox="0 0 16 16">
          <path d="M3.5 8.2 6.6 11l5.9-6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `;
      item.append(check, createElement("span", "", entry));
      includes.append(item);
    });
  }

  const addButton = view.querySelector("[data-add]");
  if (addButton) {
    addButton.dataset.add = product.id;
    if (canBuyOnGumroad(product)) {
      addButton.dataset.buyUrl = product.buyUrl;
      addButton.textContent = `Buy on Gumroad — ${money(product.price)}`;
      addButton.setAttribute(
        "aria-label",
        `Buy ${product.name} on Gumroad for ${money(product.price)}`
      );
      const purchaseNote = document.querySelector("[data-purchase-note]");
      if (purchaseNote) {
        purchaseNote.textContent = "Instant checkout on Gumroad · secure payment";
      }
      const deliveryFact = document.querySelector("[data-delivery-fact]");
      if (deliveryFact) {
        deliveryFact.textContent = "Instant download";
      }
    } else {
      addButton.textContent = `Buy for ${money(product.price)}`;
      addButton.setAttribute("aria-label", `Buy ${product.name} for ${money(product.price)}`);
    }
  }

  const editLink = view.querySelector("[data-product-cart-link]");
  if (editLink) {
    editLink.setAttribute("aria-label", `View cart with ${product.name}`);
  }
}

function renderCheckout(items) {
  const list = document.getElementById("checkout-items");
  const empty = document.getElementById("checkout-empty");
  const totalsNode = document.getElementById("checkout-totals");
  const orderFoot = document.getElementById("order-foot");
  const countNode = document.getElementById("checkout-count");
  const payButton = document.getElementById("pay-button");
  const payTotal = document.getElementById("pay-total");
  const payNote = document.getElementById("pay-note");
  if (!list || !empty || !totalsNode || !countNode || !payButton || !payTotal) {
    return;
  }

  const totals = cartTotals(items);
  const isEmpty = items.length === 0;
  const directBuyUrl = singleItemBuyUrl(items);

  list.replaceChildren();
  list.hidden = isEmpty;
  empty.hidden = !isEmpty;
  totalsNode.hidden = isEmpty;
  if (orderFoot) {
    orderFoot.hidden = isEmpty;
  }

  countNode.textContent = itemLabel(totals.count);

  items.forEach((item) => {
    const product = getProduct(item.id);
    if (!product) {
      return;
    }

    const row = createElement("article", "order-item");

    const mark = createElement("div", productMarkClass(product.id), product.code);
    mark.setAttribute("aria-hidden", "true");

    const info = createElement("div", "order-item-info");
    const meta = createElement("div", "order-item-meta");
    meta.append(
      createElement("span", "order-item-type", product.type),
      createElement("span", "order-item-qty", `Qty ${item.qty}`)
    );

    const name = createElement("h3", "order-item-name", product.name);
    const detail = createElement(
      "p",
      "order-item-detail",
      directBuyUrl ? `${product.format} · Instant download` : `${product.format} · Email delivery`
    );

    const remove = createElement("button", "text-button", "Remove");
    remove.type = "button";
    remove.dataset.remove = product.id;
    remove.setAttribute("aria-label", `Remove ${product.name} from order`);

    info.append(meta, name, detail, remove);

    const price = createElement(
      "strong",
      "order-item-price",
      money(product.price * item.qty)
    );

    row.append(mark, info, price);
    list.append(row);
  });

  const subtotal = document.getElementById("checkout-subtotal");
  if (subtotal) {
    subtotal.textContent = money(totals.subtotal);
  }

  payTotal.textContent = money(totals.subtotal);
  payButton.disabled = isEmpty;
  payButton.dataset.buyUrl = directBuyUrl;

  const payLabel = document.getElementById("pay-label");
  if (payLabel) {
    payLabel.textContent = isEmpty
      ? "Pay"
      : directBuyUrl
        ? "Buy on Gumroad —"
        : "Email order —";
  }

  payButton.setAttribute(
    "aria-label",
    isEmpty
      ? "Pay"
      : directBuyUrl
        ? `Buy on Gumroad — ${money(totals.subtotal)}`
        : `Email order — ${money(totals.subtotal)}`
  );

  const manualNote = document.getElementById("manual-checkout-note");
  if (manualNote) {
    manualNote.textContent = directBuyUrl
      ? "Instant checkout on Gumroad. The download link arrives right after payment."
      : "Manual checkout: we'll reply with an invoice (PayPal or bank transfer) and deliver the files within 24 hours.";
  }

  const paymentMethod = document.querySelector("[data-payment-method]");
  if (paymentMethod) {
    paymentMethod.textContent = directBuyUrl
      ? "Secure payment on Gumroad (card or PayPal)."
      : "Payment is arranged by invoice (PayPal or bank transfer).";
  }

  if (payNote) {
    payNote.hidden = true;
    payNote.textContent = "";
  }
}

function setupGlobalActions() {
  document.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add]");
    if (addButton) {
      event.preventDefault();
      if (addButton.dataset.buyUrl) {
        window.location.assign(addButton.dataset.buyUrl);
        return;
      }
      addToCart(addButton.dataset.add);
      openCart();
      return;
    }

    const openButton = event.target.closest("[data-open-cart]");
    if (openButton) {
      event.preventDefault();
      openCart();
      return;
    }

    const removeButton = event.target.closest("[data-remove]");
    if (removeButton) {
      event.preventDefault();
      removeCartItem(removeButton.dataset.remove);
    }
  });

  document.addEventListener("keydown", (event) => {
    const layer = document.getElementById("cart-layer");
    if (event.key === "Escape" && layer && !layer.hidden) {
      closeCart();
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === CART_KEY) {
      refreshCartUI();
    }
  });
}

function setupPayButton() {
  const payButton = document.getElementById("pay-button");
  if (!payButton) {
    return;
  }

  payButton.addEventListener("click", () => {
    const items = readCart();
    if (payButton.disabled || items.length === 0) {
      return;
    }

    const directBuyUrl = singleItemBuyUrl(items);
    if (directBuyUrl) {
      window.location.assign(directBuyUrl);
      return;
    }

    const paymentLink = (payButton.dataset.paymentLink || "").trim();
    if (paymentLink) {
      window.location.assign(paymentLink);
      return;
    }

    // Manual checkout: compose an invoice-request email (no payment processor is connected).
    const mailto = buildManualCheckoutUrl(items);
    const note = document.getElementById("pay-note");
    if (note) {
      note.textContent = `Opening your email app with the order summary. If nothing opens, email ${SUPPORT_EMAIL}.`;
      note.hidden = false;
      note.focus({ preventScroll: true });
    }
    if (mailto) {
      window.location.href = mailto;
    }
  });
}

function init() {
  ensureCartDrawer();
  setupGlobalActions();

  if (document.body.dataset.page === "home") {
    hydrateHome();
  } else if (document.body.dataset.page === "product") {
    renderProductPage();
  }

  refreshCartUI();
  setupPayButton();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildManualCheckoutUrl, SUPPORT_EMAIL };
}
