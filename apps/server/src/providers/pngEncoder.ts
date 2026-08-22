import { deflateSync } from "node:zlib";
import type { ImageProvider } from "./index.js";
import { RepositoryService } from "../repository.js";

type PngEncoderTarget = {
  channelId: string;
  episodeId: string;
  bundleNumber?: number;
  variant?: number;
  assetId?: string;
  fingerprint?: string;
  theme?: string;
};

// 5x7 Basic ASCII font definitions for characters 32-126
const FONT_5X7: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0],
  "!": [0, 0, 0x5f, 0, 0],
  '"': [0, 0x07, 0, 0x07, 0],
  "#": [0x14, 0x7f, 0x14, 0x7f, 0x14],
  "$": [0x24, 0x2a, 0x7f, 0x2a, 0x12],
  "%": [0x23, 0x13, 0x08, 0x64, 0x62],
  "&": [0x36, 0x49, 0x55, 0x22, 0x50],
  "'": [0, 0x05, 0x03, 0, 0],
  "(": [0, 0x1c, 0x22, 0x41, 0],
  ")": [0, 0x41, 0x22, 0x1c, 0],
  "*": [0x14, 0x08, 0x3e, 0x08, 0x14],
  "+": [0x08, 0x08, 0x3e, 0x08, 0x08],
  ",": [0, 0x50, 0x30, 0, 0],
  "-": [0x08, 0x08, 0x08, 0x08, 0x08],
  ".": [0, 0x60, 0x60, 0, 0],
  "/": [0x20, 0x10, 0x08, 0x04, 0x02],
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e],
  "1": [0, 0x42, 0x7f, 0x40, 0],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46],
  "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10],
  "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30],
  "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36],
  "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  ":": [0, 0x36, 0x36, 0, 0],
  ";": [0, 0x56, 0x36, 0, 0],
  "<": [0x08, 0x14, 0x22, 0x41, 0],
  "=": [0x14, 0x14, 0x14, 0x14, 0x14],
  ">": [0, 0x41, 0x22, 0x14, 0x08],
  "?": [0x02, 0x01, 0x51, 0x09, 0x06],
  "@": [0x32, 0x49, 0x79, 0x41, 0x3e],
  "A": [0x7e, 0x11, 0x11, 0x11, 0x7e],
  "B": [0x7f, 0x49, 0x49, 0x49, 0x36],
  "C": [0x3e, 0x41, 0x41, 0x41, 0x22],
  "D": [0x7f, 0x41, 0x41, 0x22, 0x1c],
  "E": [0x7f, 0x49, 0x49, 0x49, 0x41],
  "F": [0x7f, 0x09, 0x09, 0x09, 0x01],
  "G": [0x3e, 0x41, 0x49, 0x49, 0x7a],
  "H": [0x7f, 0x08, 0x08, 0x08, 0x7f],
  "I": [0, 0x41, 0x7f, 0x41, 0],
  "J": [0x20, 0x40, 0x41, 0x3f, 0x01],
  "K": [0x7f, 0x08, 0x14, 0x22, 0x41],
  "L": [0x7f, 0x40, 0x40, 0x40, 0x40],
  "M": [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  "N": [0x7f, 0x04, 0x08, 0x10, 0x7f],
  "O": [0x3e, 0x41, 0x41, 0x41, 0x3e],
  "P": [0x7f, 0x09, 0x09, 0x09, 0x06],
  "Q": [0x3e, 0x41, 0x51, 0x21, 0x5e],
  "R": [0x7f, 0x09, 0x19, 0x29, 0x46],
  "S": [0x46, 0x49, 0x49, 0x49, 0x31],
  "T": [0x01, 0x01, 0x7f, 0x01, 0x01],
  "U": [0x3f, 0x40, 0x40, 0x40, 0x3f],
  "V": [0x1f, 0x20, 0x40, 0x20, 0x1f],
  "W": [0x7f, 0x20, 0x18, 0x20, 0x7f],
  "X": [0x63, 0x14, 0x08, 0x14, 0x63],
  "Y": [0x07, 0x08, 0x70, 0x08, 0x07],
  "Z": [0x61, 0x51, 0x49, 0x45, 0x43],
  "[": [0, 0x7f, 0x41, 0x41, 0],
  "\\": [0x02, 0x04, 0x08, 0x10, 0x20],
  "]": [0, 0x41, 0x41, 0x7f, 0],
  "^": [0x04, 0x02, 0x01, 0x02, 0x04],
  "_": [0x40, 0x40, 0x40, 0x40, 0x40],
  "a": [0x20, 0x54, 0x54, 0x54, 0x78],
  "b": [0x7f, 0x48, 0x44, 0x44, 0x38],
  "c": [0x38, 0x44, 0x44, 0x44, 0x20],
  "d": [0x38, 0x44, 0x44, 0x48, 0x7f],
  "e": [0x38, 0x54, 0x54, 0x54, 0x18],
  "f": [0x08, 0x7e, 0x09, 0x01, 0x02],
  "g": [0x0c, 0x52, 0x52, 0x52, 0x3e],
  "h": [0x7f, 0x08, 0x04, 0x04, 0x78],
  "i": [0, 0x44, 0x7d, 0x40, 0],
  "j": [0x20, 0x40, 0x44, 0x3d, 0],
  "k": [0x7f, 0x10, 0x28, 0x44, 0],
  "l": [0, 0x41, 0x7f, 0x40, 0],
  "m": [0x7c, 0x04, 0x18, 0x04, 0x78],
  "n": [0x7c, 0x08, 0x04, 0x04, 0x78],
  "o": [0x38, 0x44, 0x44, 0x44, 0x38],
  "p": [0x7c, 0x14, 0x14, 0x14, 0x08],
  "q": [0x08, 0x14, 0x14, 0x18, 0x7c],
  "r": [0x7c, 0x08, 0x04, 0x04, 0x08],
  "s": [0x48, 0x54, 0x54, 0x54, 0x20],
  "t": [0x04, 0x3f, 0x44, 0x40, 0x20],
  "u": [0x3c, 0x40, 0x40, 0x20, 0x7c],
  "v": [0x1c, 0x20, 0x40, 0x20, 0x1c],
  "w": [0x3c, 0x40, 0x30, 0x40, 0x3c],
  "x": [0x44, 0x28, 0x10, 0x28, 0x44],
  "y": [0x0c, 0x50, 0x50, 0x50, 0x3c],
  "z": [0x44, 0x64, 0x54, 0x4c, 0x44],
};

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const chunk = new Uint8Array(12 + len);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, len, false);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + len));
  view.setUint32(8 + len, crc, false);
  return chunk;
}

/**
 * Creates a valid, theme-aware, readable 16:9 PNG placeholder.
 */
export function generateThemedPlaceholderPng(
  title: string,
  subtitle = "QUIZ ILLUSTRATION PLACEHOLDER",
  theme = "candy_arcade",
  width = 960,
  height = 540,
): Uint8Array {
  // Theme palette: background, accent, text
  const palettes: Record<string, { bg: [number, number, number]; card: [number, number, number]; accent: [number, number, number]; text: [number, number, number]; muted: [number, number, number] }> = {
    candy_arcade: { bg: [40, 24, 60], card: [68, 38, 98], accent: [255, 214, 90], text: [255, 248, 232], muted: [180, 160, 210] },
    candy_pop: { bg: [60, 20, 45], card: [100, 30, 75], accent: [255, 120, 102], text: [255, 255, 255], muted: [230, 170, 200] },
    space_lab: { bg: [15, 22, 40], card: [25, 40, 70], accent: [120, 185, 255], text: [235, 245, 255], muted: [140, 170, 210] },
    jungle_jamboree: { bg: [20, 45, 30], card: [35, 75, 50], accent: [115, 214, 189], text: [240, 255, 245], muted: [150, 200, 170] },
    ocean_explorer: { bg: [10, 35, 60], card: [20, 60, 100], accent: [120, 220, 255], text: [240, 250, 255], muted: [140, 190, 230] },
  };

  const p = palettes[theme] || palettes.candy_arcade;

  // RGBA buffer (height rows, width columns)
  const rawRgba = new Uint8Array(width * height * 4);

  // 1. Fill background with gradient & card
  const cardMarginX = Math.round(width * 0.08);
  const cardMarginY = Math.round(height * 0.12);

  for (let y = 0; y < height; y++) {
    const yRatio = y / height;
    const bgR = Math.min(255, Math.max(0, p.bg[0] + Math.round(yRatio * 20)));
    const bgG = Math.min(255, Math.max(0, p.bg[1] + Math.round(yRatio * 15)));
    const bgB = Math.min(255, Math.max(0, p.bg[2] + Math.round(yRatio * 25)));

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const inCard = x >= cardMarginX && x < width - cardMarginX && y >= cardMarginY && y < height - cardMarginY;
      const isCardBorder = inCard && (x === cardMarginX || x === width - cardMarginX - 1 || y === cardMarginY || y === height - cardMarginY - 1);

      if (isCardBorder) {
        rawRgba[idx] = p.accent[0];
        rawRgba[idx + 1] = p.accent[1];
        rawRgba[idx + 2] = p.accent[2];
        rawRgba[idx + 3] = 255;
      } else if (inCard) {
        rawRgba[idx] = p.card[0];
        rawRgba[idx + 1] = p.card[1];
        rawRgba[idx + 2] = p.card[2];
        rawRgba[idx + 3] = 255;
      } else {
        rawRgba[idx] = bgR;
        rawRgba[idx + 1] = bgG;
        rawRgba[idx + 2] = bgB;
        rawRgba[idx + 3] = 255;
      }
    }
  }

  // Draw bitmap text helper
  function drawText(text: string, startX: number, startY: number, scale: number, color: [number, number, number]) {
    let cursorX = startX;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const glyph = FONT_5X7[char] || FONT_5X7["?"];
      for (let col = 0; col < 5; col++) {
        const line = glyph[col] || 0;
        for (let row = 0; row < 7; row++) {
          if (line & (1 << row)) {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const px = cursorX + col * scale + sx;
                const py = startY + row * scale + sy;
                if (px >= 0 && px < width && py >= 0 && py < height) {
                  const idx = (py * width + px) * 4;
                  rawRgba[idx] = color[0];
                  rawRgba[idx + 1] = color[1];
                  rawRgba[idx + 2] = color[2];
                  rawRgba[idx + 3] = 255;
                }
              }
            }
          }
        }
      }
      cursorX += (5 + 1) * scale;
    }
  }

  // 2. Draw Subtitle / Kicker
  drawText(subtitle.toUpperCase().slice(0, 40), cardMarginX + 40, cardMarginY + 40, 2, p.accent);

  // 3. Draw Title / Question text wrapped across lines
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  const maxLineChars = 32;
  const words = cleanTitle.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxLineChars) {
      currentLine = (currentLine + " " + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word.slice(0, maxLineChars);
    }
  }
  if (currentLine) lines.push(currentLine);

  let textY = cardMarginY + 110;
  for (const line of lines.slice(0, 4)) {
    drawText(line, cardMarginX + 40, textY, 4, p.text);
    textY += 45;
  }

  // 4. Draw Degradation Fallback Notice
  drawText("TIER 3 DETERMINISTIC FALLBACK - OPERATOR REVIEW", cardMarginX + 40, height - cardMarginY - 45, 2, p.muted);

  // 5. Construct PNG scanlines with filter byte 0x00
  const scanlineLength = 1 + width * 4;
  const scanlines = new Uint8Array(height * scanlineLength);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    scanlines[rowOffset] = 0; // Filter: None
    scanlines.set(rawRgba.subarray(y * width * 4, (y + 1) * width * 4), rowOffset + 1);
  }

  const idatData = deflateSync(scanlines);

  // IHDR chunk
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: RGBA (6)
  ihdr[10] = 0; // Compression: Deflate
  ihdr[11] = 0; // Filter method
  ihdr[12] = 0; // Interlace: None

  const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", idatData);
  const iendChunk = makeChunk("IEND", new Uint8Array(0));

  const totalLength = pngSignature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalLength);
  let offset = 0;
  png.set(pngSignature, offset); offset += pngSignature.length;
  png.set(ihdrChunk, offset); offset += ihdrChunk.length;
  png.set(idatChunk, offset); offset += idatChunk.length;
  png.set(iendChunk, offset);

  return png;
}

export class PngEncoderProvider implements ImageProvider {
  constructor(
    private readonly repository: RepositoryService,
    private readonly target: PngEncoderTarget,
  ) {}

  async generateReference(prompt: string): Promise<{ asset_path: string; fallback_tier: number; degraded: true }> {
    const bytes = generateThemedPlaceholderPng(
      prompt,
      this.target.assetId ? `ASSET: ${this.target.assetId}` : `BUNDLE CB-${String(this.target.bundleNumber ?? 1).padStart(2, "0")}`,
      this.target.theme ?? "candy_arcade",
    );

    let assetPath: string;
    if (this.target.assetId && this.target.fingerprint) {
      assetPath = await this.repository.writeQuizImageAsset(this.target.channelId, this.target.episodeId, this.target.assetId, this.target.fingerprint, bytes);
    } else {
      assetPath = await this.repository.writeBundleImage(this.target.channelId, this.target.episodeId, this.target.bundleNumber ?? 1, bytes, this.target.variant ?? 0);
    }

    return { asset_path: assetPath, fallback_tier: 3, degraded: true };
  }
}
