import * as ExcelJS from "exceljs";
import * as FileSaver from "file-saver";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface Column {
    header: string;
    accessor: string | ((item: any) => any);
    exportValue?: (item: any) => string | number;
}

/**
 * Exports data to an Excel file with stylized headers and auto-sized columns.
 */
export async function exportToExcel(data: any[], columns: Column[], filename: string) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Report");

    // Define columns
    worksheet.columns = columns.map(col => ({
        header: col.header.toUpperCase(),
        key: typeof col.accessor === "string" ? col.accessor : col.header,
        width: 20 // Default width, will be adjusted
    }));

    // Add rows
    data.forEach(item => {
        const rowData: any = {};
        columns.forEach(col => {
            const key = typeof col.accessor === "string" ? col.accessor : col.header;
            let value = "";

            if (col.exportValue) {
                value = String(col.exportValue(item));
            } else {
                value = typeof col.accessor === "function" ? col.accessor(item) : item[col.accessor];

                // Strip React elements if any
                if (typeof value === "object" && value !== null && "props" in value) {
                    value = extractTextFromReact(value);
                }
            }

            rowData[key] = value;
        });
        worksheet.addRow(rowData);
    });

    // Style the header
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF008542" } // Tiens Green
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };

    // Auto-size columns to the widest cell
    worksheet.columns.forEach((column: any) => {
        let maxColumnLength = 0;
        column.eachCell!({ includeEmpty: true }, (cell: ExcelJS.Cell) => {
            const columnLength = cell.value ? cell.value.toString().length : 10;
            if (columnLength > maxColumnLength) {
                maxColumnLength = columnLength;
            }
        });
        column.width = Math.min(maxColumnLength + 5, 50); // Cap at 50
    });

    // Generate buffer and save
    const buffer = await workbook.xlsx.writeBuffer();
    FileSaver.saveAs(new Blob([buffer]), `${filename}.xlsx`);
}

/**
 * Exports data to a PDF file with Tiens branding and formatted tables.
 */
export function exportToPDF(data: any[], columns: Column[], filename: string, title: string, summaryStats?: any[], logoBase64?: string) {
    const doc = new jsPDF() as any;

    // --- HEADER SECTION (White BG) ---
    // 0. Logo (Right Side)
    // Design matching screenshot: "TIENS HEALTH PRODUCTS" is roughly centered. Logo usually goes left or above.
    // User requested "logo.ico in ... headers". I'll put it top-center or to the left of the title.
    // Let's place it Top-Left or Top-Center. The text is centered. Placing logo at x=80, y=10?
    // Let's try placing it to the left of the text block if possible, or just centered above.

    if (logoBase64) {
        try {
            // Add logo on the right side
            doc.addImage(logoBase64, 'PNG', 170, 15, 25, 25);
        } catch (e) {
            console.warn("Failed to add logo to PDF", e);
        }
    }
    // 1. Title: Tiens Green, Bold, Centered
    doc.setTextColor(0, 133, 66); // #008542
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("TIENS HEALTH PRODUCTS", 105, 25, { align: "center" });

    // 2. Address: Dark Gray, Normal, Centered
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("6th Floor, King Fahd Plaza, Plot 52 Kampala Rd", 105, 33, { align: "center" }); // 33 for clearance
    doc.text("Tel: +256 (0) 702 794 458 | 0773 662 136", 105, 38, { align: "center" });   // 38 for legibility

    // 3. Report Badge: Green Pill with White Text
    const titleText = `OFFICIAL ${title.toUpperCase()}`;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    const textWidth = doc.getTextWidth(titleText) + 20; // Padding
    const pillX = 105 - (textWidth / 2);

    doc.setFillColor(0, 133, 66);
    doc.roundedRect(pillX, 44, textWidth, 8, 3, 3, "F"); // 44 to clear address

    doc.setTextColor(255, 255, 255);
    doc.text(titleText, 105, 49.5, { align: "center" }); // Centered in 44-52 pill

    // 4. Horizontal Green Line
    doc.setDrawColor(0, 133, 66);
    doc.setLineWidth(1);
    doc.line(10, 58, 200, 58); // 58 to clear pill

    // --- SUMMARY SECTION ---
    let currentY = 66;

    if (summaryStats && summaryStats.length > 0) {
        // Calculate Grid
        const pageWidth = 210; // A4 width in mm
        const margin = 14;     // Left margin to match table
        const cardWidth = 45; // Fixed width per card to ensure spacing

        summaryStats.forEach((stat: any, index: number) => {
            const xPos = margin + (index * cardWidth); // Grid layout
            const textX = xPos;

            // Vertical Separator Line (except for the first item)
            if (index > 0) {
                doc.setDrawColor(220, 220, 220); // Light gray
                doc.setLineWidth(0.2);
                doc.line(xPos - 4, currentY, xPos - 4, currentY + 15);
            }

            // Title: Green, Uppercase, Bold, Small
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7);
            doc.setTextColor(0, 133, 66);
            doc.text(String(stat.title).toUpperCase(), textX, currentY + 5);

            // Value: Black, Large, Extra Bold
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.text(String(stat.value), textX, currentY + 11);

            // Description: Gray, Italic, Tiny
            doc.setFont("helvetica", "italic");
            doc.setFontSize(6);
            doc.setTextColor(150, 150, 150);
            doc.text(String(stat.description), textX, currentY + 15);
        });

        // Bottom Line for Summary (Optional)
        doc.setDrawColor(240, 240, 240);
        doc.setLineWidth(0.1);
        doc.line(10, currentY + 22, 200, currentY + 22);

        currentY += 28; // Move down for table
    }

    // Prepare table data
    const tableHeaders = ["#", ...columns.map(c => c.header.toUpperCase())];
    const tableData = data.map((item, rowIdx) => {
        return [
            String(rowIdx + 1),
            ...columns.map(col => {
                if (col.exportValue) {
                    return String(col.exportValue(item));
                }

                let value = typeof col.accessor === "function" ? col.accessor(item) : item[col.accessor as string];
                if (typeof value === "object" && value !== null && "props" in value) {
                    value = extractTextFromReact(value);
                }
                return value;
            })
        ];
    });

    // Generate Table
    autoTable(doc, {
        head: [tableHeaders],
        body: tableData,
        startY: currentY,
        styles: { fontSize: 8, cellPadding: 2, font: "helvetica" },
        headStyles: { fillColor: [0, 133, 66], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 248] }, // Very light green/gray tint
        margin: { top: 20 },
    });

    doc.save(`${filename}.pdf`);
}

/**
 * Helper to extract plain text from React elements in accessor functions
 */
export function extractTextFromReact(element: any): string {
    if (typeof element === "string" || typeof element === "number") return String(element);
    if (!element) return "";

    const props = element.props;
    if (!props) return "";

    const children = props.children;
    if (Array.isArray(children)) {
        // Filter out nulls/falsy, and map recursively
        return children
            .map(child => extractTextFromReact(child))
            .filter(text => text.length > 0)
            .join("\n");
    }
    return extractTextFromReact(children);
}
