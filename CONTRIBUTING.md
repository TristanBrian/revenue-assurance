# Contributing to FlowGuard

Thank you for your interest in contributing to the **FlowGuard** platform!  
We welcome contributions of all kinds – bug reports, feature suggestions, code improvements, documentation updates, and more.

Please take a moment to read this guide to make the process smooth and effective for everyone.

---

## 🔍 Code of Conduct

We are committed to providing a welcoming and inclusive environment. By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md)

---

## 🐛 Reporting a Bug

If you find a bug, please open an issue using the **Bug Report** template.  
Provide as much detail as possible:

- A clear **description** of the issue
- **Steps to reproduce** the behaviour
- **Expected** vs **actual** results
- Screenshots, logs, or error messages
- Your **environment** (OS, browser, backend/frontend version)

This helps us diagnose and fix problems faster.

---

## 💡 Suggesting a Feature

We love new ideas! Open an issue with the **Feature Request** template and include:

- The **problem** you’re trying to solve
- A clear **description** of your proposed solution
- Any **alternatives** you’ve considered
- Why this feature would benefit the community

---

## 🛠️ Code Contributions

### 1. Fork the repository
Click the **Fork** button on GitHub and clone your fork locally.

### 2. Create a branch
Use a descriptive branch name, e.g.:

```bash
git checkout -b feature/your-feature-name
```
### 3.Write your code
   Follow the existing code style:

Python: PEP 8 (we use black and flake8)

TypeScript/JavaScript: ESLint (see frontend/.eslintrc)

Add tests for new functionality (pytest for backend, Jest for frontend).

Update documentation if your changes affect usage.

### 4.Commit with a clear message
   We follow Conventional Commits:
   feat: add new fraud detection metric
   fix: correct CSV upload date parsing
   docs: update README with screenshots
   test: add unit tests for reconciliation engine

### 5.Push and open a Pull Request
   Push your branch and open a PR against the main branch.
   Use the Pull Request template and fill in all sections. Link any related issues.
    
     Pull Request Checklist
Before submitting your PR, please confirm:

□ Code follows project style guidelines.
□ All tests pass locally (pytest for backend, npm test for frontend).
□ New tests have been added for new features/fixes.
□ Documentation has been updated (if applicable).
□ No unnecessary files or debug code are included.
□ You have self‑reviewed your code.

📋 Commit Message Guidelines

We use Conventional Commits to automate versioning and changelog generation.
Common types:

feat: – a new feature

fix: – a bug fix

docs: – documentation changes

style: – code style (whitespace, formatting, etc.)

refactor: – code changes that neither fix nor add a feature

perf: – performance improvements

test: – adding or updating tests

chore: – build process, tooling, or dependencies

🧪 Testing

- We maintain a comprehensive test suite:

- Backend: pytest with coverage reporting

- Frontend: jest and react-testing-library

Run the test suite locally with:

```bash
docker compose exec backend pytest
docker compose exec frontend npm test
```

📬 Questions?
If you need help or have any questions, feel free to open an issue or reach out to the maintainers directly.

Thank you for contributing to FlowGuard – we appreciate your support! 🚀