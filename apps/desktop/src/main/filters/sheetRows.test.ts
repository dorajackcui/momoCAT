import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { extractSheetRows } from './sheetRows';

describe('extractSheetRows', () => {
  it('extracts only real valued rows even when worksheet range is huge', () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Source', 'Target'],
      ['s1', 't1'],
      ['s2', 't2'],
      ['s3', 't3'],
      ['s4', 't4'],
      ['s5', 't5'],
      ['s6', 't6'],
      ['s7', 't7'],
      ['s8', 't8'],
    ]);

    // Simulate files whose !ref is bloated by formatting metadata.
    worksheet['!ref'] = 'A1:B1047589';

    const rows = extractSheetRows(worksheet, { columnIndexes: [0, 1] });
    expect(rows).toHaveLength(9);
    expect(rows[0].rowIndex).toBe(0);
    expect(rows[8].rowIndex).toBe(8);
    expect(rows[8].cells[0]).toBe('s8');
    expect(rows[8].cells[1]).toBe('t8');
  });

  it('supports preview row limits and ignores blank-only cells', () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['a', 'b', 'c'],
      ['', 'x', ''],
      ['   ', '', ''],
      ['d', '', 'e'],
    ]);

    const rows = extractSheetRows(worksheet, { maxRows: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0].cells[0]).toBe('a');
    expect(rows[1].cells[1]).toBe('x');
  });

  describe('dense worksheets', () => {
    function denseSheet(rows: unknown[][]): XLSX.WorkSheet {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const dense = XLSX.read(buf, { type: 'buffer', dense: true });
      return dense.Sheets['S'];
    }

    it('extracts selected columns from dense rows', () => {
      const worksheet = denseSheet([
        ['s1', 't1', 'note1'],
        ['s2', 't2', 'note2'],
      ]);
      expect(Array.isArray(worksheet)).toBe(true);

      const rows = extractSheetRows(worksheet, { columnIndexes: [0, 1] });
      expect(rows).toHaveLength(2);
      expect(rows[0].cells[0]).toBe('s1');
      expect(rows[0].cells[1]).toBe('t1');
      expect(rows[0].cells[2]).toBeUndefined();
    });

    it('stays fast when a stray far-right cell inflates row length', () => {
      // A stray cell at column XFD (index 16383) makes each dense row a
      // sparse array of length 16384. Extraction must visit only the
      // selected columns, not scan every slot of every row.
      const data: string[][] = [];
      for (let i = 0; i < 5000; i++) {
        data.push([`s${i}`, `t${i}`]);
      }
      const worksheet = denseSheet(data);
      const denseRows = worksheet as unknown as Array<Array<XLSX.CellObject | undefined>>;
      denseRows[0][16383] = { t: 's', v: 'stray' };

      const t0 = performance.now();
      const rows = extractSheetRows(worksheet, { columnIndexes: [0, 1] });
      const elapsed = performance.now() - t0;

      expect(rows).toHaveLength(5000);
      expect(rows[4999].cells[0]).toBe('s4999');
      // Column-targeted visits: ~10k lookups total. Well under 50ms even on
      // slow CI; the full-scan regression measured ~258ms here.
      expect(elapsed).toBeLessThan(50);
    });

    it('without a column filter, enumerates only existing cells and keeps stray columns', () => {
      const worksheet = denseSheet([['a', 'b']]);
      const denseRows = worksheet as unknown as Array<Array<XLSX.CellObject | undefined>>;
      denseRows[0][16383] = { t: 's', v: 'stray' };

      const rows = extractSheetRows(worksheet);
      expect(rows).toHaveLength(1);
      expect(rows[0].cells[0]).toBe('a');
      expect(rows[0].cells[16383]).toBe('stray');
    });

    it('respects maxRows on dense worksheets', () => {
      const worksheet = denseSheet([
        ['r0', 'x'],
        ['r1', 'x'],
        ['r2', 'x'],
      ]);
      const rows = extractSheetRows(worksheet, { maxRows: 2 });
      expect(rows).toHaveLength(2);
      expect(rows[1].cells[0]).toBe('r1');
    });
  });
});
