# Test Workspace

This workspace is automatically opened when you press F5 to test the Comline VSCode extension.

## Files

- **user.ids** - User authentication and profile management
- **product.ids** - E-commerce product catalog and orders
- **messaging.ids** - Real-time messaging system

## Testing Features

### Syntax Highlighting
All keywords, types, and constructs should be properly colored.

### LSP Features to Test

1. **Document Outline** (Ctrl+Shift+O)
   - See all structs, enums, and protocols

2. **Hover Information**
   - Hover over type names to see definitions

3. **Auto-Completion** (Ctrl+Space)
   - Type `struct` and see suggestions
   - Inside struct bodies, type field types

4. **Go to Definition** (F12)
   - Click on a type reference like `UserRole` in user.ids
   - Should jump to the enum definition

5. **Find References** (Shift+F12)
   - Right-click on `User` struct
   - See all places it's referenced

6. **Diagnostics**
   - Try adding a syntax error (e.g., `struct Test {`)
   - Should see red squiggly underline

## Add Your Own

Feel free to add more `.ids` files here to test with your own schemas!
