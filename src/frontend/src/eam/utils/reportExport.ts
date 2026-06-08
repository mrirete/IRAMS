export const EXPORT_COLUMNS = {
    badActors: [
        { key: 'asset_tag', label: 'Asset Tag' },
        { key: 'asset_name', label: 'Asset Name' },
        { key: 'criticality', label: 'Criticality' },
        { key: 'wo_count', label: 'Work Order Count' },
        { key: 'total_cost', label: 'Total Cost ($)' },
        { key: 'total_downtime_hrs', label: 'Total Downtime (hrs)' },
        { key: 'pct_of_total_wos', label: '% of Total WOs' }
    ]
};

export const exportCSV = (data: any[], columns: { key: string, label: string }[], filename: string) => {
    if (!data || !data.length) return;

    const header = columns.map(col => `"${col.label}"`).join(',');

    const rows = data.map(row => {
        return columns.map(col => {
            let val = row[col.key];
            if (val === null || val === undefined) {
                val = '';
            }
            return `"${String(val).replace(/"/g, '""')}"`;
        }).join(',');
    });

    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

export const exportXLSX = async (data: any[], columns: { key: string, label: string }[], filename: string) => {
    if (!data || !data.length) return;
    try {
        const XLSX = await import('xlsx');
        const wsData = [
            columns.map(c => c.label),
            ...data.map(row => columns.map(c => row[c.key] ?? ''))
        ];
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Auto-width columns
        ws['!cols'] = columns.map((_, i) => ({
            wch: Math.max(
                columns[i].label.length,
                ...data.slice(0, 50).map(r => String(r[columns[i].key] ?? '').length)
            ) + 2
        }));

        XLSX.utils.book_append_sheet(wb, ws, 'Report');
        XLSX.writeFile(wb, filename);
    } catch (err) {
        console.error('XLSX export failed, falling back to CSV:', err);
        exportCSV(data, columns, filename.replace(/\.xlsx$/i, '.csv'));
    }
};

export const exportChartToPNG = async (elementRef: HTMLElement | null, filename = 'chart.png') => {
    if (!elementRef) return;
    try {
        const canvas = document.createElement('canvas');
        const svgEl = elementRef.querySelector('svg');
        if (!svgEl) return;
        const svgData = new XMLSerializer().serializeToString(svgEl);
        const img = new Image();
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        img.onload = () => {
            canvas.width = svgEl.clientWidth * 2;
            canvas.height = svgEl.clientHeight * 2;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.scale(2, 2);
                ctx.drawImage(img, 0, 0);
                const link = document.createElement('a');
                link.download = filename;
                link.href = canvas.toDataURL('image/png');
                link.click();
            }
            URL.revokeObjectURL(url);
        };
        img.src = url;
    } catch (err) {
        console.error('Chart export failed:', err);
    }
};

