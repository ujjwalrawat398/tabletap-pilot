/**
 * Printable table QR sheet (deliverable #4).
 *
 * Plain ESM so it can run in two places without duplicating layout code:
 *   • scripts/generate-qr-pdf.mjs  (CLI, no server needed)
 *   • /api/admin/qr-pdf            (admin download button)
 *
 * A4, 6 cards per page, high error-correction QR codes (survives greasy
 * fingerprints and cheap printing), plus the raw URL for writing to an
 * NTAG213 NFC sticker.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 36;
const COLS = 2;
const ROWS = 3;
const GAP = 14;

/**
 * @param {{ restaurantName: string, appUrl: string, tables: {number:number,label?:string|null,table_code:string}[] }} input
 * @returns {Promise<Buffer>}
 */
export async function buildTableQrPdf({ restaurantName, appUrl, tables }) {
  const base = String(appUrl).replace(/\/$/, '');
  const cards = await Promise.all(
    tables.map(async (table) => ({
      ...table,
      url: `${base}/t/${table.table_code}`,
      buffer: await QRCode.toBuffer(`${base}/t/${table.table_code}`, {
        type: 'png',
        margin: 1,
        width: 700,
        errorCorrectionLevel: 'H',
      }),
    })),
  );

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: false });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const cardW = (PAGE.width - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
  const cardH = (PAGE.height - MARGIN * 2 - 60 - GAP * (ROWS - 1)) / ROWS;
  const perPage = COLS * ROWS;
  const pageCount = Math.max(1, Math.ceil(cards.length / perPage));

  for (let p = 0; p < pageCount; p++) {
    doc.addPage();

    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111')
      .text(restaurantName, MARGIN, MARGIN - 8, { width: PAGE.width - MARGIN * 2 });
    doc.font('Helvetica').fontSize(9).fillColor('#666666')
      .text('Scan to order · No app needed · Tap the NFC sticker or scan the QR code', MARGIN, MARGIN + 12);

    const chunk = cards.slice(p * perPage, p * perPage + perPage);

    chunk.forEach((card, i) => {
      const x = MARGIN + (i % COLS) * (cardW + GAP);
      const y = MARGIN + 36 + Math.floor(i / COLS) * (cardH + GAP);

      doc.lineWidth(0.8).roundedRect(x, y, cardW, cardH, 10).strokeColor('#d4d4d4').stroke();

      doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111')
        .text(`Table ${card.number}`, x + 14, y + 14, { width: cardW - 28 });

      if (card.label) {
        doc.font('Helvetica').fontSize(8).fillColor('#888888').text(card.label, x + 14, y + 30);
      }

      const qrSize = Math.min(cardW - 60, cardH - 96);
      doc.image(card.buffer, x + (cardW - qrSize) / 2, y + 42, { width: qrSize, height: qrSize });

      doc.font('Helvetica').fontSize(7).fillColor('#555555')
        .text(card.url, x + 10, y + cardH - 26, { width: cardW - 20, align: 'center' });
      doc.fontSize(6).fillColor('#999999')
        .text('Write this URL to an NTAG213 sticker for tap-to-open', x + 10, y + cardH - 15, {
          width: cardW - 20,
          align: 'center',
        });
    });

    doc.font('Helvetica').fontSize(7).fillColor('#999999')
      .text(
        `Page ${p + 1} of ${pageCount} · generated ${new Date().toLocaleString('en-IN')} · TableTap by U&D Digital Studio`,
        MARGIN,
        PAGE.height - MARGIN + 10,
        { width: PAGE.width - MARGIN * 2, align: 'center' },
      );
  }

  doc.end();
  return finished;
}
