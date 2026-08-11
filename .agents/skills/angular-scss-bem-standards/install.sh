#!/bin/bash

# SCSS BEM Standards Skill Installer
# Compatible with Claude Code, Codex CLI, and ChatGPT

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Ensure HOME is set
if [ -z "$HOME" ]; then
  HOME="$( cd ~ && pwd )"
fi

# Detect agent type and set skills directory
if command -v claude &> /dev/null; then
  AGENT_TYPE="claude"
  SKILLS_DIR="$HOME/.claude/skills"
elif command -v codex &> /dev/null; then
  AGENT_TYPE="codex"
  SKILLS_DIR="$HOME/.agents/skills"
else
  AGENT_TYPE="unknown"
  SKILLS_DIR="$HOME/.claude/skills"
fi

SKILL_NAME="angular-scss-bem-standards"
REPO_URL="https://github.com/mizok/angular-scss-bem-standards-skill.git"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Angular SCSS BEM Standards Skill Installer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Agent detected: $AGENT_TYPE"
echo "Install path: $SKILLS_DIR/$SKILL_NAME"
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
  echo -e "${RED}✗ Error: git is not installed${NC}"
  echo "Please install git and try again."
  exit 1
fi

# Create skills directory if it doesn't exist
mkdir -p "$SKILLS_DIR"

# Check if skill already exists
if [ -d "$SKILLS_DIR/$SKILL_NAME" ]; then
  echo -e "${YELLOW}⚠ Skill already installed${NC}"
  echo ""
  read -p "Update to latest version? (y/N) " -n 1 -r
  echo ""

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Updating..."
    cd "$SKILLS_DIR/$SKILL_NAME"
    git pull
    echo -e "${GREEN}✓ Skill updated successfully!${NC}"
  else
    echo "Installation cancelled."
    exit 0
  fi
else
  echo "Installing..."
  git clone "$REPO_URL" "$SKILLS_DIR/$SKILL_NAME"
  echo -e "${GREEN}✓ Skill installed successfully!${NC}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Restart your AI agent (Claude Code, Codex, etc.)"
echo "2. The skill will be available for:"
echo "   • Writing component styles"
echo "   • Reviewing style code"
echo "   • Refactoring SCSS/CSS"
echo ""
echo "Repository: https://github.com/mizok/angular-scss-bem-standards-skill"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
