---
name: angular-scss-bem-standards
description: Use when writing, reviewing, or refactoring Angular component styles (SCSS/CSS). Triggers on BEM naming issues, deep nesting, non-flat selectors, or hard-coded values instead of design tokens.
---

# Angular SCSS BEM Standards

## Overview

Use this skill to keep component styles predictable, reusable, and easy to review.
Prefer component-scoped BEM classes and keep selectors flat by default.

## Workflow

1. Identify the component selector and define one block name.
2. Map required elements and modifiers before editing template or style files.
3. Implement classes in template first, then write SCSS with flat selectors.
4. Validate against the checklist in `references/review-checklist.md`.
5. If selector context needs more than one descendant level, split into child components.

## Component Structure & Scope

1. **Root Class Naming**: The root element of the component template MUST have a class that matches the component name (kebab-case).
   - Example: `LoginComponent` -> `<div class="login ...">`
   - Rationale: Facilitates debugging, testing, and strict BEM scoping.
2. **Single Root Element**: Wrap the entire component template in a single root element acting as the Block container.
3. **Strict Block Inclusion**: Global/Shared blocks (e.g. `.form`) MUST explicitly wrap their elements (e.g. `.form__input`).
   - Invalid: `<input class="form__input">` (Orphan element)
   - Valid: `<div class="form"><input class="form__input"></div>`
4. **No Namespace Pollution**: Do not use a specific component's class to style generic content in another component. Create a dedicated global block instead.
    - Invalid: `<div class="login public-shell__form-wrapper">` (Login depends on Shell implementation)
    - Valid: `<div class="login auth-layout">` (Both use a generic `.auth-layout` block)

## Core Rules

1. Use one BEM block per component and keep the block name stable.
2. **Prefer SCSS Nesting with Parent Selector (`&`)**:
   - Use `&__element` and `&--modifier` to keep the Block name DRY.
   - Example: `.card { &__title { ... } }` compiles to `.card__title`.
3. **Compiled CSS must be flat**: The goal is single-class specificity in the output CSS, not necessarily flat SCSS source code.
4. Keep nesting depth to two levels in naming; do not create `block__element__sub`.
5. **Contextual Overrides**: Use parent selectors for context-specific overrides within the same block scope.
   - Valid: `&__header &__logo { ... }` (Target `&__logo` only when inside `&__header`)
   - This allows styling components based on their placement without deep nesting.
6. Do not chain descendants beyond one level (for example `.block__a .block__b .block__c` is invalid).
7. Allow `>`, `+`, `~` when used within the same block context and kept to one level.
8. Avoid tag-qualified selectors and id selectors for component styling.
9. Use modifiers for variants and states; keep base class present at the same time.
10. Use global design tokens (for example `var(--space-*)`, `var(--color-*)`) instead of hard-coded values.
11. Keep component styles in `*.component.scss`; do not move feature-specific styles to global files.

## Angular Integration Rules

1. Bind modifiers with class bindings, for example `[class.card--active]="isActive()"`.
2. Keep template class names semantic and aligned with BEM map.
3. Prefer modifier classes first; use one-level descendant selectors or contextual overrides only when necessary.
4. Use Angular native control flow (`@if`, `@for`, `@switch`) without changing class semantics.

## Contextual Overrides Pattern

Use this pattern to style an element differently based on its container within the same Block, avoiding new modifier classes for every positional tweak.

Valid:

```scss
.card {
  &__header {
    display: flex;
    align-items: center;
  }

  // Contextual Override: Logo inside Header
  &__header &__logo {
    margin-right: var(--space-4);
    height: 32px;
  }

  // Standard Element
  &__logo {
    height: 48px;
  }
}
```

Invalid (Deep Nesting):

```scss
.card {
  &__header {
    // Bad: deeply nested selector
    .card__logo {
      ...
    }
  }
}
```

## Output Contract

When implementing or refactoring, produce:

1. A short class map (`block`, `elements`, `modifiers`).
2. Updated template snippets with BEM classes.
3. Updated SCSS snippets using flat BEM selectors.
4. A checklist result that marks pass/fail items from `references/review-checklist.md`.

## References

Use these references when needed:

1. `references/review-checklist.md` for review criteria and fix patterns.
