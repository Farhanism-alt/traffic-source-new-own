// Browser-side download of the Master Export. Large sites come back in several
// parts (the API pages raw rows to stay under the response size cap); each part
// is saved as its own .xlsx so no row is left behind.
export async function downloadMasterExport(siteId, query, onProgress) {
  let offset = 0;
  let part = 1;
  for (;;) {
    const params = new URLSearchParams({ ...query, ...(offset ? { offset: String(offset) } : {}) });
    const res = await fetch(`/api/analytics/${siteId}/export?${params}`);
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = match ? match[1] : `master-export-part-${part}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const next = parseInt(res.headers.get('X-Export-Next-Offset'), 10);
    if (!next || next <= offset) return part;
    offset = next;
    part += 1;
    onProgress?.(part);
  }
}
