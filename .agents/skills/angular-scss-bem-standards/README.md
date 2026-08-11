# Angular SCSS BEM Standards

> Angular component styling skill for Claude Code, Codex, and ChatGPT

A comprehensive skill for writing, reviewing, and refactoring Angular component styles using BEM methodology with design tokens.

## 🎯 What This Skill Does

This skill helps AI agents maintain consistent, predictable, and reusable component styles by enforcing:

- **BEM naming conventions** — One block per component, semantic element/modifier names
- **Component Structure** — Single root element with component name class
- **Flat selector architecture** — Avoid deep nesting, prefer explicit classes
- **Design token usage** — Replace hard-coded values with `var(--token)`
- **Angular integration** — Proper class binding patterns with signals and control flow

## 📋 Key Features

- Component-scoped BEM blocks with strict naming rules
- Maximum one-level descendant selectors (when absolutely needed)
- Comprehensive review checklist for code reviews
- Common mistake patterns with fix guidance
- Angular-specific binding patterns

## 🚀 Installation

### One-Click Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/mizok/angular-scss-bem-standards-skill/main/install.sh | bash
```

The installer automatically detects your AI agent (Claude Code or Codex CLI) and installs to the correct directory.

### Manual Install

#### For Claude Code

```bash
git clone https://github.com/mizok/angular-scss-bem-standards-skill.git ~/.claude/skills/angular-scss-bem-standards
```

#### For Codex CLI

```bash
git clone https://github.com/mizok/angular-scss-bem-standards-skill.git ~/.agents/skills/angular-scss-bem-standards
```

### Verify Installation

Restart your AI agent and the skill should appear in the available skills list. You can verify by looking for `angular-scss-bem-standards` in:

- Claude Code: Check system reminders for available skills
- Codex CLI: Run `codex skills list`

### Update to Latest Version

```bash
# Navigate to skill directory
cd ~/.claude/skills/angular-scss-bem-standards
# Or for Codex: cd ~/.agents/skills/angular-scss-bem-standards

# Pull latest changes
git pull
```

## 📖 When to Use

This skill automatically triggers when:

- Writing new component styles (SCSS/CSS)
- Reviewing pull requests with style changes
- Refactoring existing component styles
- Encountering BEM naming issues
- Finding deep nesting or non-flat selectors
- Spotting hard-coded values instead of design tokens

## 🏗️ Skill Structure

```
angular-scss-bem-standards/
├── SKILL.md                           # Main skill documentation
├── references/
│   └── review-checklist.md            # Detailed review criteria
└── agents/
    └── [test scenarios]
```

## 🎓 Core Principles

1. **Root Class Matching** — Component root element class matches component name (e.g. `.login`)
2. **One BEM block per component** — Keeps styles scoped and predictable
3. **Flat selectors by default** — `block__element--modifier`, not deep nesting
4. **Design tokens first** — Use `var(--space-*)`, `var(--color-*)`, etc.
5. **Split when complex** — If you need more than one descendant level, create a child component

## 📝 Example

**Before** (problematic):
```scss
.card {
  .header {
    .title {
      .icon {
        color: #666;
        margin-left: 8px;
      }
    }
  }
}
```

**After** (following BEM + tokens):
```scss
.card__header-icon {
  color: var(--zinc-500);
  margin-left: var(--space-2);
}
```

## 🤝 Contributing

Contributions welcome! Please:

1. Follow the existing structure and patterns
2. Test changes with actual AI agent scenarios
3. Update documentation accordingly
4. Submit PRs with clear descriptions

## 📄 License

MIT License - see LICENSE file for details

## 🔗 Resources

- [BEM Methodology](https://getbem.com/)
- [Angular Style Guide](https://angular.dev/style-guide)
- [SkillsMP Marketplace](https://skillsmp.com/)

## ⭐ Support

If this skill helps your AI-assisted development workflow, please consider:

- ⭐ Starring this repository
- 🐛 Reporting issues or suggestions
- 🔄 Sharing with your team

---

**Made for AI agents** | Compatible with Claude Code, Codex CLI, and ChatGPT
