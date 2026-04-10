import puppeteer from "puppeteer";

export async function generatePdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle0"],
    });

    await page.evaluateHandle("document.fonts.ready");

    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}
