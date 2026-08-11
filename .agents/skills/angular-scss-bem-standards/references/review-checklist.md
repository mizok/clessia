# Angular SCSS + BEM Review Checklist

Use this checklist after creating or refactoring component styles.

## 1) Component Structure & Scope

- [ ] **Root Class**: Root element has a class matching component name (e.g. `LoginComponent` -> `.login`).
- [ ] **Single Root**: Template has one top-level block container.
- [ ] **Strict Block Inclusion**: Functional blocks (e.g. `.form`) explicitly wrap their children; no orphan elements.
- [ ] **Shared Block Extraction**: Generic layouts use dedicated blocks (`.auth-layout`), not component-specific namespaces (`.public-shell__...`).

## 2) Block Scope

- [ ] Define exactly one primary block for the component.
- [ ] Match block intent to component responsibility.
- [ ] Keep block naming in kebab-case.

Fix pattern:

- If two unrelated blocks appear in one component, split into child components.

## 3) Element and Modifier Naming

- [ ] Use `block__element` for internal parts.
- [ ] Use `block--modifier` or `block__element--modifier` for variants.
- [ ] Keep base class present when applying modifiers.
- [ ] Avoid presentational element names (`left`, `red`, `big`).

Fix pattern:

- Rename positional names to semantic names (`left` -> `actions`, `title-row` -> `header`).

## 4) Selector Architecture

- [ ] **Prefer SCSS Nesting**: Use `&__element` and `&--modifier` to reference the parent block.
- [ ] **Contextual Overrides**: Use parent selectors (`&__header &__logo`) for context-specific styling instead of deep nesting.
- [ ] **Compiled Flatness**: Ensure the *compiled* CSS remains flat (single class specificity) for standard elements.
- [ ] Allow descendant selectors only up to one level (`.block__a .block__b`) or via `&` overrides.
- [ ] Do not chain descendants beyond one level (`.block__a .block__b .block__c`).
- [ ] Allow `>`, `+`, `~` only within the same block context and one level.
- [ ] Avoid tag-qualified selectors (`div.block`) and id selectors for component styling.

Fix pattern:

- Convert flat selectors (`.block__element`) to nested parent selectors (`&__element`).
- Use `&__context &__target` pattern for positional overrides.

## 5) Nesting Depth

- [ ] Do not create `block__element__subelement`.
- [ ] Keep SCSS nesting shallow and readable.
- [ ] Split child UI sections into separate components when context depth grows beyond one descendant level.

Fix pattern:

- Extract reusable section into a child component with its own block.

## 6) Token and Value Discipline

- [ ] Use design tokens for spacing, colors, radius, and typography.
- [ ] Avoid hard-coded spacing/color values unless explicitly approved.
- [ ] Preserve project spacing scale.

Fix pattern:

- Replace literal values with `var(--space-*)`, `var(--color-*)`, `var(--radius-*)`.

## 7) Angular Binding Pattern

- [ ] Apply modifiers using class bindings where state-driven.
- [ ] Keep state names consistent between TS signal/computed names and class modifiers.
- [ ] Do not let structural control flow change class naming logic.

Fix pattern:

- Move state-to-class logic into explicit bindings, not selector side effects.

## 8) Completion Gate

Approve only when all checks pass or each failing check has an explicit reason and follow-up action.
