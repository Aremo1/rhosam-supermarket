# RHoSAM Supermarket — Theme Guide

## Screenshots

Screenshots are saved in the `screenshots/` directory:

### Desktop (1440×900)
| File | Description |
|---|---|
| `login.png` | Login page |
| `pos-light.png` | POS page — Light mode |
| `pos-dark.png` | POS page — Dark mode |
| `dashboard-light.png` | Dashboard — Light mode |
| `dashboard-dark.png` | Dashboard — Dark mode |
| `products-light.png` | Products — Light mode |
| `products-dark.png` | Products — Dark mode |
| `users-light.png` | User Management — Light mode |
| `users-dark.png` | User Management — Dark mode |

### Mobile (390×844 — iPhone 12/13)
| File | Description |
|---|---|
| `pos-mobile-light.png` | POS mobile — Light mode |
| `pos-mobile-dark.png` | POS mobile — Dark mode |

### Regenerate Screenshots
```bash
node screenshot-themes.js
```

---

## Color System

### CSS Variables

| Variable | Light Mode | Dark Mode |
|---|---|---|
| `--primary` | `#16a34a` | `#22c55e` |
| `--primary-dark` | `#15803d` | `#16a34a` |
| `--bg` | `#f3f6f9` | `#0f172a` |
| `--card-bg` | `#ffffff` | `#1e293b` |
| `--border` | `#e4e7ec` | `#334155` |
| `--text` | `#172033` | `#f1f5f9` |
| `--muted` | `#667085` | `#94a3b8` |
| `--danger` | `#b42318` | `#ef4444` |
| `--warning` | `#b45309` | `#f59e0b` |
| `--success` | `#15803d` | `#22c55e` |

---

## Light Mode

### POS Page Layout
```
┌─────────────────────────────────────────────────────────────┐
│  🏢 Main Store · Admin · ☀️                        [Topbar] │
├───────────────────────────────────┬─────────────────────────┤
│                                   │  🛒 Cart (2) 🗑️ Clear  │
│  🔍 Scan barcode or search...    │  ─────────────────────  │
│  Point scanner here • Press Enter │  Customer              │
│                                   │  [Walk-in Customer   ] │
│  ┌──────┐ ┌──────┐ ┌──────┐     │  [Walk-in Customer ▾ ] │
│  │ All  │ │Bev.  │ │Snack │     │                         │
│  └──────┘ └──────┘ └──────┘     │  ┌───────────────────┐  │
│                                   │  │ Coca-Cola ×1  ₦500│  │
│  Showing 8 Beverages products     │  │ Fanta ×2     ₦900│  │
│                                   │  └───────────────────┘  │
│  ┌───────────┐ ┌───────────┐     │                         │
│  │ Coca-Cola │ │ Fanta     │     │  ─────────────────────  │
│  │ BEVERAGE  │ │ BEVERAGE  │     │  Payment: [Cash ▾]     │
│  │ ₦500      │ │ ₦450      │     │  Subtotal: ₦1,400     │
│  └───────────┘ └───────────┘     │  Discount: [0    ]     │
│                                   │  Tax:      [0    ]     │
│  ┌───────────┐ ┌───────────┐     │  TOTAL: ₦1,400        │
│  │ Water     │ │ Juice     │     │  Amount: [        ]     │
│  │ BEVERAGE  │ │ BEVERAGE  │     │                         │
│  │ ₦200      │ │ ₦350      │     │  ┌───────────────────┐  │
│  └───────────┘ └───────────┘     │  │   💳 Checkout      │  │
│                                   │  └───────────────────┘  │
└───────────────────────────────────┴─────────────────────────┘
```

### Color Values (Light)
- **Background:** `#f3f6f9` (light gray)
- **Cards:** `#ffffff` (white)
- **Borders:** `#e4e7ec` (light gray)
- **Text:** `#172033` (dark navy)
- **Muted text:** `#667085` (gray)
- **Primary buttons:** `#16a34a` (green)
- **Price text:** `#16a34a` (green)
- **Category chips:** White bg, `#172033` text, green active
- **Search bar:** White bg, `#172033` text, green border on focus
- **Cart panel:** White bg, `#172033` text
- **Checkout button:** Green bg, white text

---

## Dark Mode

### POS Page Layout
```
┌─────────────────────────────────────────────────────────────┐
│  🏢 Main Store · Admin · ☀️                        [Topbar] │
│  (bg: #1e293b, border: #334155)                             │
├───────────────────────────────────┬─────────────────────────┤
│                                   │  🛒 Cart (2) 🗑️ Clear  │
│  🔍 Scan barcode or search...    │  (bg: #1e293b)          │
│  (bg: #0f172a, text: #f1f5f9)    │  ─────────────────────  │
│                                   │  Customer              │
│  ┌──────┐ ┌──────┐ ┌──────┐     │  [Walk-in Customer   ] │
│  │ All  │ │Bev.  │ │Snack │     │  (bg: #0f172a)         │
│  │(grn) │ │      │ │      │     │                         │
│  └──────┘ └──────┘ └──────┘     │  ┌───────────────────┐  │
│  (chips: #1e293b bg)             │  │ Coca-Cola ×1  ₦500│  │
│                                   │  │ (bg: #0f172a)     │  │
│  Showing 8 Beverages products     │  └───────────────────┘  │
│  (text: #94a3b8)                  │                         │
│                                   │  ─────────────────────  │
│  ┌───────────┐ ┌───────────┐     │  Payment: [Cash ▾]     │
│  │ Coca-Cola │ │ Fanta     │     │  Subtotal: ₦1,400     │
│  │ (bg:#1e293b)│(bg:#1e293b)│   │  (text: #f1f5f9)       │
│  │ text:#f1f5f9│text:#f1f5f9│   │                         │
│  │ ₦22c55e   │ │ ₦22c55e   │     │  TOTAL: ₦1,400        │
│  └───────────┘ └───────────┘     │  (font-weight: 800)     │
│                                   │                         │
│  ┌───────────┐ ┌───────────┐     │  ┌───────────────────┐  │
│  │ Water     │ │ Juice     │     │  │   💳 Checkout      │  │
│  │ (bg:#1e293b)│(bg:#1e293b)│   │  │ (bg: #22c55e)     │  │
│  │ ₦22c55e   │ │ ₦22c55e   │     │  └───────────────────┘  │
│  └───────────┘ └───────────┘     │                         │
└───────────────────────────────────┴─────────────────────────┘
```

### Color Values (Dark)
- **Background:** `#0f172a` (very dark blue)
- **Cards:** `#1e293b` (dark blue-gray)
- **Borders:** `#334155` (medium blue-gray)
- **Text:** `#f1f5f9` (near white)
- **Muted text:** `#94a3b8` (light gray)
- **Primary buttons:** `#22c55e` (bright green)
- **Price text:** `#22c55e` (bright green)
- **Category chips:** `#1e293b` bg, `#e2e8f0` text, `#16a34a` active
- **Search bar:** `#0f172a` bg, `#f1f5f9` text, `#4ade80` focus ring
- **Cart panel:** `#1e293b` bg, `#f1f5f9` text
- **Checkout button:** `#22c55e` bg, white text

---

## Component Reference

### Category Chips
| State | Light | Dark |
|---|---|---|
| Default | White bg, `#172033` text, `#e4e7ec` border | `#1e293b` bg, `#e2e8f0` text, `#475569` border |
| Hover | Green border, green text | Green border, green text |
| Active | `#16a34a` bg, white text | `#16a34a` bg, white text |

### Product Cards
| State | Light | Dark |
|---|---|---|
| Default | White bg, `#172033` text | `#1e293b` bg, `#f1f5f9` text |
| Hover | Green border, shadow | Green border, shadow |
| Out of stock | `#fef2f2` bg, 45% opacity | `rgba(239,68,68,0.1)` bg |

### Cart
| Element | Light | Dark |
|---|---|---|
| Panel | White bg | `#1e293b` bg |
| Items | White bg | `#0f172a` bg |
| Quantity btns | White bg, `#172033` text | `#1e293b` bg, `#e2e8f0` text |
| Summary inputs | White bg | `#0f172a` bg |
| Checkout | `#16a34a` bg, white text | `#22c55e` bg, white text |

### Status Badges
| Status | Light | Dark |
|---|---|---|
| Active | `#dcfce7` bg, `#15803d` text | `rgba(34,197,94,0.15)` bg, `#4ade80` text |
| Inactive | `#fee2e2` bg, `#b91c1c` text | `rgba(239,68,68,0.15)` bg, `#f87171` text |
| Warning | `#fef3c7` bg, `#92400e` text | `rgba(245,158,11,0.15)` bg, `#fbbf24` text |
| Info | `#e0f2fe` bg, `#075985` text | `rgba(14,165,233,0.15)` bg, `#38bdf8` text |

### Tier Badges
| Tier | Light | Dark |
|---|---|---|
| Bronze | `#fef3c7` bg, `#92400e` text | `rgba(251,146,60,0.15)` bg, `#fb923c` text |
| Silver | `#f1f5f9` bg, `#475569` text | `rgba(148,163,184,0.15)` bg, `#94a3b8` text |
| Gold | `#fef9c3` bg, `#a16207` text | `rgba(251,191,36,0.15)` bg, `#fbbf24` text |
| Platinum | `#ede9fe` bg, `#6d28d9` text | `rgba(167,139,250,0.15)` bg, `#a78bfa` text |

---

## How to Toggle Themes

1. Click the **☀️/🌙** button in the top-right corner
2. Theme persists in `localStorage` under key `rhosam-theme`
3. Applies `dark` class to `<body>` element

## Mobile Breakpoints

| Breakpoint | Layout Changes |
|---|---|
| ≤900px | POS: single column, smaller chips |
| ≤550px | POS: 2-col grid, horizontal scroll chips, compact cart |

---

## Verification Checklist

### Light Mode
- [ ] Background is light gray (`#f3f6f9`)
- [ ] Cards are white
- [ ] Text is dark (`#172033`)
- [ ] Primary color is green (`#16a34a`)
- [ ] Borders are light gray (`#e4e7ec`)
- [ ] Error messages have light red background

### Dark Mode
- [ ] Background is very dark blue (`#0f172a`)
- [ ] Cards are dark blue-gray (`#1e293b`)
- [ ] Text is near white (`#f1f5f9`)
- [ ] Primary color is bright green (`#22c55e`)
- [ ] Borders are medium blue-gray (`#334155`)
- [ ] Error messages have dark red tint

### Mobile
- [ ] Category filter is horizontally scrollable
- [ ] Product grid shows 2 columns
- [ ] Cart is compact
- [ ] Checkout button is full-width
- [ ] Receipt actions stack vertically
