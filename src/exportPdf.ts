export async function exportAuthorityPdf(
  title: string,
  lines: string[],
  demo: boolean,
) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF();
  const safe = (value: string) =>
    Array.from(String(value), (char) => (char.charCodeAt(0) < 32 ? " " : char))
      .join("")
      .slice(0, 1000);
  let y = 18;
  const heading = () => {
    pdf.setFontSize(17);
    pdf.setTextColor(19, 111, 99);
    pdf.text(safe(title), 14, y);
    y += 10;
    pdf.setFontSize(10);
    pdf.setTextColor(70);
    pdf.text(
      demo
        ? "PRESENTATION SAMPLE - NOT LIVE OPERATIONAL DATA"
        : "PRIVATE - AUTHORIZED ORGANIZATION EXPORT",
      14,
      y,
    );
    y += 7;
    pdf.text(`Generated ${new Date().toISOString()}`, 14, y);
    y += 12;
  };
  heading();
  for (const line of lines) {
    const wrapped = pdf.splitTextToSize(safe(line), 180) as string[];
    for (const part of wrapped) {
      if (y > 276) {
        pdf.addPage();
        y = 18;
        heading();
      }
      pdf.text(part, 14, y);
      y += 6;
    }
  }
  pdf.save(
    `pawlytics-${demo ? "presentation" : "authority"}-${new Date().toISOString().slice(0, 10)}.pdf`,
  );
}
