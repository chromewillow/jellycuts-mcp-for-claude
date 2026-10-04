# Install flow: findings and plan

Status: research done for 5 topics; fact-checking finished for 1 of 5 (URL scheme) before the run was stopped to save tokens. Items marked "unverified" were not independently confirmed. No main files have been changed.

## What we found

**"Open Jellycuts" does nothing**
- `jellycuts://` is the correct and only URL scheme (confirmed in the open-source app). It only launches the app; there is no path that imports or creates a script.
- Likely cause: the Claude app's in-app browser does not pass custom-scheme links to iOS. Unverified: real SFSafariViewController allows them on a tap, so the Claude browser is probably a WKWebView.
- In Safari, tapping the link should show "Open in Jellycuts?".

**Jellycuts missing from the share sheet**
- Jellycuts has no Share Extension (open-source build), so it will not appear. The page cannot fix this.
- WebKit ignores the `text/plain` MIME type and uses the file extension; `.jelly` is already right. Changing type or extension will not help.
- Jellycuts' in-app "+ → Add File" accepts `.jelly` / `.txt` from the Files app (open-source build; unverified in the App Store build).

**Limits that cannot be automated**
- No URL, Shortcuts action or file hand-off creates a Jellycut from code. The developer closed that request as not planned.
- Jellycuts must build and sign; the user must tap Add Shortcut.
- Jellycuts' own Shortcuts actions (grabJellycut, importShortcut, importObjects) do not take Jelly code.
- Jellycuts Bridge: not worth it. The app connects over plain `ws://` only, it needs Pro, and users reported it broken in 2024.

## Try today (no code changes)
1. Open the install link, tap the compass icon to open it in Safari, then tap Copy code and Open Jellycuts.
2. Or: Share file… → Save to Files, then in Jellycuts tap + → Add File and pick the `.jelly` file.
3. In Shortcuts, tap + and search "Jellycuts" to see which actions the App Store app really has.

## Suggested install-page changes (src/pages.ts; not done yet)
1. Detect an in-app browser (iPhone user agent without `Safari/`) and show a banner: "Tap the compass icon to open in Safari."
2. Merge Copy code + Open Jellycuts into one "Copy & open Jellycuts" button (copy inside the tap, then navigate to `jellycuts://`).
3. If the page is still visible about 2 seconds after the tap, show "Didn't open? The code is copied — open Jellycuts yourself."
4. Rename "Share file…" to "Save to Files" with the Add File steps; hide "Download .jelly file" in in-app browsers (blob downloads fail there).

Best realistic flow after these changes: tap link → open in Safari → Copy & open → paste into a new Jellycut → Build → Add Shortcut.
