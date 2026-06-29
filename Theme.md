# PhysioAI — Theme & Design Tokens

Single reference for the app's visual theme (colors, fonts, sizes, radii, shadows).
**Aesthetic:** warm clinical — cream canvas · sage/deep-green brand · soft warm ink.

> **Sources of truth (edit these, not this doc):**
> - **Therapist web:** [`shared/assets/theme.css`](shared/assets/theme.css) — CSS variables on `:root`.
> - **Patient-facing app:** [`apps/patient/styles.css`](apps/patient/styles.css) — CSS variables on `:root`; [`apps/patient/app.js`](apps/patient/app.js) also contains score tone constants.

---

## Brand Palette

| Token | Hex | Use |
|---|---|---|
| Sage | `#7BA88F` | Therapist primary / patient accent |
| Deep green | `#2F5D50` | Patient primary / deep brand accent |
| Cream | `#F5F1E8` | App background |
| White | `#FFFFFF` | Surfaces |
| Warm ink | `#2A2823` / `#1F2937` | Primary text |

---

## Fonts

| Role | Family | Where |
|---|---|---|
| Wordmark | Gabarito | Therapist web |
| UI / Latin | Inter Tight | Therapist web |
| Thai | IBM Plex Sans Thai | Therapist web |
| Numbers / mono | JetBrains Mono | Therapist web |
| Patient UI | System UI stack with Thai fallbacks | Patient-facing app |

---

## Therapist Web Theme

Core variables in `shared/assets/theme.css`:

| Var | Value |
|---|---|
| `--bg` | `#F5F1E8` |
| `--surface` | `#FFFFFF` |
| `--surface2` | `#EDE7D9` |
| `--surface3` | `#DDD5C2` |
| `--ink` | `#2A2823` |
| `--ink2` | `#6B655A` |
| `--brand` | `#7BA88F` |
| `--brand-deep` | `#2F5D50` |
| `--good` | `#7BA88F` |
| `--warn` | `#C8955A` |
| `--bad` | `#B86C5A` |

---

## Patient Web Theme

Core variables in `apps/patient/styles.css` and matching score colors in `apps/patient/app.js`:

| Var / token | Value |
|---|---|
| `--bg` | `#F5F1E8` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#FAF7F0` |
| `--surface-3` | `#EFE9DD` |
| `--ink` | `#1F2937` |
| `--ink-2` | `#6B7280` |
| `--brand` | `#2F5D50` |
| `--accent` | `#7BA88F` |
| `--good` | `#2F5D50` |
| `--warn` | `#9C7344` |
| `--bad` | `#8C4F40` |

---

## Where To Change Things

- **Therapist colors/radii/shadows/fonts** → `shared/assets/theme.css`.
- **Patient-facing colors/layout** → `apps/patient/styles.css`; score tone constants → `apps/patient/app.js`.
- **Logo assets** → `shared/assets/` and any patient-facing assets added alongside `apps/patient/`.
