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
/**
 * Exports data to a PDF file with Tiens branding and formatted tables.
 */
export function exportToPDF(data: any[], columns: Column[], filename: string, title: string, summaryData?: any) {
    const doc = new jsPDF() as any;

    // Add Branding Header
    doc.setFillColor(0, 133, 66); // Tiens Green
    doc.rect(0, 0, 210, 45, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("TIENS HEALTH PRODUCTS", 105, 18, { align: "center" });

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("6th Floor, King Fahd Plaza, Plot 52 Kampala Rd", 105, 25, { align: "center" });
    doc.text("Tel: +256 (0) 702 794 458 | 0773 662 136", 105, 29, { align: "center" });

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`OFFICIAL ${title.toUpperCase()}`, 105, 38, { align: "center" });

    doc.setFontSize(8);
    doc.setTextColor(200, 200, 200);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 200, 42, { align: "right" });

    let currentY = 55;

    // Summary Section in PDF
    if (summaryData) {
        doc.setFillColor(245, 250, 248);
        doc.rect(10, currentY, 190, 25, "F");
        doc.setDrawColor(0, 133, 66);
        doc.setLineWidth(0.5);
        doc.rect(10, currentY, 190, 25, "D");

        doc.setTextColor(0, 133, 66);
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");

        // Sales
        doc.text("TOTAL SALES", 20, currentY + 8);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.text(`UGX ${summaryData.totalRevenue.toLocaleString()}`, 20, currentY + 18);

        // PV/BV
        doc.setTextColor(180, 110, 0);
        doc.setFontSize(9);
        doc.text("TIED PV/BV", 75, currentY + 8);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.text(`${summaryData.totalPV.toLocaleString()} PV / ${summaryData.totalBV.toLocaleString()} BV`, 75, currentY + 18);

        // Profit
        doc.setTextColor(0, 80, 180);
        doc.setFontSize(9);
        doc.text("NET PROFIT", 145, currentY + 8);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.text(`UGX ${summaryData.totalProfit.toLocaleString()}`, 145, currentY + 18);

        currentY += 35;
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
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [0, 133, 66], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 245, 245] },
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
