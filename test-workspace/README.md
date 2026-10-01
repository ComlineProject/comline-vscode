# Test Workspace

This workspace is automatically opened when you press F5 to test the Comline VSCode extension.

## Files

Pulled from [`ComlineProject/examples`](https://github.com/ComlineProject/examples),
the same corpus the playground tests against — real, parser-valid schemas,
not illustrative pseudocode.

- **chat.ids** + **types.ids** — a small chat protocol split across two
  files (`chat.ids` has `use types::Message`), good for exercising
  cross-file hover/go-to-definition specifically.
- **keyvalue.ids** — a single-file key/value store with docstrings and an
  `error`-typed failure case.
- **config.idp** + **config_with_deps.idp** — package/congregation config
  files (pulled from `core`'s own parser test fixtures), good for exercising
  `.idp` syntax highlighting: nested dictionaries, lists, the three "special
  key" forms (`name@version`, `name#version`, `a::b::c`), and comments.

## Testing Features

### Syntax Highlighting
All keywords, types, and constructs should be properly colored in both
`.ids` and `.idp` files.

### LSP Features to Test

1. **Document Outline** (Ctrl+Shift+O)
   - See all structs, enums, and protocols

2. **Hover Information**
   - Hover over type names to see definitions

3. **Auto-Completion** (Ctrl+Space)
   - Type `struct` and see suggestions
   - Inside struct bodies, type field types

4. **Go to Definition** (F12)
   - Click on `Message` in `chat.ids`'s `function send(...) -> Message ! Rejected;`
   - Should jump to `struct Message` in `types.ids` — a *different file*

5. **Find References** (Shift+F12)
   - Right-click on `struct Entry` in `keyvalue.ids`
   - See all places it's referenced

6. **Diagnostics**
   - Try adding a syntax error (e.g., `struct Test {`)
   - Should see red squiggly underline

## Add Your Own

Feel free to add more `.ids` files here to test with your own schemas!
