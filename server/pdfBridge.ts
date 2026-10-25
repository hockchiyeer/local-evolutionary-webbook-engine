// Puppeteer native browser automation is stripped in the container runtime.
// PDF generation is handled client-side using jsPDF + html2canvas.
export async function generatePdf(_html: string): Promise<Buffer> {
  throw new Error("Server-side Puppeteer PDF generation is disabled in this environment. Client-side PDF export is used instead.");
}
