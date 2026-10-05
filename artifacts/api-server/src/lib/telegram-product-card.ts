export const PRODUCT_CARD_STYLES = ['classic','compact','premium','sale','minimal','image-first','price-first','warranty-first','VIP'] as const;
export type ProductCardStyle = typeof PRODUCT_CARD_STYLES[number];
export function productCardText(product: {name:string;price:string|number;oldPrice?:string|number|null;stock:number;sku?:string|null;warranty?:string;tags?:string[];description:string}, currency:string, style:ProductCardStyle='classic', rating?:{rating:number|null;count:number}, gallery?:{index:number;total:number}, badgeStyle:'text'|'emoji'|'none'='text') {
  const price = `${Number(product.price).toFixed(2)} ${currency}`;
  const sale = product.oldPrice && Number(product.oldPrice)>Number(product.price) ? `السعر السابق: ${Number(product.oldPrice).toFixed(2)} ${currency} · خصم ${Math.round((1-Number(product.price)/Number(product.oldPrice))*100)}%` : '';
  const warranty = product.warranty ? `الضمان: ${product.warranty}` : '';
  const name = style==='VIP' ? `♛ ${product.name}` : style==='premium' ? `✦ ${product.name}` : style==='sale'&&sale?`🔥 ${product.name}`:style==='image-first'?`🖼 ${product.name}`:product.name;
  const badge=sale&&badgeStyle!=='none'?(badgeStyle==='emoji'?'🏷 '+sale:sale):'';
  const heading = style==='price-first' ? [price,name] : style==='warranty-first' ? [warranty,name,price] : style==='sale'?[name,badge,price]:style==='image-first'?[gallery?.total?`معرض الصور (${gallery.total})`:'صورة المنتج',name,price]:[name,price];
  const metadata = style==='minimal' ? [] : [style!=='sale'?badge:'',`المخزون: ${product.stock}`,product.sku?`SKU: ${product.sku}`:'',style!=='warranty-first'?warranty:'',product.tags?.join(' · '),rating?.count?`التقييم: ${rating.rating} / 5 (${rating.count})`:''];
  return [...heading, ...metadata, gallery?.total?`الصورة ${gallery.index+1} من ${gallery.total}`:'',style==='compact'?'':product.description.slice(0,style==='minimal'?500:2000)].filter(Boolean).join(style==='compact'?' · ':'\n').slice(0,3500);
}
