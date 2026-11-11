# Security

This connector is intentionally small so it can be audited.

## Invariants

- No private key material enters DeWEB.
- The site is identified by its frame URL, never by a renderer-provided string.
- The wallet window is sandboxed and context-isolated.
- The wallet request has a finite timeout.
- Responses are matched to the original request id and the wallet window sender.

## Reporting

Report issues privately to the maintainer. Do not include live wallet secrets in a report.
