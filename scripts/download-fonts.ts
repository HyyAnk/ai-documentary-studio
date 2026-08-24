import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const FONTS_DIR = path.resolve(process.cwd(), "assets", "fonts");

if (!fs.existsSync(FONTS_DIR)) {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
}

const FONTS_TO_DOWNLOAD = [
  {
    filename: "Fredoka-VariableFont_wdth,wght.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/fredoka/Fredoka%5Bwdth%2Cwght%5D.ttf",
  },
  {
    filename: "Baloo2-VariableFont_wght.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/baloo2/Baloo2%5Bwght%5D.ttf",
  },
  {
    filename: "Nunito-VariableFont_wght.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/Nunito%5Bwght%5D.ttf",
  },
];

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close();
        resolve();
      });
      fileStream.on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function main() {
  console.log(`Downloading Google Fonts to ${FONTS_DIR}...`);
  for (const font of FONTS_TO_DOWNLOAD) {
    const dest = path.join(FONTS_DIR, font.filename);
    console.log(`Downloading ${font.filename} from ${font.url}...`);
    try {
      await downloadFile(font.url, dest);
      const stat = fs.statSync(dest);
      console.log(`✓ Saved ${font.filename} (${Math.round(stat.size / 1024)} KB)`);
    } catch (err) {
      console.error(`✗ Error downloading ${font.filename}:`, err);
    }
  }
  console.log("Done!");
}

main().catch(console.error);
