// Minimum order total (USD) for free shipping. Below this, the customer
// chooses: add more items to reach it, or pay the flat SHIPPING_FEE below
// to place the order as-is.
window.MINIMUM_ORDER_TOTAL = 100;

// Flat shipping fee (USD) charged when the customer opts to place an order
// under the free-shipping minimum instead of adding more items.
window.SHIPPING_FEE = 20;

// Shown under every payment method once selected: there's no automated order
// confirmation, so this email address is how an order actually gets
// completed -- the customer sends proof of payment here. Leave "" until you
// give me the real address -- shows a "coming soon" placeholder until then.
window.PAYMENT_PROOF_EMAIL = "wfcannabisco@gmail.com";

// Shown next to the email as a "Call or Text Us" option (cart page) and as
// the business's general contact number (footer, Contact Us page).
window.PAYMENT_PROOF_PHONE = "+1 (332) 287-4921";

// Edit this file to add real payment details, then re-run build_public_site.py.
//
// Two kinds of entries:
//   - address-based (Bitcoin, USDT): set "address" and the cart shows it directly.
//   - contactEmail-based (Cash App, Chime): set "contactEmail" and the cart shows
//     an "Email us to pay" link instead of an address, so the customer reaches
//     out to complete payment. Leave contactEmail as "" until you give me the
//     real address -- it shows a "coming soon" placeholder until then.
window.PAYMENT_METHODS = [
  {
    id: "bitcoin",
    label: "Bitcoin",
    address: "bc1q0fd8xuhdcwtzpe2n69y8qwhrg63v7mp68xcvgc",
    instructions: "Send the exact BTC amount for your order total to the address above."
  },
  {
    id: "cashapp",
    label: "Cash App",
    contactEmail: "wfcannabisco@gmail.com",
    instructions: "Email us to pay with Cash App."
  },
  {
    id: "chime",
    label: "Chime",
    contactEmail: "wfcannabisco@gmail.com",
    instructions: "Email us to pay with Chime."
  },
  {
    id: "usdt",
    label: "USDT (ERC20)",
    address: "0xf28d892f4c955bb26622486afb61660dda242ca0",
    instructions: "Send USDT on the Ethereum (ERC20) network ONLY to the address above. Sending on any other network (TRC20, BEP20, etc.) may result in permanently lost funds."
  }
];
