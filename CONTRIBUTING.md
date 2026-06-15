# Contributing to GetHired

Thanks for your interest in contributing! GetHired is a full-stack AI-powered job platform built with Next.js, Supabase, and pgvector. Contributions of all kinds are welcome — bug fixes, features, docs, and more.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Setting Up Supabase Locally](#setting-up-supabase-locally)
- [Branching Strategy](#branching-strategy)
- [Making a Contribution](#making-a-contribution)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Code Style](#code-style)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

---

## Getting Started

1. **Fork** the repository and clone your fork locally.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables. Copy `.env.example` to `.env.local` and fill in your Supabase credentials and any required API keys.
4. Run the development server:
   ```bash
   npm run dev
   ```

> You'll need a Supabase project with `pgvector` enabled to run the full stack locally.

---

## Setting Up Supabase Locally

1. [Create a new Supabase project](https://supabase.com/dashboard) if you don't have one.
2. Install the Supabase CLI if you haven't already:
   ```bash
   npm install -g supabase
   ```
3. Log in and link your project:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```
   Your project ref is in your Supabase dashboard URL: `https://supabase.com/dashboard/project/<project-ref>`.
4. Apply the migrations to replicate the schema:
   ```bash
   supabase db push
   ```
   This will run all the SQL scripts in `supabase/migrations/` against your remote database in order.
5. Enable the `pgvector` extension in your Supabase project if it isn't already — go to **Database → Extensions** in the dashboard and enable `vector`.

Once done, copy your Supabase project URL and anon/service role keys into `.env.local` and you're good to go.

---

## Branching Strategy

We use a `dev` → `main` workflow:

| Branch | Purpose                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------- |
| `main` | Stable, production-ready code. Reflects what's live at [gethired.devhub.co.in](https://gethired.devhub.co.in). |
| `dev`  | Active development. All PRs should target this branch.                                                         |

**Please open all pull requests against the `dev` branch, not `main`.** PRs targeting `main` directly will be retargeted or closed.

---

## Making a Contribution

1. **Fork** the repository on GitHub. The fork will include all branches — make sure to uncheck "Copy the `main` branch only" so you get `dev` too.
2. Clone your fork and switch to the `dev` branch:
   ```bash
   git clone https://github.com/<your-username>/GetHired.git
   cd GetHired
   git checkout dev
   ```
3. Create a new branch off `dev`:
   ```bash
   git pull origin dev
   git checkout -b your-feature-name
   ```
4. Make your changes with clear, focused commits.
5. Push your branch and open a PR against `dev` on the main repo.

---

## Pull Request Guidelines

- **Target branch:** `dev` (not `main`)
- Give your PR a clear title that describes what it does (e.g. `Fix: resume upload failing for large files` or `Feat: add filter by salary range`)
- Include a brief description of what you changed and why
- Reference any related issues with `Closes #123` or `Related to #123`
- Keep PRs focused — one feature or fix per PR is easier to review
- Make sure the app builds and runs without errors before submitting (`npm run build`)

---

## Code Style

- This project uses **TypeScript** — please keep everything typed
- Styling is done with **Tailwind CSS** and **Shadcn UI** — prefer utility classes over custom CSS
- Follow the existing file and folder structure (`app/`, `components/`, `utils/`, `hooks/`, etc.)
- Run the linter before submitting:
  ```bash
  npm run lint
  ```

---

## Reporting Bugs

Open an [issue](https://github.com/kVarunkk/GetHired/issues) and include:

- A clear description of the bug
- Steps to reproduce it
- Expected vs actual behavior
- Screenshots or error messages if applicable
- Your environment (browser, OS, Node version)

---

## Suggesting Features

Open an [issue](https://github.com/kVarunkk/GetHired/issues) with the `enhancement` label. Describe the problem you're trying to solve and how your idea addresses it. Feel free to discuss before opening a PR for larger changes — it saves everyone time.

---

Thanks for helping make GetHired better!
