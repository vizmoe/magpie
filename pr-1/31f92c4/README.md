# Search API key review

Source revision: `31f92c4327f33ac66280ea0112ba070fdbf2ceba`.
Base revision: `bd0f3382827e4eedb2478773d5f67107ec0eac0a`.
Draft: https://github.com/vizmoe/magpie/pull/1
Primary issue: https://github.com/yetone/magpie/issues/4597

These screenshots use the actual Settings assets and Go HTTP handler in an isolated temporary configuration. All keys are demonstration values. Tavily usage is served by a local stub; no real vendor account is involved. The source-only overlay that starts this preview is kept with the local review artifacts and is not part of the product diff. The preview servers have stopped at their 25-minute safety deadline; their fixture-expiry exit is not a product test result.

| Image | What to review |
| --- | --- |
| `01-before-keys.png` | Unchanged base: Tavily's quota lines, an empty Exa key section, and no individual controls for Brave's single key. |
| `02-after-keys.png` | Updated cards for Tavily, Exa, and Brave; Copy/pencil controls, individual removal, quota/rest details, and Add another key. |
| `03-inline-edit.png` | Only the selected Exa key becomes a password input. The other key remains in place. |
| `04-bulk-add.png` | Paste several with two demonstration keys, a live count, Cancel, and Add. |
| `05-quota-loading.png` | All saved Tavily keys and management controls remain while usage loads. |
| `06-quota-failure.png` | A failed usage request updates the status without removing the keys or their controls. |
| `07-narrow.png` | 420×1000 viewport, filtered through Settings' Find a setting field to Keys of Tavily, showing wrapping and all controls during a quota error. |

The first two images are simple crops of the captured Web search block. Desktop detail images are element captures. The narrow image is a viewport capture. No UI content has been altered for these images.

A real-handler browser exercise replaced the first Exa key without changing its second, then appended two keys and read back the expected four-key list from `/api/settings`.

Verification at the source revision:

- Affected Go tests and GUI structural guards passed with isolated configuration.
- All 68 search browser cases passed in Chromium/WebKit. The expanded set passed 86/87; the remaining pre-existing i18n ownership failure is tracked at https://github.com/yetone/magpie/issues/5327 and https://github.com/yetone/magpie/issues/5332.
- Repository-wide vet and builds passed for Darwin/arm64, Linux/arm64 (`nogui`), and Windows/arm64. Builds/vet do not establish runtime behavior on Linux or Windows.
- No full Go suite pass or real-vendor integration coverage is claimed. Full commands and earlier full-suite limitations are in the draft description.
