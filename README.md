# Unity Asset Redeemer: Free Unity Asset Store Userscript

Unity Asset Redeemer is a Tampermonkey userscript for reviewing and claiming free Unity Asset Store assets, with automatic pagination, ownership tracking and a compact slate dashboard. It runs in your browser using your signed-in Unity session and processes listing pages conservatively.

Maintained by Patrick Jr., based on the original work by CreosB. The script skips paid products and does not bypass Unity authentication or access restrictions.

Current version: **2.3.2**

[Release notes](https://github.com/PatrickJnr/Unity-Asset-Redeemer/releases/latest) · [Report a bug](https://github.com/PatrickJnr/Unity-Asset-Redeemer/issues/new/choose) · [Contributing](CONTRIBUTING.md)

## Install

A userscript is a JavaScript file that a browser extension runs on matching websites. Install a userscript manager first, then install this script through it.

[**Install Userscript**](https://raw.githubusercontent.com/PatrickJnr/Unity-Asset-Redeemer/main/Unity_Auto_Redeemer.user.js)

1. Install a userscript manager. [Tampermonkey](https://www.tampermonkey.net/) is the primary supported manager. [Violentmonkey](https://violentmonkey.github.io/) is expected to work with the standard metadata used here, but releases are validated primarily with Tampermonkey.
2. Open the **Install Userscript** link above.
3. Review the source and confirm the installation prompt.
4. Sign in at [Unity Asset Store](https://assetstore.unity.com/), open a listing page, and expand the **Unity / Auto Redeem** panel.

The script runs only on `https://assetstore.unity.com/*`. It has `@grant none`, makes same-origin requests through the signed-in Unity page, and does not include credentials.

## Features

- Detects free listing cards and excludes cards with a paid price.
- Skips cards that Unity visibly marks as owned.
- Uses Unity's existing `addToDownload` GraphQL operation with the current session and CSRF cookie.
- Validates product IDs, HTTP status, JSON, GraphQL errors, and the returned product ID before recording a claim.
- Retries temporary network, rate-limit, and server failures up to two times with bounded delays, then stops the run.
- Stops requests after a 30-second deadline covering both the response headers and body. A timed-out claim remains unconfirmed and is not automatically retried.
- Processes numbered or arrow-based pagination and waits for listing content to change.
- Stops on repeated pages, failed navigation, a configurable safety limit, or user request.
- Stores up to 20,000 confirmed owned product IDs in browser local storage.
- Provides preview, activity, searchable session history, JSON export, and local-data reset controls.
- Uses a movable, collapsible Shadow DOM dashboard with keyboard focus indicators and reduced-motion support.

## Screenshot

![Unity Asset Redeemer dashboard showing its controls and ownership summary](docs/dashboard.png)

Dashboard captured in v2.3.0. The current release is listed above.

## Usage

Open a Unity Asset Store search, category, or sale listing. The dashboard appears at the upper-right. Use **Scan page** to inspect detected free candidates without sending a claim. Enable **Preview only** and press **Start redeeming** to exercise the full page and pagination flow without claiming.

With preview disabled, **Start redeeming** processes each free candidate in sequence. **Stop** aborts the active request where possible and prevents further requests. A request already received by Unity may still complete.

**Stop** also cancels an automatic resume waiting for the next page. Manual Start and Reset local data cancel that pending resume as well. Saved delays are validated, with at least 1.5 seconds between products.

Move the dashboard with its drag handle or focus the handle and use Arrow keys. Hold Shift for larger steps; Home resets its position. Use Left/Right Arrow, Home and End to navigate the Activity and Session history tabs. The panel stays within the viewport when expanded or resized.

### Automatic pagination

**Continue across pages** is enabled by default. The script supports listing pages containing up to 96 items and searches within pagination controls for Next labels, common arrow icons or the next numbered control. It waits for changed product listings to stabilize and, when Unity displays a result range, for the advertised card count to load. Repeated pages and navigation timeouts stop the run instead of looping. Automatic resume is limited to the same listing filters.

### Ownership data

Unity-owned controls such as **Open in Unity**, **Import**, and **Download** are excluded before claiming. A successful claim or Unity's explicit already-owned response is added to a persistent local cache. Failed and unknown outcomes are not marked as owned.

The cache belongs to the browser profile, not a Unity account. If you switch Unity accounts, select **Reset local data** before running. Resetting removes only this script's local cache and current-tab history. It does not alter the Unity library.

If browser storage is blocked or full, the dashboard displays a warning. Claims may be remembered only in the current tab. An incomplete reset is reported explicitly; resolve the storage issue and retry before switching accounts.

## Automatic updates

Manage updates from **Tampermonkey's dashboard**. Select Unity Asset Redeemer there to check its installed version and update settings, and use Tampermonkey's update-check action when you want to check manually. The Unity Asset Redeemer panel on the store website handles claiming only; it has no updater.

Tampermonkey and compatible managers compare the script's semantic `@version` with the metadata served from the repository's `main` branch. `@updateURL` and `@downloadURL` both use the canonical root `.user.js` file. Update checks occur according to each manager's settings, so a published update may not appear immediately.

See [Tampermonkey's update metadata documentation](https://www.tampermonkey.net/documentation.php#meta:updateURL) for how the manager finds new versions. After updating, refresh the Unity Asset Store tab to run the new script.

Older installations named **Unity Asset Store Auto Redeemer (Fixed)** use a different name and namespace and do not contain these update URLs. Install this version, then disable or remove the older entry to prevent both scripts from running on the same page. Local ownership data uses the existing storage keys and remains available in the same browser profile and origin.

For maintainers, publish an update in this order:

1. Make and review code changes.
2. Run `npm ci` and `npm run validate`.
3. Increase `@version`, the dashboard version, `package.json`, the root versions in `package-lock.json`, and the current version in this README using semantic versioning.
4. Update `CHANGELOG.md`.
5. Run `npm run validate` again after updating versions, then commit and push to `main`.
6. Create a matching `vX.Y.Z` GitHub release.
7. Verify the raw userscript contains the new version.

Do not reuse a released version number. Use a patch for fixes, a minor version for backward-compatible features, and a major version for breaking changes.

## Troubleshooting

- **No candidates appear:** Wait for the listing to finish loading, confirm that visible cards say **Free**, and try **Scan page**. Unity markup changes may require a selector update.
- **No CSRF cookie / authentication error:** Sign in again, accept any current Unity terms, refresh the listing, and retry.
- **Rate limit or server error:** The script waits for `Retry-After` values up to 60 seconds. For longer waits or exhausted retries it stops; wait for Unity's requested interval before starting again.
- **Request times out:** The outcome is unknown. Check your Unity My Assets library before retrying. Timeouts stop the run and do not enter the confirmed-owned cache.
- **Storage warning or incomplete reset:** Check the browser's site-data permissions and available storage, then retry the reset. Do not assume a failed reset removed saved ownership history.
- **Pagination stops early:** The activity log explains whether the Next control was missing, navigation timed out, or a page repeated.
- **Assets are skipped after changing accounts:** Reset local data because the confirmed-owned cache is shared across Unity accounts in the browser profile.
- **Duplicate dashboard or requests:** Disable the previous userscript installation after migrating.

## Frequently asked questions

### Does this claim paid Unity assets for free?

No. Unity Asset Redeemer processes listings identified as free and excludes cards with paid prices. It does not unlock paid assets or bypass purchase requirements.

### Is this a Unity Editor plugin?

No. This is a browser userscript for the Unity Asset Store website. It is not a Unity package or an Editor extension.

### Do I need to leave the browser tab open?

Yes. Claiming and automatic pagination run in the Unity Asset Store tab. Keep the tab open while a run is active and use **Stop** to end it.

### Is Unity Asset Redeemer an official Unity tool?

No. This is an independently maintained project and is not affiliated with or endorsed by Unity.

## Known limitations

- Unity can change its private storefront markup or GraphQL operation without notice.
- The script depends on an authenticated browser session and readable same-origin CSRF cookie.
- Visible owned detection depends on the action labels rendered by Unity.
- The persistent ownership cache is local and account-agnostic.
- Automated tests use mocked page markup and network behavior. They do not perform live redemptions.
- Violentmonkey compatibility is not exercised by the automated test suite.
- Price and ownership detection is conservative and can skip ambiguous or unfamiliar listing markup. Scan the page and check the activity log if candidates are missing.
- Successful responses are checked for a matching product ID and absence of GraphQL errors. The existing behavior permits a missing or null entitlement; stricter entitlement checks require genuine Unity response evidence.

## Development

Node.js 20 or later is required for validation. Runtime use of the userscript has no npm dependency.

```console
npm ci
npm run validate
```

The test suite uses jsdom and a deterministic timer harness only during development. It exercises filtering, ownership detection, complete runs, cancellation, retries, request deadlines, partial page loading, storage failures, keyboard controls, ID validation and metadata. Layout tests use simulated dimensions, so they do not replace visual browser testing. GitHub Actions never contacts Unity or uses account secrets.

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## Licence and attribution

This modified derivative is licensed under [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](LICENSE). CC BY-NC-SA 4.0 is not an OSI-approved open-source licence and restricts commercial use.

CreosB created the original [Game Asset Auto Redeemer](https://github.com/creosB/Game-Asset-Auto-Redeemer). Patrick Jr. maintains this derivative. See [ATTRIBUTION.md](ATTRIBUTION.md) for provenance, modifications, and the upstream contact request. The original creator has not endorsed this fork.
