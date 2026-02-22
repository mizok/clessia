# MoneyGoWhere Development Guidelines

## Communication

- Use Traditional Chinese (繁體中文) for all conversations

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Angular 21+, TypeScript 5.9, SCSS, Angular Signals |
| Backend | Java 17, Spring Boot 3.2.1, Spring Data JPA, Spring Security |
| Database | MySQL 8.0, Flyway migrations |
| Testing | Vitest + Testing Library, Playwright (Frontend), JUnit (Backend) |
| Icons | Google Material Symbols (Outlined) |

---

## Project Structure

```text
apps/
├── api/                    # Spring Boot Backend
└── web/                    # Angular Frontend

specs/
├── system/                 # System-level specifications
│   ├── architecture.md     # Architecture decisions
│   ├── design-system.md    # Design system specification
│   └── testing-strategy.md # Testing strategy
├── features/               # In-progress feature specs
├── canonical/              # Final specs (Source of Truth)
└── changelog/              # Specification change logs
```

---

## Specification Rules

### Single Source of Truth

- `specs/canonical/` contains the authoritative specification for all completed features
- When in doubt about system behavior, refer to `specs/canonical/`

### Specification Workflow

1. New features: Create spec in `specs/features/[name]/`
2. Use speckit: `/speckit.specify` → `/speckit.plan` → `/speckit.tasks`
3. After completion: `/speckit.integrate` to merge into `specs/canonical/`
4. Locked specs require change request via `specs/changelog/`

### Before Making Changes

- [ ] Read relevant `specs/canonical/` files
- [ ] Check for conflicts with existing specs
- [ ] If conflict exists, discuss before proceeding

---

## Development Workflow

### TDD Required

All code must follow Test-Driven Development:

1. **Red** - Write failing test first
2. **Green** - Write minimal code to pass
3. **Refactor** - Clean up while keeping tests green

### Frontend Development

- Every Component must have tests (coverage > 80%)
- Use Design System components from `specs/system/design-system.md`
- Follow page specifications in `specs/canonical/` or `specs/features/`

### Backend Development

- Existing code preserved, validate with TDD
- API contracts defined in `specs/system/api-contracts.md`

---

## Testing Requirements

| Level | Tool | Purpose |
|-------|------|---------|
| Unit | Vitest | Service logic, pure functions |
| Component | Testing Library | Component rendering, interactions |
| E2E | Playwright | Complete user flows |
| Visual | Playwright | Screenshot comparison |

### Definition of Done

- [ ] All tests pass
- [ ] Manual acceptance completed
- [ ] Spec integrated to `specs/canonical/`
- [ ] Changelog recorded

---

## Commands

```bash
# Frontend
cd apps/web
npx nx test web              # Run frontend tests
npx nx serve web             # Start dev server

# Backend
cd apps/api
mvn test                     # Run backend tests
mvn spring-boot:run          # Start server

# i18n
npm run i18n:check           # Verify translation consistency
```

---

## Internationalization (i18n)

- **Library**: ngx-translate (`@ngx-translate/core`, `@ngx-translate/http-loader`)
- **Languages**: `zh-TW` (Traditional Chinese), `en-US` (English)
- **Files**: `apps/web/src/assets/i18n/{lang}.json`

### Key Conventions

- Dot-notation: `namespace.section.key`
- camelCase: `expenses.form.descriptionPlaceholder`
- Namespaces: `common`, `nav`, `auth`, `groups`, `activities`, `expenses`, `feeTemplates`, `dashboard`, `profile`, `errors`, `calculation`, `accessibility`

---

## Design Principles

- **Style**: Minimal modern, clear data presentation
- **Theme**: Dark mode primary
- **Device**: Mobile-first, desktop for management
- **Icons**: Google Material Symbols (Outlined, 24px default)

For details, see `specs/system/design-system.md`

---

## Speckit + Superpowers Integration

### When to Use Which

| Situation | Tool |
|-----------|------|
| Discussing system architecture, design decisions | `superpowers:brainstorming` → write to `specs/system/` |
| Defining a new feature specification | `/speckit.specify` |
| Creating implementation plan for a feature | `/speckit.plan` |
| Breaking down tasks | `/speckit.tasks` |
| Writing code | `superpowers:TDD` (Red-Green-Refactor) |
| Debugging issues | `superpowers:systematic-debugging` |
| Before claiming completion | `superpowers:verification-before-completion` |
| Reviewing code quality | `superpowers:code-reviewer` |
| Merging spec to canonical | `/speckit.integrate` |

### Workflow Integration

```text
┌─────────────────────────────────────────────────────────────┐
│                    PLANNING PHASE                           │
├─────────────────────────────────────────────────────────────┤
│  System-level design    → superpowers:brainstorming         │
│                           → specs/system/*.md               │
│                                                             │
│  Feature specification  → /speckit.specify                  │
│                           → specs/features/[x]/spec.md      │
│                                                             │
│  Implementation plan    → /speckit.plan                     │
│                           → specs/features/[x]/plan.md      │
│                                                             │
│  Task breakdown         → /speckit.tasks                    │
│                           → specs/features/[x]/tasks.md     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  IMPLEMENTATION PHASE                       │
├─────────────────────────────────────────────────────────────┤
│  For each task:                                             │
│    1. superpowers:TDD         → Write test first            │
│    2. Implement               → Make test pass              │
│    3. Refactor                → Clean up                    │
│                                                             │
│  If stuck:                                                  │
│    → superpowers:systematic-debugging                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   COMPLETION PHASE                          │
├─────────────────────────────────────────────────────────────┤
│  1. superpowers:verification-before-completion              │
│     → Ensure all tests pass                                 │
│                                                             │
│  2. superpowers:code-reviewer                               │
│     → Review code quality                                   │
│                                                             │
│  3. /speckit.integrate                                      │
│     → Merge to specs/canonical/                             │
│     → Record in specs/changelog/                            │
└─────────────────────────────────────────────────────────────┘
```

### Important Rules

1. **Brainstorming output location**: Always write to `specs/system/`, NOT `docs/plans/`
2. **Use speckit for feature specs**: Don't use `superpowers:writing-plans` for feature implementation plans, use `/speckit.plan` instead
3. **TDD is mandatory**: All implementation must follow TDD workflow
4. **Always integrate**: Feature is not complete until spec is in `specs/canonical/`

---

## Command Context Validation

### Before Executing Commands, Validate Context

When user invokes a planning/specification command, **DO NOT execute immediately**. First check if it matches the correct context:

| Command | Correct Context | Wrong Context |
|---------|-----------------|---------------|
| `/speckit.specify` | Defining a new feature | Discussing system architecture |
| `/speckit.plan` | Creating implementation plan for a feature in `specs/features/` | System-level design discussion |
| `/speckit.tasks` | Breaking down a feature plan into tasks | No spec or plan exists yet |
| `superpowers:brainstorming` | System architecture, design decisions, exploring ideas | Feature already has spec.md |
| `superpowers:writing-plans` | **DO NOT USE** - use `/speckit.plan` instead | Any feature planning |
| `superpowers:TDD` | Implementing code for a task | No tasks defined yet |

### Validation Flow

```text
User invokes command
        │
        ▼
┌───────────────────┐
│ Check context     │
│ against rules     │
└───────────────────┘
        │
        ├── Context matches → Execute command
        │
        └── Context mismatch → STOP and:
                │
                ▼
        ┌───────────────────────────────────┐
        │ 1. Explain the rule from CLAUDE.md │
        │ 2. Explain why this is wrong       │
        │ 3. Suggest the correct command     │
        │ 4. Ask user to confirm             │
        └───────────────────────────────────┘
```

### Common Misuse Scenarios

| User Says | Issue | Correct Approach |
|-----------|-------|------------------|
| `/speckit.plan` but no `spec.md` exists | Plan needs spec first | Run `/speckit.specify` first |
| `/speckit.plan` for system-level design | System design ≠ feature plan | Use `superpowers:brainstorming` → `specs/system/` |
| `superpowers:writing-plans` for feature | Duplicates speckit workflow | Use `/speckit.plan` |
| `superpowers:brainstorming` for feature that has spec | Spec already exists | Review existing spec, or use `/speckit.clarify` |
| `/speckit.tasks` but no `plan.md` exists | Tasks need plan first | Run `/speckit.plan` first |
| `superpowers:TDD` but no tasks defined | No clear scope | Run `/speckit.tasks` first |

### Response Template for Misuse

When context mismatch is detected, respond with:

```
⚠️ 指令情境不符

根據 CLAUDE.md 的規範：
- `[invoked command]` 應該用於 `[correct context]`
- 目前的情境是 `[current context]`

**建議改用**：`[correct command]`

**原因**：`[explanation]`

是否要改用建議的方式？
```

### Forbidden Commands

| Command | Reason | Alternative |
|---------|--------|-------------|
| `superpowers:writing-plans` | Conflicts with speckit workflow | `/speckit.plan` |

If user explicitly requests a forbidden command, explain the conflict and suggest the alternative. Do not execute without user confirmation.

---

## Natural Language Skill Invocation

### When User Expresses Intent via Natural Language

When user describes a task or intent without using explicit commands, Claude should:

1. **Analyze the intent** - Determine what the user wants to accomplish
2. **Identify applicable skill** - Match intent to available skills/commands
3. **Explain the judgment** - Tell user which skill will be invoked and why
4. **Wait for confirmation** - Do not execute until user confirms

### Response Template

When natural language triggers a skill, respond with:

```
📋 **意圖分析**

根據您的描述：「[user's statement]」

**我的判斷**：
- 這是 [type of task]
- 適用的工具：`[skill/command name]`

**原因**：[brief explanation]

**確認後我會**：[what will happen]

是否要執行？
```

### Examples

| User Says | Judgment | Skill |
|-----------|----------|-------|
| 「我們來討論一下系統架構」 | 系統設計討論 | `superpowers:brainstorming` |
| 「幫我定義登入功能的規格」 | 功能規格定義 | `/speckit.specify` |
| 「開始寫登入頁面的程式」 | 實作程式碼 | `superpowers:TDD` |
| 「這個 bug 怎麼修」 | 除錯 | `superpowers:systematic-debugging` |

### When NOT to Ask for Confirmation

- Simple questions (not triggering skills)
- Clarification requests
- Information lookup
- File reading/exploration

---

## Quick Reference

| Need | Location |
|------|----------|
| System architecture | `specs/system/architecture.md` |
| Design system | `specs/system/design-system.md` |
| Testing strategy | `specs/system/testing-strategy.md` |
| Feature specs | `specs/canonical/[feature].md` |
| API contracts | `specs/system/api-contracts.md` |
