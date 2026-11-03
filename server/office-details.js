import JSZip from 'jszip';
import { load } from 'cheerio';
import { imageDimension } from './image-dimensions.js';

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
