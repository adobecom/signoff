#!/usr/bin/env node

/**
 * CircleCI Artifacts Downloader
 * 
 * Downloads artifacts from a CircleCI build while maintaining the folder structure.
 * 
 * Usage:
 *   node download-circleci-artifacts.js <project-slug> <job-number> [output-dir]
 * 
 * Example:
 *   node download-circleci-artifacts.js gh/myorg/myrepo 123 ./artifacts
 * 
 * Environment Variables:
 *   CIRCLECI_TOKEN - Your CircleCI API token (required)
 * 
 * The project slug format is: vcs-type/org-name/repo-name
 *   - vcs-type: gh (GitHub), bb (Bitbucket)
 *   - org-name: Your organization or username
 *   - repo-name: Your repository name
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

const CIRCLECI_API_BASE = 'https://cci-ghec.ci.adobe.com/api/v2';

/**
 * Make an HTTPS GET request
 */
function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'Circle-Token': token,
        'Accept': 'application/json'
      }
    };

    https.get(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Download a file from a URL to a local path
 */
function downloadFile(url, filePath, token) {
  return new Promise((resolve, reject) => {
    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const file = fs.createWriteStream(filePath);
    const options = {
      headers: {
        'Circle-Token': token
      }
    };

    https.get(url, options, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        file.close();
        fs.unlink(filePath, () => {}); // Delete the file
        reject(new Error(`HTTP ${res.statusCode}: Failed to download ${url}`));
      }
    }).on('error', (err) => {
      file.close();
      fs.unlink(filePath, () => {}); // Delete the file
      reject(err);
    });
  });
}

/**
 * Fetch artifacts for a specific job
 */
async function fetchArtifacts(projectSlug, jobNumber, token) {
  const url = `${CIRCLECI_API_BASE}/project/${projectSlug}/${jobNumber}/artifacts`;
  console.log(`Fetching artifacts from: ${url}`);
  
  const response = await httpsGet(url, token);
  return response.items || [];
}

/**
 * Download all artifacts maintaining the folder structure
 */
async function downloadArtifacts(artifacts, outputDir, token) {
  console.log(`\nDownloading ${artifacts.length} artifact(s) to: ${outputDir}\n`);

  for (let i = 0; i < artifacts.length; i++) {
    const artifact = artifacts[i];
    const artifactPath = artifact.path;
    const artifactUrl = artifact.url;

    // The artifact path in CircleCI already includes the full path
    // We want to preserve this structure locally
    const localPath = path.join(outputDir, artifactPath);

    console.log(`[${i + 1}/${artifacts.length}] Downloading: ${artifactPath}`);
    
    try {
      await downloadFile(artifactUrl, localPath, token);
      console.log(`  ✓ Saved to: ${localPath}`);
    } catch (error) {
      console.error(`  ✗ Failed: ${error.message}`);
    }
  }
}

/**
 * Main function
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node download-circleci-artifacts.js <project-slug> <job-number> [output-dir]');
    console.error('');
    console.error('Example:');
    console.error('  node download-circleci-artifacts.js gh/myorg/myrepo 123 ./artifacts');
    console.error('');
    console.error('Environment variables required:');
    console.error('  CIRCLECI_TOKEN - Your CircleCI API token');
    process.exit(1);
  }

  const projectSlug = args[0];
  const jobNumber = args[1];
  const outputDir = args[2] || './circleci-artifacts';

  // Check for CircleCI token
  const token = process.env.CIRCLECI_TOKEN;
  if (!token) {
    console.error('Error: CIRCLECI_TOKEN environment variable is not set');
    console.error('');
    console.error('Get your token from: https://app.circleci.com/settings/user/tokens');
    console.error('Then set it: export CIRCLECI_TOKEN=your_token_here');
    process.exit(1);
  }

  try {
    console.log('CircleCI Artifacts Downloader');
    console.log('============================');
    console.log(`Project: ${projectSlug}`);
    console.log(`Job Number: ${jobNumber}`);
    console.log(`Output Directory: ${outputDir}`);
    console.log('');

    // Fetch artifacts
    const artifacts = await fetchArtifacts(projectSlug, jobNumber, token);

    if (artifacts.length === 0) {
      console.log('No artifacts found for this job.');
      return;
    }

    // Download artifacts
    await downloadArtifacts(artifacts, outputDir, token);

    console.log('\n✓ Download complete!');
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    process.exit(1);
  }
}

main();