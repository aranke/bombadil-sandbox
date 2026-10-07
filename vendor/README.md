# Pinned Bombadil source

Source: https://github.com/antithesishq/bombadil
Release: [Bombadil 0.7.8](https://github.com/antithesishq/bombadil/releases/tag/v0.7.8).
Commit: 0ca926a778966bb5cba2d59ed68da3318b12ded9 (2026-10-01).

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
