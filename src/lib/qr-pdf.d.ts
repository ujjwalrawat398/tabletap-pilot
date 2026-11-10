declare module '@/lib/qr-pdf.mjs' {
  export function buildTableQrPdf(input: {
    restaurantName: string;
    appUrl: string;
    tables: { number: number; label?: string | null; table_code: string }[];
  }): Promise<Buffer>;
}
