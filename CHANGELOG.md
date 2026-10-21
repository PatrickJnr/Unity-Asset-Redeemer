# Changelog

All notable changes to Unity Asset Redeemer are documented here. Versions follow semantic versioning.

## [2.3.1] - 2026-10-21

### Fixed

- Reject conflicting free and paid price labels and prevent fallback scanning from bypassing owned-card checks.
- Reject GraphQL responses containing errors even if they include a matching product ID.
- Avoid treating generic already-exists errors as confirmed ownership.
- Stop after transient failures exhaust retries, or when Unity requests a wait longer than 60 seconds.
- Detect repeated listing content even when the page URL changes.

## [2.3.0] - 2026-10-21

### Added

- Add GitHub-hosted automatic update and download metadata.
- Add offline validation for metadata, filtering, ownership detection, duplicate IDs, response errors, retry timing, pagination guards, storage reset and product IDs.
- Add project documentation, contribution guidance, attribution, issue templates and GitHub Actions validation.

### Improved

- Retry transient browser network failures using the existing bounded retry policy.
- Parse both delay-seconds and HTTP-date forms of `Retry-After`, capped at 60 seconds.
- Validate that Unity's successful GraphQL response identifies the requested product.
- Treat HTTP 419 as an expired authentication or CSRF session.

### Fixed

- Remove the unprofessional legacy metadata identity and establish Patrick Jr. as maintainer while preserving CreosB's original authorship credit.

### Removed

- Remove the phrase describing the maintained version as a local repair.

### Known Issues

- Unity storefront markup and its private GraphQL operation can change without notice.
- Persistent ownership history is local to the browser profile and is not separated by Unity account.
- Live Unity redemption is not covered by automated tests.

[2.3.1]: https://github.com/PatrickJnr/Unity-Asset-Redeemer/releases/tag/v2.3.1
[2.3.0]: https://github.com/PatrickJnr/Unity-Asset-Redeemer/releases/tag/v2.3.0
