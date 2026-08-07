- Document schema-authoring support for per-field `example` values, because zTracker already uses `example` data for the `EXAMPLE OF A PERFECT RESPONSE` block and excludes it from the prompt schema block. If broader schema compatibility is needed later, evaluate whether to support `examples` in addition to the existing singular `example` field and define precedence explicitly.
	Acceptance criteria:
	- Add a short maintainer-facing note that `example` is consumed by the example-rendering path, not the prompt schema path.
	- Clarify whether `example`, `examples`, or both are considered supported schema metadata going forward.
	- If `examples` support is added, define precedence and add regression coverage for JSON, XML, and TOON prompt generation.