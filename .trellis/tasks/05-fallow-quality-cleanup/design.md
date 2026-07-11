# Design

Run Fallow's three analyzers independently so each finding retains its native evidence. Trace dead-code and clone findings before editing. Prefer removing genuinely unreachable API surface, extracting shared helpers for clones, and decomposing complex functions along existing module boundaries. Do not alter `.fallowrc*`, `fallow.toml`, or add `fallow-ignore` / `@expected-unused` markers.

Refactors must preserve public protocol, parsing, navigation, persistence, and rendering behavior. Tests remain the behavioral backstop. Re-run Fallow after each cleanup group because deleting or extracting code can expose new findings.

The final quality contract is: full reports clean, changed-code audit clean, standard repository gates clean, performance acceptance unchanged. Add the pre-PR Fallow requirement to the owning Trellis quality spec.
