# Texas Cannabis Company -- static export

Static copy of the public pages from txcannabiscompany.com, captured after
losing access to the original hosting account. 125 pages
and 196 images/assets, with internal links and image
paths rewritten to work locally / on GitHub Pages.

## What's included
- Every public page: homepage, brand pages, categories, products, blog posts
- All product/theme images, referenced with local relative paths
- Sign In / Register links removed from the header
- "Can Use Coupon" badges removed from product listings

## What's NOT included / won't work
- Add to Cart, Checkout, Login, Search, Order Status still link back to the
  original txcannabiscompany.com -- a static export has no backend
  (database, payment processing), so real orders can't be placed from this
  copy without a real e-commerce platform behind it.
- Anything that lived only in the BigCommerce admin (customer accounts,
  order history, unpublished drafts, inventory) -- that requires recovering
  the actual account.

## Regenerating
Source scrape lives in `site-backup/` (raw). Run `python build_public_site.py`
to regenerate this folder from it after re-running `python backup_site.py`.
