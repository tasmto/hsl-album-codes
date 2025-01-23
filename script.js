/**
 * Script to archive images taken before an album code set was generated.
 *
 * Purpose:
 * - Extracts album codes from PNG file names in the `codes` folder.
 * - Archives database records in the `photo_upload_album_links` table with linked dates before a set threshold.
 *
 * Features:
 * - Interactive prompts for each album code:
 *   - Displays the number of records before and after the threshold date.
 *   - Options: `y` (yes), `n` (no), `A` (archive all).
 * - Configurable threshold date via the `THRESHOLD_DATE` constant.
 *
 * Usage:
 * - Place PNG files in the `codes` folder.
 * - Set up database connection details.
 * - Run the script and follow the terminal prompts.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import readline from 'readline';
import { readdir } from 'fs/promises';

const { Pool } = pg;
// External constant for the threshold date
const THRESHOLD_DATE = new Date(process.env.DATE_THRESHOLD);

// Create a new PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // For development or testing. In production, you should specify certificates.
  },
});

// Create a Drizzle instance using the pool
const db = drizzle(pool);

// Function to prompt the user
const promptUser = (question) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
};

async function archiveFromCodesFolder() {
  // Convert the current module URL to a file path
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Resolve the 'codes' folder path correctly
  const codesFolder = resolve(__dirname, 'codes');

  try {
    const files = await readdir(codesFolder);
    const pngFiles = files.filter((file) => file.endsWith('.png'));

    let autoArchiveAll = false;

    for (const file of pngFiles) {
      const match = file.match(/_(?<albumCode>@\w+)\.png$/);

      if (!match || !match.groups.albumCode) {
        console.log(`Skipping file ${file}, no album code found.`);
        continue;
      }

      const albumCode = match.groups.albumCode;

      // Query the database for records associated with the album code
      const { rows: records } = await db.execute(
        sql`SELECT "Id", "LinkedDateTime" FROM "PhotoUploadAlbumLinks" WHERE "AlbumCode" = ${albumCode}`
      );

      const linkedDates = records.map(
        (record) => new Date(record.LinkedDateTime)
      );

      // Separate records before and after the threshold date
      const beforeThreshold = linkedDates.filter(
        (date) => date < THRESHOLD_DATE
      );
      const afterThreshold = linkedDates.filter(
        (date) => date >= THRESHOLD_DATE
      );

      console.log(
        `Found ${linkedDates.length} records for AlbumCode: ${albumCode}.`
      );
      console.log(
        `${
          beforeThreshold.length
        } images taken before ${THRESHOLD_DATE.toISOString()}.`
      );
      console.log(
        `${
          afterThreshold.length
        } images taken on or after ${THRESHOLD_DATE.toISOString()}.`
      );

      // Log and skip if no images before the threshold
      if (beforeThreshold.length === 0) {
        console.log(
          `No images before ${THRESHOLD_DATE.toISOString()} for AlbumCode: ${albumCode}. Skipping...`
        );
        continue;
      }

      if (!autoArchiveAll) {
        const userInput = await promptUser(
          `Archive ${
            beforeThreshold.length
          } images before ${THRESHOLD_DATE.toISOString()}? (y = yes, n = no, A = archive all): `
        );

        if (userInput.toLowerCase() === 'n') {
          console.log(`Skipping AlbumCode: ${albumCode}`);
          continue;
        } else if (userInput.toLowerCase() === 'a') {
          autoArchiveAll = true;
        } else if (userInput.toLowerCase() !== 'y') {
          console.log('Invalid input. Skipping this AlbumCode.');
          continue;
        }
      }

      // Archive records before the threshold date using the Id instead of the mutated date
      for (const record of records.filter(
        (record) => new Date(record.LinkedDateTime) < THRESHOLD_DATE
      )) {
        const newAlbumCode = albumCode.startsWith('@_archive')
          ? albumCode
          : `@_archive_${albumCode.slice(1)}`;

        await db.execute(
          sql`UPDATE "PhotoUploadAlbumLinks"
              SET "AlbumCode" = ${newAlbumCode}
              WHERE "Id" = ${record.Id}`
        );

        console.log(
          `Archived record with Id: ${record.Id} for AlbumCode: ${albumCode}`
        );
      }
    }

    console.log('Archiving process completed!');
  } catch (error) {
    console.error('Error during archiving:', error);
  } finally {
    // Clean up the database connection
    await pool.end();
  }
}

archiveFromCodesFolder();
