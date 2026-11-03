import JSZip from 'jszip';
import { load } from 'cheerio';
import { imageDimension } from './image-dimensions.js';
import { tableLength } from './table-layout.js';

function wordWidth(item) {
  const value = Number(item.attr('w:w')), type = item.attr('w:type');
  if (!Number.isFinite(value) || value <= 0) return '';
  return type === 'pct' ? tableLength(`${value/50}%`,true) : type === 'dxa' ? tableLength(`${value/20}pt`) : '';
}
function margins(props) {
  const values = [];
  for (const side of ['top','right','bottom','left']) {
    const width = wordWidth(props.children(`w\\:${side}`).first());
    if (width) values.push(`padding-${side}: ${width}`);
  }
  return values;
}
function addStyle(item, parts) {
  const kept = parts.filter(Boolean);
  if (kept.length) item.attr('style',[item.attr('style'),...kept].filter(Boolean).join('; '));
}

export async function restoreOfficeDetails(buffer, html) {
  const zip=await JSZip.loadAsync(buffer);
  const part=zip.file('word/document.xml');
  if(!part)return html;
  const xml=load(await part.async('string'),{xmlMode:true});
  const $=load(html);
  const drawings=xml('w\\:drawing').toArray(), images=$('img').toArray();
  // Pair only a complete image sequence; guessing would size the wrong reference.
  if(drawings.length===images.length)drawings.forEach((node,index)=>{
    const extent=xml(node).find('wp\\:extent').first();
    for(const [key,attribute] of [['width','cx'],['height','cy']]) {
      const emu=Number(extent.attr(attribute));
      const pixels=Number.isFinite(emu)?imageDimension(String(emu/9525)):'';
      if(pixels)$(images[index]).attr(key,pixels);
    }
  });
  const tables=xml('w\\:tbl').toArray(), rendered=$('table').toArray();
  if(tables.length===rendered.length)tables.forEach((node,index)=>{
    const source=xml(node), table=$(rendered[index]), props=source.children('w\\:tblPr');
    const width=wordWidth(props.children('w\\:tblW'));
    const fixed=props.children('w\\:tblLayout').attr('w:type')==='fixed';
    addStyle(table,[width && `width: ${width}`,fixed && 'table-layout: fixed']);
    const grid=source.children('w\\:tblGrid').children('w\\:gridCol').toArray().map(col=>{
      const value=Number(xml(col).attr('w:w'));
      return Number.isFinite(value) && value>0?tableLength(`${value/20}pt`):'';
    });
    if(grid.length && grid.every(Boolean)) {
      const group=$('<colgroup></colgroup>');
      for(const value of grid)group.append($('<col>').attr('style',`width: ${value}`));
      table.prepend(group);
    }
    const rows=source.children('w\\:tr').toArray();
    const outputRows=table.find('tr').filter((_,row)=>$(row).closest('table')[0]===table[0]).toArray();
    if(rows.length!==outputRows.length)return;
    rows.forEach((row,rowIndex)=>{
      const sourceRow=xml(row), outputRow=$(outputRows[rowIndex]);
      const height=Number(sourceRow.children('w\\:trPr').children('w\\:trHeight').attr('w:val'));
      if(Number.isFinite(height) && height>0)addStyle(outputRow,[`height: ${tableLength(`${height/20}pt`)}`]);
      const sourceCells=sourceRow.children('w\\:tc').toArray(), outputCells=outputRow.children('td,th').toArray();
      // Vertical merge continuations may be omitted by Mammoth; do not shift cell properties.
      if(sourceCells.length!==outputCells.length)return;
      sourceCells.forEach((cell,cellIndex)=>{
        const cellProps=xml(cell).children('w\\:tcPr'), item=$(outputCells[cellIndex]);
        const span=Number(cellProps.children('w\\:gridSpan').attr('w:val') || 1);
        if(span!==Number(item.attr('colspan') || 1))return;
        const cellWidth=wordWidth(cellProps.children('w\\:tcW'));
        const align=cellProps.children('w\\:vAlign').attr('w:val');
        addStyle(item,[
          ...margins(props.children('w\\:tblCellMar')),
          ...margins(cellProps.children('w\\:tcMar')),
          cellWidth && `width: ${cellWidth}`,
          ['top','center','bottom'].includes(align) && `vertical-align: ${align==='center'?'middle':align}`,
        ]);
      });
    });
  });
  const cells=xml('w\\:tc').toArray(), output=$('td,th').toArray();
  // Only pair cells when the converter preserved the complete table structure.
  if(cells.length===output.length)cells.forEach((node,index)=>{
    const props=xml(node).children('w\\:tcPr');
    const fill=props.children('w\\:shd').attr('w:fill');
    if(/^[0-9a-f]{6}$/i.test(fill || '')) {
      const item=$(output[index]);
      item.attr('style',`${item.attr('style') || ''};background-color:#${fill}`);
    }
  });
  return $('body').html() || '';
}
