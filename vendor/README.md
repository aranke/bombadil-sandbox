# Pinned Bombadil source

Source: https://github.com/antithesishq/bombadil
Commit: b8bc4a658abc5933c84d1afb9fff1ce24e05520f (2026-09-14).

`bombadil-ltl/src/{eval,formula,syntax,stop,violation}.rs` are unchanged upstream files.
The local crate manifest/lib entrypoint omit workspace integration and upstream test modules.
`bombadil-api/{index,internal,actions}.ts` are unchanged upstream specification API files.
These files are MIT licensed; see LICENCE. The playground adapter is separate.

`bombadil-schema/src/{schema,markup,duration}.rs` and `stdx/src/tree.rs` are unchanged
upstream files from the same commit. They provide Bombadil's own violation
message renderer. Their manifests and lib entrypoints include only the modules
needed here; upstream tree tests requiring Hegel are disabled. The runtime
converts its browser domain to the upstream schema and serializes the renderer's
markup for display, preserving its text, formulas, timestamps, and snapshots.
