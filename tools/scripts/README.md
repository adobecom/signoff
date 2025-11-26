# CircleCI Artifacts Downloader

A Node.js script to download artifacts from CircleCI builds while maintaining the original folder structure.

## Prerequisites

1. **CircleCI API Token**: Get your personal API token from [CircleCI User Settings](https://app.circleci.com/settings/user/tokens)
2. **Node.js**: This script uses built-in Node.js modules, no additional dependencies needed (other than `dotenv` which is already in the project)

## Setup

1. Set your CircleCI token as an environment variable:

```bash
export CIRCLECI_TOKEN=your_token_here
```

Or add it to your `.env` file:

```bash
echo "CIRCLECI_TOKEN=your_token_here" >> .env
```

## Usage

### Basic Command

```bash
node tools/scripts/download-circleci-artifacts.js <project-slug> <job-number> [output-dir]
```

### Parameters

- **project-slug**: The CircleCI project identifier in format `vcs-type/org-name/repo-name`
  - `vcs-type`: `gh` (GitHub) or `bb` (Bitbucket)
  - `org-name`: Your organization or username
  - `repo-name`: Your repository name
  
- **job-number**: The CircleCI job number (found in the job URL)

- **output-dir** (optional): Local directory to save artifacts (defaults to `./circleci-artifacts`)

### Examples

#### Download artifacts from a GitHub project

```bash
node tools/scripts/download-circleci-artifacts.js gh/adobe/signoff 12345
```

#### Download to a specific directory

```bash
node tools/scripts/download-circleci-artifacts.js gh/adobe/signoff 12345 ./my-artifacts
```

#### Using npm script (if added to package.json)

```bash
npm run download-artifacts gh/adobe/signoff 12345
```

## How It Works

1. The script uses the CircleCI API v2 to fetch the list of artifacts for a specific job
2. For each artifact, it preserves the original path structure from CircleCI
3. Downloads each file to the corresponding local path
4. Creates directories as needed to maintain the folder structure

## Folder Structure

The downloaded artifacts will maintain the exact same folder structure as they appear in CircleCI. For example:

```
circleci-artifacts/
├── playwright-report/
│   ├── index.html
│   └── data/
│       └── results.json
├── test-results/
│   ├── screenshots/
│   └── videos/
└── logs/
    └── test.log
```

## Finding Your Project Slug and Job Number

### Project Slug

From a CircleCI URL like:
```
https://app.circleci.com/pipelines/github/adobe/signoff/123/workflows/abc/jobs/456
```

The project slug is: `gh/adobe/signoff`

### Job Number

From the same URL above, the job number is: `456`

Or you can find it in the CircleCI UI in the job details page.

## Troubleshooting

### "CIRCLECI_TOKEN environment variable is not set"

Make sure you've exported the token in your current shell session or added it to your `.env` file.

### "HTTP 401" or "Unauthorized"

Your CircleCI token may be invalid or expired. Generate a new one from the CircleCI settings.

### "HTTP 404" or "Not Found"

- Verify the project slug format is correct (`vcs-type/org-name/repo-name`)
- Ensure the job number exists and you have access to view it
- Check that the job has completed and produced artifacts

### "No artifacts found"

The job may not have generated any artifacts. Check the CircleCI job page to confirm artifacts exist.

## API Reference

This script uses the CircleCI API v2:
- **Endpoint**: `GET /api/v2/project/:project_slug/:job_number/artifacts`
- **Documentation**: https://circleci.com/docs/api/v2/

## License

Apache License 2.0

