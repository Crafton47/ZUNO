# Contributing to ZUNO

Thank you for your interest in contributing to ZUNO! This guide outlines the development workflow, coding standards, and verification requirements for contributing to this project.

## Code of Conduct

Please maintain a respectful, constructive, and collaborative environment. Be thoughtful, avoid destructive changes, and treat user privacy and security with the highest care.

## Development Setup

1. **Prerequisites**:
   - Node.js >= 20.19.0 (Node 22 LTS recommended)
   - npm >= 10.x
   - Modern browser (Chromium, Firefox, or WebKit)

2. **Clone & Install**:
   ```bash
   git clone <repository-url>
   cd "project 2"
   npm ci
   ```

3. **Environment Configuration**:
   ```bash
   cp .env.example .env
   ```
   Generate a secure, random JWT secret of at least 32 bytes and set `JWT_SECRET` in `.env`.
   Do not commit `.env` or real API credentials.

4. **Start the Development Server**:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:3000`.

## Branch & Pull Request Workflow

1. Fork the repository and create your branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Keep changes focused and scoped. Avoid broad refactorings or unsolicited redesigns of existing interfaces.
3. Zero-destructive rule: Never reset databases, drop user data, or remove working endpoints.
4. Run tests and linting locally before submitting your pull request:
   ```bash
   npm run check
   npm run lint
   npm test
   npm run build
   npm run scan:secrets
   ```
5. Submit a pull request describing the problem, proposed solution, and test evidence.

## Code Style & Standards

- **JavaScript**: Standard CommonJS (Node.js) on the backend; modern ES6+ vanilla JavaScript on the frontend.
- **Linting**: ESLint flat config (`eslint.config.cjs`). Run `npm run lint` to verify.
- **Safety**:
  - Always validate user inputs and verify ownership for user resources.
  - Never render raw AI-generated HTML directly via `innerHTML`. Use text nodes or the safe built-in Markdown renderer.
  - Keep database operations non-blocking and ensure disk synchronization handles transient lock errors.
- **Design System**: Respect ZUNO PLAYCORE 2.0 neo-futuristic design tokens and always support `prefers-reduced-motion`.

## Automated Testing

All PRs must pass the test suite:
- Unit & integration tests: `node --test tests/*.test.cjs`
- Full test command: `npm test`
- Do not add mock tests that pretend to test real features; write deterministic tests using temporary disposable databases and isolated ports.

## Reporting Bugs & Proposing Features

- **Bug Reports**: Open an issue detailing the steps to reproduce, expected vs. actual behavior, browser/OS version, and console errors.
- **Feature Proposals**: Open a discussion or issue before writing extensive code to ensure alignment with ZUNO's roadmap.

## Licensing of Contributions & Intellectual Property

1. **Source-Available Terms**: All contributions submitted to this repository are provided subject to the **ZUNO Source-Available Non-Commercial License (Version 1.0)**.
2. **Contributor Retained Rights**: Per Section 6 of the license, contributors retain copyright in their own original contributions. Submitting a contribution does not transfer ownership to the project owner.
3. **No Automatic Commercial Relicensing**: The project does not claim the right to relicense external contributions for commercial use without explicit contributor consent. If the project owner or commercial partners pursue commercial licensing of features involving outside contributions in the future, a separate Contributor License Agreement (CLA) or written licensing agreement will be established directly with the contributor.
4. **Third-Party Code**: Never submit third-party code without including its original copyright notice and license. Ensure any third-party material is licensed under terms compatible with distribution alongside source-available non-commercial software.
