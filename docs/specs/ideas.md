- Document schema-authoring support for per-field `example` values, because zTracker already uses `example` data for the `EXAMPLE OF A PERFECT RESPONSE` block and excludes it from the prompt schema block. If broader schema compatibility is needed later, evaluate whether to support `examples` in addition to the existing singular `example` field and define precedence explicitly.
	Acceptance criteria:
	- Add a short maintainer-facing note that `example` is consumed by the example-rendering path, not the prompt schema path.
	- Clarify whether `example`, `examples`, or both are considered supported schema metadata going forward.
	- If `examples` support is added, define precedence and add regression coverage for JSON, XML, and TOON prompt generation.

- Capture a reproducible tracker-generation prompt-assembly bug if speaker attribution is still being lost during `conversation role handling`, instead of assuming the role-normalization step is the root cause. Record one concrete failing case with API mode, prompt-engineering mode, conversation-role mode, sample messages, expected prompt fragment, and actual prompt/debug snapshot before deciding where the fix belongs.
	Acceptance criteria:
	- Reproduce the issue with one saved failing fixture or request snapshot.
	- Identify whether the loss happens in host prompt construction, role normalization, sanitization, or text-completion story-string wrapping.
	- Add a focused regression test at the owning layer before changing runtime code.
	- Only file a code-fix task once the failing layer and desired output are both explicit.