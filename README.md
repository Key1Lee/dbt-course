# Key1Lee dbt analytics engineering learning repository

This is the working repository for learning dbt, Snowflake, dimensional
modeling, data quality, and analytical SQL. It extends the *Complete dbt
Bootcamp: Zero to Hero* student project with step-by-step documentation, a safe
synthetic Apple Pay model, Node.js query tools, and automated checks.

The main project is [`airbnb/`](airbnb/README.md).

## What is included

- The course's Airbnb source, staging, dimension, fact, mart, snapshot, macro,
  test, analysis, and exposure examples.
- A documented Apple Pay dimensional model built from synthetic seeds.
- A Node.js 24 local SQL lab that works without warehouse credentials.
- An optional read-only Node.js Snowflake query tool for relations built by dbt.
- An optional Dagster example for orchestrating the dbt assets.
- Practical guides to the pipeline and important dbt file templates.

## Quick start without Snowflake

```powershell
Set-Location airbnb
npm install
npm run lab:tables
npm run lab:examples
```

This loads the synthetic Apple Pay learning data into an in-memory local
database and runs read-only SQL examples.

## Build with dbt and Snowflake

The repository uses `uv` and a Python version below 3.14, as pinned in
`pyproject.toml` and `uv.lock`.

```powershell
uv sync
Set-Location airbnb
uv run dbt deps
uv run dbt debug --profiles-dir _prod_profiles --target dev
uv run dbt build --profiles-dir _prod_profiles --target dev
```

The Snowflake profile reads credentials from environment variables. Do not
commit `.env`, `profiles.yml`, private keys, or real payment/customer data.

## Learning path

1. Read the [`airbnb` project README](airbnb/README.md).
2. Follow the [Airbnb pipeline walkthrough](airbnb/docs/PIPELINE_WALKTHROUGH.md).
3. Study the [important dbt file templates](airbnb/docs/IMPORTANT_FILE_TEMPLATES.md).
4. Build the [Apple Pay data model](airbnb/docs/APPLE_PAY_DATA_MODEL.md).
5. Practice in the [Node query lab](airbnb/docs/NODE_QUERY_LAB.md).
6. Make a learning branch, verify it, and open a pull request.

## Managing this repository

```powershell
git pull --ff-only
git switch -c learning/<topic>
git status
git add <specific-files>
git commit -m "docs: explain <topic>"
git push -u origin learning/<topic>
```

Use the default branch for reviewed work and short-lived `learning/*` branches
for experiments. Check the GitHub Actions result after every push. A CI parse
check validates project structure without connecting to Snowflake; a real dbt
build still needs the warehouse and private credentials.

## Attribution

The original Airbnb materials are from Zoltan C. Toth's
[*Complete dbt Bootcamp: Zero to Hero*](https://www.udemy.com/course/complete-dbt-data-build-tool-bootcamp-zero-to-hero-learn-dbt/).
The upstream license remains in [`LICENSE.md`](LICENSE.md). The Apple Pay
learning data and identifiers in this fork are synthetic and are not supplied
by or affiliated with Apple.
