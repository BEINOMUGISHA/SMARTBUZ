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
        fgColor: { argb: "FF0f766e" } // Brand Teal Green
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
export function exportToPDF(
    data: any[],
    columns: Column[],
    filename: string,
    title: string,
    summaryStats?: any[],
    logoBase64?: string,
    businessInfo?: { name?: string; address?: string; phone?: string }
) {
    const doc = new jsPDF() as any;

    if (logoBase64) {
        try {
            doc.addImage(logoBase64, 'PNG', 170, 15, 25, 25);
        } catch (e) {
            console.warn("Failed to add logo to PDF", e);
        }
    }

    const brandName = businessInfo?.name || "SMARTBUZ POS";
    const brandAddress = businessInfo?.address || "Point of Sale & Inventory Management System";
    const brandPhone = businessInfo?.phone || "";

    // 1. Title
    doc.setTextColor(15, 118, 110); // Professional Teal / Slate Green
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(brandName.toUpperCase(), 105, 25, { align: "center" });

    // 2. Address
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(brandAddress, 105, 33, { align: "center" });
    if (brandPhone) {
        doc.text(`Tel: ${brandPhone}`, 105, 38, { align: "center" });
    }

    // 3. Report Badge
    const titleText = `OFFICIAL ${title.toUpperCase()}`;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    const textWidth = doc.getTextWidth(titleText) + 20;
    const pillX = 105 - (textWidth / 2);

    doc.setFillColor(15, 118, 110);
    doc.roundedRect(pillX, 44, textWidth, 8, 3, 3, "F");

    doc.setTextColor(255, 255, 255);
    doc.text(titleText, 105, 49.5, { align: "center" });

    // 4. Horizontal Line
    doc.setDrawColor(15, 118, 110);
    doc.setLineWidth(1);
    doc.line(10, 58, 200, 58);

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
