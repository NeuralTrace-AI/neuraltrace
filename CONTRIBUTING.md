# Contributing to NeuralTrace

We welcome contributions! Whether it's a bug fix, new feature, or documentation improvement, we appreciate your help.

## Quick Start

1. **Fork** this repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/neuraltrace.git`
3. **Install dependencies**: `npm install`
4. **Copy env config**: `cp .env.example .env` and add your OpenAI API key
5. **Run the server**: `npm run dev`
6. **Create a branch**: `git checkout -b feature/your-feature`
7. **Make your changes** and test them
8. **Submit a pull request** to `main`

## Development Setup

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Start development server
npm run dev

# Build for production
npm run build
npm start
```

## What We're Looking For

- Bug fixes with clear descriptions of what was broken
- New embedding providers (Ollama, local models)
- Chrome extension improvements
- Documentation improvements
- Test coverage

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Test your changes locally before submitting
- Follow the existing code style

## Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node.js version, browser)

## Questions?

Open a discussion or issue — we're happy to help.
